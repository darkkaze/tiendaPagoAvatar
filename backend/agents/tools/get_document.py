"""
Tool for retrieving documents from knowledge base.
"""
from langchain_core.tools import tool
from db.models import SessionLocal
from db.repository import KnowledgeBaseRepository


@tool
def get_document_by_id(doc_id: str) -> str:
    """
    Recupera el contenido completo de un documento por su ID.
    
    Args:
        doc_id: Identificador del documento (ej: "finanzas", "operaciones", "bienestar")
        
    Returns:
        Contenido completo del documento, o mensaje de error si no existe
    """
    with SessionLocal() as session:
        repo = KnowledgeBaseRepository(session)
        content = repo.get_document_by_id(doc_id)
        
        if content:
            return content
        else:
            return f"Documento '{doc_id}' no encontrado en la base de conocimientos."
