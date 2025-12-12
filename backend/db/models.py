"""
Database models for knowledge base.
In-memory chat history with FIFO queue (no persistence).
"""
import os
from sqlalchemy import create_engine, Column, String, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from collections import deque
from typing import List, Dict

Base = declarative_base()


class KnowledgeBase(Base):
    """
    Knowledge base model for semantic routing.

    Stores complete documents with topic summaries for LLM-based routing.
    """
    __tablename__ = "knowledge_base"

    doc_id = Column(String, primary_key=True)  # e.g., "finanzas", "operaciones"
    topic_summary = Column(Text, nullable=False)  # Brief description for Router
    full_content = Column(Text, nullable=False)   # Complete document content

    def to_dict(self):
        """Convert to dictionary."""
        return {
            "doc_id": self.doc_id,
            "topic_summary": self.topic_summary,
            "full_content": self.full_content
        }


# Database setup
DATABASE_URL = "sqlite:///db/tiendapago.db"
engine = create_engine(DATABASE_URL, echo=False)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    """Initialize database tables."""
    Base.metadata.create_all(bind=engine)


def get_db_session():
    """Get database session context manager."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class ChatHistory:
    """
    In-memory FIFO chat history.
    
    Stores last 6 messages (3 exchanges) in memory.
    No persistence - history is lost on restart.
    """
    
    def __init__(self, max_size: int = 6):
        self._history: deque = deque(maxlen=max_size)
    
    def add_message(self, message: str, role: str):
        """Add a message to history."""
        self._history.append({"message": message, "role": role})
    
    def add_exchange(self, user_message: str, agent_response: str):
        """Add a full user-agent exchange."""
        self.add_message(user_message, "human")
        self.add_message(agent_response, "agent")
    
    def get_history(self) -> List[Dict[str, str]]:
        """Get all messages in history."""
        return list(self._history)
    
    def get_formatted(self) -> str:
        """Get history formatted as string for prompts."""
        if not self._history:
            return "Sin historial reciente."
        
        lines = []
        for msg in self._history:
            role = "Usuario" if msg["role"] == "human" else "Asistente"
            lines.append(f"{role}: {msg['message']}")
        return "\n".join(lines)
    
    def clear(self):
        """Clear all history."""
        self._history.clear()


# Global singleton for chat history
chat_history = ChatHistory(max_size=6)


class DatabaseManager:
    """
    Database manager implementing DatabaseManagerProtocol.
    
    Uses in-memory chat history (no DB persistence).
    """

    async def save_conversation(self, user_message: str, agent_response: str) -> None:
        """Save conversation to in-memory history."""
        chat_history.add_exchange(user_message, agent_response)

    async def retrieve_conversation(self, hours: int = 12, limit: int = 10):
        """Retrieve conversation from in-memory history."""
        return chat_history.get_history()
