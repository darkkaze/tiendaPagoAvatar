"""
Repository for database operations (knowledge base only).
Chat history is now in-memory (see db/models.py ChatHistory).
"""
from typing import List, Dict, Optional
from sqlalchemy.orm import Session

from db.models import KnowledgeBase


class KnowledgeBaseRepository:
    """
    Repository for knowledge base operations.

    Available methods:
    - get_all_summaries(): Get all document summaries for routing
    - get_document_by_id(doc_id): Get full document content by ID
    """

    def __init__(self, session: Session):
        """
        Initialize repository with database session.

        Args:
            session: SQLAlchemy database session
        """
        self.session = session

    def get_all_summaries(self) -> List[Dict[str, str]]:
        """
        Get all document summaries for the router.

        Returns:
            List of dictionaries with doc_id and topic_summary
            Format: [{"doc_id": "finanzas", "topic_summary": "..."}]
        """
        documents = self.session.query(KnowledgeBase).all()
        return [
            {"doc_id": doc.doc_id, "topic_summary": doc.topic_summary}
            for doc in documents
        ]

    def get_document_by_id(self, doc_id: str) -> Optional[str]:
        """
        Get full document content by ID.

        Args:
            doc_id: Document identifier (e.g., "finanzas")

        Returns:
            Full document content, or None if not found
        """
        doc = self.session.query(KnowledgeBase).filter_by(doc_id=doc_id).first()
        return doc.full_content if doc else None

    def get_all_doc_ids(self) -> List[str]:
        """
        Get list of all document IDs.

        Returns:
            List of doc_id strings
        """
        documents = self.session.query(KnowledgeBase.doc_id).all()
        return [doc.doc_id for doc in documents]
