"""
Tienda Pago Agent Tools.

Available tools:
- get_document_by_id: Retrieve full document content by ID
"""
from agents.tools.get_document import get_document_by_id

ALL_TOOLS = [
    get_document_by_id,
]

__all__ = [
    "get_document_by_id",
    "ALL_TOOLS"
]
