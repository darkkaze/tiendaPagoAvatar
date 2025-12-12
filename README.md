# Tienda Pago - Asistente Virtual con Avatar 3D

Asistente conversacional para comerciantes que combina un agente RAG (Retrieval-Augmented Generation) con un avatar 3D animado. El usuario habla, el avatar responde con voz sintetizada y animaciones faciales sincronizadas.

---

## Decisiones Técnicas: ¿Por qué no usar Vector Search?

Al analizar el desafío, me enfrenté a una disyuntiva interesante respecto a la sugerencia de implementar un "Naive RAG" (chunking + búsqueda vectorial). No estoy seguro si esta instrucción era una "trampa" intencional del diseño de la prueba o simplemente una simplificación, pero aplicar esa técnica a este corpus específico hubiera resultado en una solución deficiente.

Es fundamental distinguir que **RAG (Retrieval-Augmented Generation) es un patrón de arquitectura independiente de su implementación**. Vector Search es solo una herramienta de recuperación, y para este caso, no era la adecuada.

### 1. La "Trampa" de la Polisemia y los Contextos Divergentes

Los documentos provistos son cortos pero semánticamente densos y presentan un riesgo alto de confusión para una búsqueda por similitud simple:

**El solapamiento de vocabulario:** La palabra "proveedor" es el mejor ejemplo. Aparece en *Operaciones* (contexto transaccional: cómo pagar) y en *Bienestar* (contexto emocional: manejo de estrés).

**El Fallo del Naive RAG:** Un buscador vectorial simple priorizaría la frecuencia de la palabra. Si un usuario dice *"Me estresa mi proveedor"*, el sistema probablemente recuperaría instrucciones de pago (Operaciones) en lugar de consejos de salud mental (Bienestar), fallando en entender la intención del usuario.

### 2. La Solución: RAG con Enrutamiento Semántico

En lugar de fragmentar la información y perder el hilo narrativo, opté por una arquitectura de **Semantic Routing**.

**Cómo funciona:** Un nodo clasificador (Router) analiza la intención de la pregunta y decide qué documento es necesario.

**La Ventaja:** Esto permite inyectar el documento completo en el contexto del LLM. Al tener la totalidad de la información (y no solo fragmentos o "chunks" aislados), el modelo puede razonar mejor y evitar alucinaciones causadas por falta de contexto.

> **Nota sobre Vector Search:** Aunque tengo experiencia implementando bases de datos vectoriales (como ChromaDB o FAISS) para corpus de gran escala donde la búsqueda semántica es obligatoria, aplicarlas aquí hubiera sido un error de diseño ("matar moscas a cañonazos"). La ingeniería eficaz consiste en elegir la herramienta correcta para el problema, no forzar la herramienta de moda donde no aporta valor.

---

## Flujo del Agente (LangGraph)

> 📁 Implementación: [`backend/agents/agent.py`](backend/agents/agent.py)

```
                                    ┌─────────────────┐
                                    │      START      │
                                    └────────┬────────┘
                                             │
                                             ▼
                              ┌──────────────────────────────┐
                              │         ROUTER NODE          │
                              │  ─────────────────────────   │
                              │  Analiza pregunta vs         │
                              │  resúmenes de documentos     │
                              │  (finanzas, operaciones,     │
                              │   bienestar)                 │
                              └──────────────┬───────────────┘
                                             │
                         ┌───────────────────┴───────────────────┐
                         │                                       │
                   doc_id_match?                            doc_id = none
                         │                                       │
                         ▼                                       ▼
          ┌──────────────────────────┐            ┌──────────────────────────┐
          │     RETRIEVER NODE       │            │      FALLBACK NODE       │
          │  ────────────────────    │            │  ────────────────────    │
          │  SELECT full_content     │            │  "No puedo ayudarte      │
          │  FROM knowledge_base     │            │   con eso, pero sí con   │
          │  WHERE doc_id = ?        │            │   temas de tu negocio"   │
          └────────────┬─────────────┘            └────────────┬─────────────┘
                       │                                       │
                       ▼                                       │
          ┌──────────────────────────┐                         │
          │     GENERATOR NODE       │                         │
          │  ────────────────────    │                         │
          │  LLM genera respuesta    │                         │
          │  usando documento        │                         │
          │  completo como contexto  │                         │
          └────────────┬─────────────┘                         │
                       │                                       │
                       └───────────────────┬───────────────────┘
                                           │
                                           ▼
                                    ┌─────────────────┐
                                    │       END       │
                                    └─────────────────┘
```

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Vue 3)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Voice Input │  │  WebSocket  │  │   Avatar 3D (Three.js)  │  │
│  │   (STT)     │──│   Client    │──│   VRM + Visemas + TTS   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Python + LangGraph)                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    WebSocket Handler                     │   │
│  │  ┌────────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │ TiendapagoAgent│  │  TTS Client  │  │Visemas Client│  │   │
│  │  │  (LangGraph)   │  │  (Gemini)    │  │  (Librosa)   │  │   │
│  │  └────────────────┘  └──────────────┘  └──────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   SQLite (tiendapago.db)                  │  │
│  │  ┌──────────────────────────────────────────────────────┐ │  │
│  │  │ knowledge_base: doc_id | topic_summary | full_conten │ │  │
│  │  └──────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Instalación

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python load_db.py  # Carga documentos con resúmenes GPT-5-nano
python main.py     # WebSocket en :8765
```

### TTS Service
```bash
cd speech_to_text_service
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python app.py      # HTTP en :5002
```

### Frontend
```bash
cd vue-project
npm install
npm run dev        # Vite en :5173
```

---

## Variables de Entorno

```bash
# backend/settings.py
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...  # Para Gemini TTS
```
