"""
Tienda Pago RAG Agent - Main agent implementation.

Implements a RAG workflow with semantic routing for Tienda Pago knowledge base.
Uses LangGraph to manage the state graph.
"""
from langgraph.graph import StateGraph, END
from langchain_core.messages import AIMessage, HumanMessage

from agents.state import AgentState
from agents.prompts import (
    ROUTER_SYSTEM_PROMPT,
    GENERATOR_SYSTEM_PROMPT,
    FALLBACK_PROMPT,
    HUMANIZE_PROMPT
)
from db.models import SessionLocal
from db.repository import KnowledgeBaseRepository


class TiendapagoAgent:
    """
    Tienda Pago RAG Agent with Semantic Routing.

    Workflow:
    START → router_node → [conditional]
                          ├─ doc_id_match → retriever_node → generator_node → END
                          └─ no match → fallback_node → END
    """

    def __init__(self, model):
        """
        Initialize Tienda Pago Agent.

        Args:
            model: LangChain model instance (e.g., ChatOpenAI)
        """
        if model is None:
            raise ValueError("Model is required.")
        
        self.model = model
        self.workflow = self._build_workflow()
        self.workflow.name = "tiendapago_rag_agent"

    @property
    def agent(self):
        """Get compiled workflow graph."""
        return self.workflow

    def _load_chat_history(self) -> str:
        """Load recent conversation history from in-memory FIFO."""
        from db.models import chat_history
        return chat_history.get_formatted()

    def _get_available_contexts(self) -> str:
        """Get all document summaries for router."""
        with SessionLocal() as session:
            repo = KnowledgeBaseRepository(session)
            summaries = repo.get_all_summaries()
            
            contexts = []
            for doc in summaries:
                contexts.append(f"- {doc['doc_id']}: {doc['topic_summary']}")
            
            return "\n".join(contexts)

    def _router_node(self, state: AgentState) -> dict:
        """
        Router node - Classify user intent and select document.
        
        Analyzes question against document summaries to decide which
        document (if any) is relevant.
        """
        print("\n[ 🔀 ROUTER NODE ]")
        
        question = state.get("question", "")
        chat_history = self._load_chat_history()
        available_contexts = self._get_available_contexts()
        
        print(f"   Pregunta: {question}")
        print(f"   Contextos: {available_contexts[:100]}...")
        
        prompt = ROUTER_SYSTEM_PROMPT.format(
            chat_history=f"HISTORIAL:\n{chat_history}",
            available_contexts=available_contexts
        )
        
        response = self.model.invoke([
            HumanMessage(content=prompt),
            HumanMessage(content=f"Pregunta del usuario: {question}")
        ])
        
        doc_id = response.content.strip().lower()
        print(f"   Router decidió: {doc_id}")
        
        # Validate doc_id
        valid_ids = ["finanzas", "operaciones", "bienestar"]
        if doc_id not in valid_ids:
            doc_id = None
        
        return {
            "doc_id_match": doc_id,
            "chat_history": [chat_history],
            "messages": [response]
        }

    def _retriever_node(self, state: AgentState) -> dict:
        """
        Retriever node - Fetch full document content.
        
        Executes SQL query to get complete document by ID.
        """
        print("\n[ 📚 RETRIEVER NODE ]")
        
        doc_id = state.get("doc_id_match")
        print(f"   Recuperando documento: {doc_id}")
        
        with SessionLocal() as session:
            repo = KnowledgeBaseRepository(session)
            content = repo.get_document_by_id(doc_id)
        
        if content:
            print(f"   Contenido: {len(content)} caracteres")
        else:
            print(f"   ⚠️ Documento no encontrado")
            content = ""
        
        return {"retrieved_context": content}

    def _generator_node(self, state: AgentState) -> dict:
        """
        Generator node - Generate RAG response using retrieved context.
        """
        print("\n[ 🎙️ GENERATOR NODE ]")
        
        question = state.get("question", "")
        context = state.get("retrieved_context", "")
        chat_history = state.get("chat_history", [""])[0]
        
        prompt = GENERATOR_SYSTEM_PROMPT.format(
            context=context,
            chat_history=chat_history,
            question=question
        )
        
        response = self.model.invoke([HumanMessage(content=prompt)])
        final_response = response.content.strip()
        
        print(f"   📢 Respuesta: {final_response}")
        
        return {
            "final_response": final_response,
            "messages": [response]
        }

    def _fallback_node(self, state: AgentState) -> dict:
        """
        Fallback node - Handle off-topic or unmatched questions.
        """
        print("\n[ ❌ FALLBACK NODE ]")
        
        question = state.get("question", "")
        
        prompt = FALLBACK_PROMPT.format(question=question)
        
        response = self.model.invoke([HumanMessage(content=prompt)])
        final_response = response.content.strip()
        
        print(f"   📢 Fallback: {final_response}")
        
        return {
            "final_response": final_response,
            "messages": [response]
        }

    def _route_after_router(self, state: AgentState) -> str:
        """Conditional routing after router node."""
        doc_id = state.get("doc_id_match")
        if doc_id:
            return "retriever"
        return "fallback"

    def _build_workflow(self):
        """
        Build the RAG workflow graph.

        Flow:
        START → router → [conditional]
                         ├─ doc_id_match → retriever → generator → END
                         └─ no match → fallback → END
        """
        workflow = StateGraph(AgentState)

        # Add nodes
        workflow.add_node("router", self._router_node)
        workflow.add_node("retriever", self._retriever_node)
        workflow.add_node("generator", self._generator_node)
        workflow.add_node("fallback", self._fallback_node)

        # Set entry point
        workflow.set_entry_point("router")

        # Add conditional edge from router
        workflow.add_conditional_edges(
            "router",
            self._route_after_router,
            {
                "retriever": "retriever",
                "fallback": "fallback"
            }
        )

        # Add edges
        workflow.add_edge("retriever", "generator")
        workflow.add_edge("generator", END)
        workflow.add_edge("fallback", END)

        return workflow.compile()

    async def process_message(self, message: str) -> str:
        """
        Process a user message and return agent's response.

        Implements AgentProtocol interface.

        Args:
            message: User's input message

        Returns:
            Agent's text response
        """
        result = await self.workflow.ainvoke({
            "question": message,
            "session_id": "default",
            "chat_history": [],
            "doc_id_match": None,
            "retrieved_context": "",
            "final_response": "",
            "messages": []
        })
        return result.get("final_response", "No pude procesar tu mensaje.")


# Alias for backwards compatibility
LibreraAgent = TiendapagoAgent
