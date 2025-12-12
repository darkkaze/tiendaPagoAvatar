import os

WEBSOCKET_HOST = os.getenv("WEBSOCKET_HOST", "0.0.0.0")
WEBSOCKET_PORT = int(os.getenv("WEBSOCKET_PORT", "8765"))

TTS_SERVICE_URL = os.getenv("TTS_SERVICE_URL", "http://localhost:5002")
VISEMAS_SERVICE_URL = os.getenv("VISEMAS_SERVICE_URL", "http://localhost:5001")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Database is baked into the image (read-only demo mode)
DATABASE_PATH = "db/tiendapago.db"

PHONEME_TO_VISEME = {
    # Vocales principales
    'a': 'aa',      # Boca abierta amplia
    'e': 'ee',      # Sonrisa, boca semi-abierta
    'i': 'ih',      # Sonrisa, boca cerrada
    'o': 'oh',      # Boca redonda
    'u': 'ou',      # Boca muy redonda, labios fruncidos

    # Consonantes -> mapear a la vocal más cercana o neutral
    'p': 'neutral', 'b': 'neutral', 'm': 'neutral',  # Labiales
    'f': 'ee', 'v': 'ee',                            # Fricativas -> sonrisa
    't': 'ih', 'd': 'ih', 'n': 'ih', 'l': 'ih',      # Alveolares -> ih
    's': 'ih', 'z': 'ih',                            # Fricativas -> ih
    'k': 'aa', 'g': 'aa',                            # Velares -> aa
    'r': 'aa',                                       # Vibrante -> aa
    'ch': 'ih', 'y': 'ih',                           # Palatales -> ih
    'h': 'aa',                                       # Aspirada -> aa
    'j': 'aa',                                       # J española -> aa
    'ñ': 'ih',                                       # Ñ -> ih

    # Silencio
    'sil': 'neutral'  # Posición neutral/descanso
}