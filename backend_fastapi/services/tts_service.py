"""
Unified TTS Service with Piper Integration.

Provides offline text-to-speech with viseme generation for lip-sync animation.
Model is loaded once at startup to prevent memory leaks.
"""

import asyncio
import io
import wave
import struct
from pathlib import Path
from typing import Optional, AsyncGenerator
from functools import lru_cache

from backend_fastapi.utils.logger import get_logger

logger = get_logger("tts_service")

# Phoneme to viseme mapping (simplified for common phonemes)
PHONEME_TO_VISEME = {
    # Silence
    'sil': 0, 'sp': 0, 'spn': 0,
    # Bilabial (lips together) - m, b, p
    'm': 1, 'b': 1, 'p': 1,
    # Labiodental (lip to teeth) - f, v
    'f': 2, 'v': 2,
    # Dental/Alveolar - th, d, t, n, l
    'th': 3, 'dh': 3, 'd': 3, 't': 3, 'n': 3, 'l': 3,
    # Alveolar/Palatal - s, z, sh, zh, ch, j, r
    's': 4, 'z': 4, 'sh': 4, 'zh': 4, 'ch': 4, 'jh': 4, 'r': 4,
    # Velar/Glottal - k, g, ng, h
    'k': 5, 'g': 5, 'ng': 5, 'hh': 5,
    # Close vowels - i, u
    'iy': 6, 'ih': 6, 'uw': 6, 'uh': 6,
    # Mid vowels - e, o, schwa
    'ey': 7, 'eh': 7, 'ow': 7, 'er': 7, 'ax': 7,
    # Open vowels - a, aa
    'ae': 8, 'aa': 8, 'ao': 8, 'ah': 8, 'ay': 8, 'aw': 8, 'oy': 8,
    # Rounded - w, oo
    'w': 9, 'y': 9,
}

# Character to approximate phoneme for simple viseme generation
CHAR_TO_PHONEME = {
    'a': 'aa', 'e': 'eh', 'i': 'iy', 'o': 'ow', 'u': 'uw',
    'b': 'b', 'c': 'k', 'd': 'd', 'f': 'f', 'g': 'g',
    'h': 'hh', 'j': 'jh', 'k': 'k', 'l': 'l', 'm': 'm',
    'n': 'n', 'p': 'p', 'q': 'k', 'r': 'r', 's': 's',
    't': 't', 'v': 'v', 'w': 'w', 'x': 's', 'y': 'y', 'z': 'z',
    ' ': 'sp', '.': 'sil', ',': 'sp', '!': 'sil', '?': 'sil',
}


