#!/usr/bin/env python3
"""
Servicio de Text-to-Speech con Gemini TTS
"""

import os
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

from model_gemini.gemini_engine import GeminiEngine

app = Flask(__name__)
CORS(app)

# Inicializar Gemini TTS
print("🔧 Inicializando servicio TTS con Gemini...")
tts_engine = GeminiEngine()
print("✅ Servicio TTS listo")

@app.route('/health', methods=['GET'])
def health_check():
    """Endpoint de health check"""
    return jsonify({
        "status": "healthy", 
        "service": "speech_to_text_service",
        "engine": "gemini"
    })

@app.route('/generate', methods=['POST'])
def generate_speech():
    """
    Genera speech desde texto
    
    Body JSON:
    {
        "text": "Hola mundo"
    }
    
    Response:
    {
        "audio_url": "/voice/filename.wav",
        "engine": "gemini"
    }
    """
    try:
        data = request.get_json()
        
        if not data or not data.get('text'):
            return jsonify({"error": "text requerido"}), 400
        
        text = data['text']
        print(f"🎤 Generando TTS: '{text[:50]}...'")
        
        audio_file = tts_engine.generate_speech(text)
        
        filename = os.path.basename(audio_file)
        server_url = request.host_url.rstrip('/')
        audio_url = f"{server_url}/voice/{filename}"
        
        return jsonify({
            "audio_url": audio_url,
            "engine": "gemini"
        })
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/voice/<filename>', methods=['GET'])
def serve_audio(filename):
    """Sirve archivos de audio generados"""
    file_path = os.path.join(tts_engine._temp_dir, filename)
    
    if not os.path.exists(file_path):
        return jsonify({"error": "Archivo no encontrado"}), 404
    
    return send_file(file_path, mimetype='audio/wav')

if __name__ == '__main__':
    print("🎤 Iniciando TTS Gemini en puerto 5002...")
    try:
        app.run(host='0.0.0.0', port=5002, debug=True)
    finally:
        tts_engine.cleanup()