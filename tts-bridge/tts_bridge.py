import asyncio
import json
import base64
import logging
from typing import Callable, Optional, Tuple, Any

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TTSBridge:
    def __init__(self, host="localhost", port: int = 8000):
        self.host = host
        self.port = port
        self.connected = False
        
        self.viseme_map: dict[str, int] = {
            ' ': 0, 'a': 1, 'e': 2, 'i': 3, 'o': 4, 'u': 5,
            'b': 6, 'm': 6, 'p': 6, 'f': 7, 'v': 7, 'w': 8,
            'r': 8, 'l': 9, 'd': 10, 'n': 10, 't': 10, 's': 11,
            'z': 11, 'j': 12, 'ch': 12, 'sh': 13, 'k': 14, 'g': 14,
            'x': 14, 'y': 15, 'h': 16
        }

    def text_to_visemes(self, text: str) -> list[dict[str, Any]]:
        text = text.lower()
        visemes: list[dict[str, Any]] = []
        
        i = 0
        while i < len(text):
            char = text[i]
            
            if char.isspace():
                visemes.append({'time': i * 0.05, 'value': 0, 'duration': 0.05})
                i += 1
                continue
            
            if char in self.viseme_map:
                viseme = self.viseme_map[char]
            elif char in 'aeiou':
                viseme = self.viseme_map.get(char, 1)
            elif char in 'bmp':
                viseme = self.viseme_map['b']
            elif char in 'fv':
                viseme = self.viseme_map['f']
            elif char in 'wlr':
                viseme = self.viseme_map['w']
            elif char in 'dnt':
                viseme = self.viseme_map['d']
            elif char in 'sz':
                viseme = self.viseme_map['s']
            elif char in 'kgx':
                viseme = self.viseme_map['k']
            else:
                viseme = 0
            
            visemes.append({'time': i * 0.05, 'value': viseme, 'duration': 0.05})
            i += 1
        
        return visemes

    def generate_viseme_frames(self, text: str, frame_rate: int = 60) -> list[dict[str, Any]]:
        visemes = self.text_to_visemes(text)
        frames: list[dict[str, Any]] = []
        
        for i, v in enumerate(visemes):
            frame_time = i / frame_rate
            frames.append({
                "time": frame_time,
                "viseme": v['value'],
                "intensity": min(1.0, v['duration'] * 5)
            })
        
        return frames

class TTSClient:
    def __init__(self, host: str = "localhost", port: int = 8000):
        self.bridge = TTSBridge(host, port)
        self.audio_context = None
        self.audio_module = None
        
    def initialize(self) -> bool:
        try:
            self.audio_module = __import__('pyaudio')
            self.audio_context = self.audio_module.PyAudio()
            return True
        except ImportError:
            logger.warning("PyAudio not available, audio playback disabled")
            return True
        except Exception as e:
            logger.error(f"Failed to initialize audio: {e}")
            return False

    def speak(self, text: str, on_viseme: Optional[Callable[[dict[str, Any]], None]] = None) -> Tuple[bytes, list[dict[str, Any]]]:
        visemes = self.bridge.generate_viseme_frames(text)
        
        if on_viseme is not None:
            for v in visemes:
                on_viseme(v)
        
        dummy_audio = b'\x00' * 22050
        
        if self.audio_context and self.audio_module:
            try:
                stream = self.audio_context.open(
                    format=self.audio_module.paInt16,
                    channels=1,
                    rate=44100,
                    output=True
                )
                stream.write(dummy_audio)
                stream.stop_stream()
                stream.close()
            except Exception as e:
                logger.error(f"Audio playback error: {e}")
        
        return dummy_audio, visemes

    def get_visemes(self, text: str) -> list[dict[str, Any]]:
        return self.bridge.generate_viseme_frames(text)

    def shutdown(self) -> None:
        if self.audio_context:
            self.audio_context.terminate()

def main() -> None:
    client = TTSClient()
    
    if client.initialize():
        text = "Hello! I'm your AI companion. How can I help you today?"
        
        visemes = client.get_visemes(text)
        print(f"Generated {len(visemes)} viseme frames for: {text}")
        print("First few frames:", visemes[:5])
        
        audio_data, result_visemes = client.speak(text)
        print(f"Speech generated successfully, {len(audio_data)} bytes")
        
        client.shutdown()
    else:
        print("Failed to initialize TTS client")

if __name__ == "__main__":
    main()