class TTSService:
    """
    Singleton TTS service for unified audio generation.
    
    Supports both edge-tts (online) and Piper (offline) backends.
    Falls back gracefully if Piper is not installed.
    """
    
    def __init__(self):
        self._initialized = False
        self._engine = "edge-tts"  # Default to edge-tts (always available)
        self._piper_voice = None
        self._sample_rate = 22050
        self._default_voice = "en-US-AriaNeural"
        
    async def initialize(self) -> bool:
        """
        Initialize the TTS engine.
        Attempts Piper first, falls back to edge-tts.
        """
        if self._initialized:
            return True
            
        # Try to load Piper for offline TTS
        try:
            # Check if piper-tts is installed
            import piper
            
            # Look for voice model in standard locations
            voices_dir = Path("./data/voices")
            if voices_dir.exists():
                onnx_files = list(voices_dir.glob("*.onnx"))
                if onnx_files:
                    voice_path = onnx_files[0]
                    self._piper_voice = piper.PiperVoice.load(str(voice_path))
                    self._engine = "piper"
                    self._sample_rate = 22050
                    logger.info(f"Piper TTS loaded: {voice_path.name}")
                    self._initialized = True
                    return True
                    
            logger.info("No Piper voice models found, using edge-tts")
        except ImportError:
            logger.info("Piper not installed, using edge-tts")
        except Exception as e:
            logger.warning(f"Piper initialization failed: {e}, using edge-tts")
        
        # Fall back to edge-tts (requires internet but always works)
        try:
            import edge_tts
            self._engine = "edge-tts"
            self._initialized = True
            logger.info("Edge-TTS initialized")
            return True
        except ImportError:
            logger.error("Neither Piper nor edge-tts available!")
            return False
    
    @property
    def engine(self) -> str:
        """Get current TTS engine name."""
        return self._engine
    
    @property
    def sample_rate(self) -> int:
        """Get audio sample rate."""
        return self._sample_rate
    
    async def generate_audio(
        self,
        text: str,
        voice: Optional[str] = None
    ) -> bytes:
        """
        Generate complete audio for text.
        
        Args:
            text: Text to synthesize
            voice: Voice ID (for edge-tts) or ignored for Piper
            
        Returns:
            WAV audio bytes
        """
        if not self._initialized:
            await self.initialize()
        
        if self._engine == "piper" and self._piper_voice:
            return await self._generate_piper(text)
        else:
            return await self._generate_edge_tts(text, voice or self._default_voice)
    
    async def generate_audio_stream(
        self,
        text: str,
        voice: Optional[str] = None
    ) -> AsyncGenerator[bytes, None]:
        """
        Stream audio chunks as they're generated.
        
        Args:
            text: Text to synthesize
            voice: Voice ID
            
        Yields:
            Audio chunk bytes
        """
        if not self._initialized:
            await self.initialize()
        
        if self._engine == "piper" and self._piper_voice:
            # Piper doesn't support streaming, yield full audio
            audio = await self._generate_piper(text)
            yield audio
        else:
            async for chunk in self._stream_edge_tts(text, voice or self._default_voice):
                yield chunk
    
    async def _generate_piper(self, text: str) -> bytes:
        """Generate audio using Piper (offline)."""
        loop = asyncio.get_event_loop()
        
        def _synthesize():
            audio_buffer = io.BytesIO()
            with wave.open(audio_buffer, 'wb') as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(self._sample_rate)
                
                for audio_bytes in self._piper_voice.synthesize_stream_raw(text):
                    wav.writeframes(audio_bytes)
            
            return audio_buffer.getvalue()
        
        return await loop.run_in_executor(None, _synthesize)
    
    async def _generate_edge_tts(self, text: str, voice: str) -> bytes:
        """Generate audio using edge-tts (online)."""
        import edge_tts
        
        communicate = edge_tts.Communicate(text, voice)
        audio_chunks = []
        
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_chunks.append(chunk["data"])
        
        return b''.join(audio_chunks)
    
    async def _stream_edge_tts(
        self,
        text: str,
        voice: str
    ) -> AsyncGenerator[bytes, None]:
        """Stream audio using edge-tts."""
        import edge_tts
        
        communicate = edge_tts.Communicate(text, voice)
        
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                yield chunk["data"]
    
    def generate_visemes(self, text: str, duration_ms: float = 100.0) -> list[dict]:
        """
        Generate viseme data from text for lip-sync animation.
        
        Args:
            text: Input text
            duration_ms: Duration per viseme in milliseconds
            
        Returns:
            List of viseme dictionaries with time, value, duration
        """
        visemes = []
        current_time = 0.0
        
        for char in text.lower():
            phoneme = CHAR_TO_PHONEME.get(char, 'sp')
            viseme_value = PHONEME_TO_VISEME.get(phoneme, 0)
            
            visemes.append({
                "time": current_time,
                "value": viseme_value,
                "duration": duration_ms
            })
            
            current_time += duration_ms
        
        return visemes
    
    async def list_voices(self) -> list[dict]:
        """List available TTS voices."""
        if self._engine == "piper":
            # Return installed Piper voices
            voices = []
            voices_dir = Path("./data/voices")
            if voices_dir.exists():
                for onnx_file in voices_dir.glob("*.onnx"):
                    voices.append({
                        "id": onnx_file.stem,
                        "name": onnx_file.stem.replace("_", " ").title(),
                        "engine": "piper"
                    })
            return voices
        else:
            # Return edge-tts voices
            try:
                import edge_tts
                voices_list = await edge_tts.list_voices()
                return [
                    {
                        "id": v["ShortName"],
                        "name": v["FriendlyName"],
                        "locale": v["Locale"],
                        "gender": v["Gender"],
                        "engine": "edge-tts"
                    }
                    for v in voices_list[:50]  # Limit to 50 voices
                ]
            except Exception as e:
                logger.error(f"Failed to list voices: {e}")
                return []
    
    async def close(self):
        """Cleanup resources."""
        self._piper_voice = None
        self._initialized = False
        logger.info("TTS service closed")


# Singleton instance
_tts_service: Optional[TTSService] = None


def get_tts_service() -> TTSService:
    """Get or create TTS service singleton."""
    global _tts_service
    if _tts_service is None:
        _tts_service = TTSService()
    return _tts_service
