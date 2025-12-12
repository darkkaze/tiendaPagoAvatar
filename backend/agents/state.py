"""
State definition for Tienda Pago RAG Agent.
"""
from typing import TypedDict, Annotated, List, Optional
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    """
    State schema for Tienda Pago RAG Agent workflow.

    Attributes:
        question: User's input question
        session_id: Session ID for tracking
        chat_history: Formatted conversation history
        doc_id_match: Document ID selected by router (or None)
        retrieved_context: Full document content retrieved
        final_response: Generated response for user
        messages: LangChain messages for internal use
    """
    question: str
    session_id: str
    chat_history: List[str]
    doc_id_match: Optional[str]
    retrieved_context: str
    final_response: str
    messages: Annotated[List[BaseMessage], add_messages]
