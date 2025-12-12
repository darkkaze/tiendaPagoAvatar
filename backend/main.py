import websockets
import asyncio
import json
import os

import settings
from agents.ducktyping import AgentProtocol
from agents.agent import LibreraAgent
from db.ducktyping import DatabaseManagerProtocol
from db.models import DatabaseManager, init_db
from vox.xtts_client import XTTSClient
from visemas.librosa_client import LibrosaClient

from langchain_openai import ChatOpenAI

class WebSocketHandler:
    def __init__(self, agent: AgentProtocol, db_manager: DatabaseManagerProtocol, websocket):
        """
        Inicializa el manejador de WebSocket.

        Args:
            agent: Instancia del agente (implementa AgentProtocol)
            db_manager: Manager de la base de datos (implementa DatabaseManagerProtocol)
            websocket: Conexión WebSocket del cliente
        """
        self.agent = agent
        self.db_manager = db_manager
        self.websocket = websocket
        self.tts_model = XTTSClient(service_url=settings.TTS_SERVICE_URL)
        self.visemas_model = LibrosaClient(service_url=settings.VISEMAS_SERVICE_URL)

    
    async def handler(self):
        """Handler principal que rutea mensajes según su tipo"""
        async for message in self.websocket:
            try:
                print(f"Mensaje recibido: {message}")
                
                # Parsear mensaje
                if message == "alive":
                    await self.alive()
                else:
                    try:
                        msg_data = json.loads(message)
                        if "message" in msg_data and "id" in msg_data:
                            await self.main(msg_data["message"], msg_data["id"])
                        else:
                            await self.websocket.send(json.dumps({
                                "error": "Formato de mensaje inválido. Se requiere: {\"message\":\"...\", \"id\":\"...\"}", 
                                "type": "error"
                            }))
                    except json.JSONDecodeError:
                        await self.websocket.send(json.dumps({
                            "error": "JSON inválido", 
                            "type": "error"
                        }))
                        
            except Exception as e:
                print(f"Error procesando mensaje: {e}")
                await self.websocket.send(json.dumps({"error": str(e), "type": "error"}))
    
    async def alive(self):
        """Responde al heartbeat para mantener conexión activa"""
        await self.websocket.send("alive")
    
    async def main(self, message: str, message_id: str):
        """Función principal que maneja el flujo de procesamiento"""
        agent_response = await self.agent.process_message(message)
        print(f"Respuesta del agente: {agent_response}")

        # Procesamiento: TTS+Visemas (expresiones y animaciones ahora son frontend)
        await self._parallel1(message, agent_response, message_id)
    
    async def _parallel1(self, message: str, agent_response: str, message_id: str):
        """Primera rama de procesamiento paralelo: audio y visemas"""
        await self.db_manager.save_conversation(message, agent_response)
        tts_result = await self.tts_model.speech_to_text(agent_response)
        audio_url = tts_result["audio_url"]
        audio_base64 = tts_result["audio_base64"]
        
        visemas = await self.visemas_model.generate_visemes(agent_response, audio_url) 
        await self.websocket.send(json.dumps({
            "audio_base64": audio_base64,
            "audio_format": "wav",
            "message_id": message_id, 
            "visemas": visemas.get("visemas", [])
        }))
    




async def start_server():
    """Inicializa el servidor WebSocket"""

    # Initialize database
    print("Inicializando base de datos...")
    init_db()
    print("Base de datos inicializada.")

    async def handler_factory(websocket):
        """Factory para crear instancias de WebSocketHandler por cliente"""
        # Create LibreraAgent with GPT-5-mini
        model = ChatOpenAI(
            model="gpt-5-nano",
            api_key=settings.OPENAI_API_KEY
        )
        agent = LibreraAgent(model)

        # Create DatabaseManager
        db_manager = DatabaseManager()

        websocket_handler = WebSocketHandler(agent, db_manager, websocket)
        await websocket_handler.handler()

    print(f"Iniciando servidor WebSocket en {settings.WEBSOCKET_HOST}:{settings.WEBSOCKET_PORT}")
    server = await websockets.serve(
        handler_factory,
        settings.WEBSOCKET_HOST,
        settings.WEBSOCKET_PORT
    )
    print("Servidor iniciado. Esperando conexiones...")
    await server.wait_closed()


if __name__ == "__main__":
    asyncio.run(start_server())