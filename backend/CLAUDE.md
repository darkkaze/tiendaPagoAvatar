# Backend - WebSocket Coordination Server

## Overview
WebSocket server that coordinates parallel processing of TTS, visemas, expressions, and animations for the Waifu Avatar System.

Includes **TiendapagoAgent**: a RAG-based conversational agent with semantic routing using LangGraph + OpenAI.

## Architecture

### Core Components

**WebSocketHandler** (`main.py`)
- Receives agent and db_manager implementing their respective protocols
- Routes messages: heartbeat (`"alive"`) or full messages (`{"message": "...", "id": "..."}`)
- Parallel processing via `asyncio.gather()`:
  - `_parallel1`: TTS + Visemas (lip-sync) + DB save
  - `_parallel2`: Facial expressions
  - `_parallel3`: Body animations (disabled - now frontend)

### Dependencies

**Microservices:**
- `vox/xtts_client.py`: TTS generation (port 5002)
- `visemas/librosa_client.py`: Lip-sync generation (port 5001)
- `animations/expressions_client.py`: Facial expression analysis
- `animations/animations_client.py`: Body animation selection (OpenAI)

## Protocol Interfaces (Duck Typing)

### AgentProtocol (`agents/ducktyping.py`)
Expected interface for conversational agent implementations.

**Required method:**
- `async def process_message(message: str) -> str`

**Implementation:** `TiendapagoAgent` (`agents/agent.py`)

### DatabaseManagerProtocol (`db/ducktyping.py`)
Expected interface for conversation persistence.

**Required methods:**
- `async def save_conversation(user_message: str, agent_response: str) -> None`
- `async def retrieve_conversation(hours: int, limit: int) -> List[Dict[str, Any]]`

**Implementation:** `DatabaseManager` (`db/models.py`)

## TiendapagoAgent - RAG with Semantic Routing

**Model:** Any OpenAI-compatible model (e.g., `gpt-4o-mini`)

**Workflow (LangGraph StateGraph):**
```
START → router_node → [conditional]
                      ├─ doc_id_match → retriever_node → generator_node → END
                      └─ no match → fallback_node → END
```

**Nodes:**
- `router_node`: Classifies user intent against document summaries, outputs `doc_id_match`
- `retriever_node`: Fetches full document content by ID from SQLite
- `generator_node`: Generates RAG response using retrieved context
- `fallback_node`: Handles off-topic questions

**State (`AgentState`):**
- `question`: User's input
- `doc_id_match`: Selected document ID (or None)
- `retrieved_context`: Full document content
- `final_response`: Generated response
- `chat_history`: Recent conversation history

**Voice Interface Constraint:** All responses MUST be extremely short (1-20 words, max 30).

## Database Schema

**Database:** `db/tiendapago.db`

**Table:** `conversations`
- `id`: Integer (PK)
- `message`: String
- `role`: Enum('human', 'agent')
- `timestamp`: DateTime

**Table:** `knowledge_base`
- `doc_id`: String (PK) - e.g., "finanzas", "operaciones", "bienestar"
- `topic_summary`: Text - Brief summary for router classification
- `full_content`: Text - Complete document content

**Repositories:** 
- `ConversationRepository` (`db/repository.py`)
- `KnowledgeBaseRepository` (`db/repository.py`)

## Scripts

**Load Knowledge Base:**
```bash
python load_db.py
```
Reads `.txt` files from `db/input_documents/`, generates summaries with GPT-5-nano, and loads into `knowledge_base` table.

## Current Status

- ✅ WebSocket infrastructure ready
- ✅ Parallel processing pipeline functional
- ✅ TiendapagoAgent implemented (RAG with semantic routing via LangGraph)
- ✅ DatabaseManager implemented (SQLite persistence)
- ✅ Knowledge base loaded (3 documents: finanzas, operaciones, bienestar)
- ✅ Spanish prompts optimized for voice interface
