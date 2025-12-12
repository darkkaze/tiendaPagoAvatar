"""
Load documents into the knowledge base with AI-generated summaries.

Usage:
    python load_db.py

This script:
1. Reads all .txt files from db/input_documents/
2. Generates topic summaries using GPT-5-nano
3. Saves documents to the knowledge_base table
"""
import os
import glob
from openai import OpenAI

import settings
from db.models import init_db, SessionLocal, KnowledgeBase


def generate_summary(content: str, client: OpenAI) -> str:
    """
    Generate a brief topic summary for routing using GPT-5-nano.
    
    Args:
        content: Full document content
        client: OpenAI client
        
    Returns:
        Short summary (1-2 sentences) for the router
    """
    response = client.chat.completions.create(
        model="gpt-5-nano",
        messages=[
            {
                "role": "user",
                "content": f"""Genera un resumen MUY BREVE (1-2 oraciones) para clasificar preguntas de usuarios.

Documento:
{content}

Ejemplos de resúmenes:
- "Información sobre ahorro, créditos, tasas de interés y manejo de deudas."
- "Guías sobre uso de la app, pagos a proveedores y manejo de inventario."

Responde SOLO con el resumen, sin explicaciones adicionales:"""
            }
        ]
    )
    return response.choices[0].message.content.strip()


def load_documents():
    """Load all documents from input_documents folder into the database."""
    # Initialize database
    print("🗄️ Inicializando base de datos...")
    init_db()
    
    # Initialize OpenAI client
    client = OpenAI(api_key=settings.OPENAI_API_KEY)
    
    # Get all .txt files from input_documents
    input_dir = os.path.join(os.path.dirname(__file__), "db", "input_documents")
    txt_files = glob.glob(os.path.join(input_dir, "*.txt"))
    
    if not txt_files:
        print(f"⚠️ No se encontraron archivos .txt en {input_dir}")
        return
    
    print(f"📁 Encontrados {len(txt_files)} documentos")
    
    with SessionLocal() as session:
        for filepath in txt_files:
            # Extract doc_id from filename (without extension)
            filename = os.path.basename(filepath)
            doc_id = os.path.splitext(filename)[0]
            
            # Read full content
            with open(filepath, "r", encoding="utf-8") as f:
                full_content = f.read()
            
            print(f"\n📄 Procesando: {filename}")
            print(f"   doc_id: {doc_id}")
            print(f"   Contenido: {len(full_content)} caracteres")
            
            # Generate summary using GPT-5-nano
            print("   🤖 Generando resumen con GPT-5-nano...")
            topic_summary = generate_summary(full_content, client)
            print(f"   📝 Resumen: {topic_summary[:100]}...")
            
            # Check if document already exists
            existing = session.query(KnowledgeBase).filter_by(doc_id=doc_id).first()
            
            if existing:
                # Update existing document
                existing.topic_summary = topic_summary
                existing.full_content = full_content
                print(f"   ✏️ Documento actualizado")
            else:
                # Create new document
                doc = KnowledgeBase(
                    doc_id=doc_id,
                    topic_summary=topic_summary,
                    full_content=full_content
                )
                session.add(doc)
                print(f"   ✅ Documento creado")
        
        session.commit()
        print(f"\n🎉 ¡Carga completada! {len(txt_files)} documentos procesados.")


if __name__ == "__main__":
    load_documents()
