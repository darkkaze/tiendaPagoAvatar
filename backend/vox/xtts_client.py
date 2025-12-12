import aiohttp
import asyncio
import base64

class XTTSClient:
    def __init__(self, service_url: str = "http://localhost:5002"):
        self.service_url = service_url
    
    async def speech_to_text(self, text: str, entonacion: str = 'neutral') -> dict:
        """Genera speech usando el servicio HTTP TTS y devuelve audio como base64"""
        async with aiohttp.ClientSession() as session:
            payload = {
                "text": text,
                "entonacion": entonacion
            }
            
            async with session.post(f"{self.service_url}/generate", json=payload) as response:
                if response.status == 200:
                    data = await response.json()
                    audio_url = data["audio_url"]
                    
                    # Download audio and convert to base64
                    async with session.get(audio_url) as audio_response:
                        if audio_response.status == 200:
                            audio_bytes = await audio_response.read()
                            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
                            return {
                                "audio_url": audio_url,  # Keep for backwards compat
                                "audio_base64": audio_base64,
                                "audio_format": "wav"
                            }
                        else:
                            raise Exception(f"Error downloading audio: {audio_response.status}")
                else:
                    error_data = await response.json()
                    raise Exception(f"Error TTS: {error_data.get('error', 'Unknown error')}")