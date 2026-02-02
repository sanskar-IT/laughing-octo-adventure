"""
Unified TTS Service with True Offline Support and Voice Cloning.

Features:
- Coqui TTS (XTTS) for offline voice synthesis and cloning
- Piper TTS as lightweight offline fallback
- Edge-TTS as online fallback
- Chunked audio streaming for low latency
- Speaker profile management for voice cloning
"""

import asyncio
import io
import json
import wave
import shutil
from pathlib import Path
from typing import Optional, AsyncGenerator, Dict, Any
from functools import lru_cache
from dataclasses import dataclass

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


@dataclass
class SpeakerProfile:
    """Cloned speaker profile metadata."""
    id: str
    name: str
    source_file: str
    embedding_path: str
    created_at: str
    sample_rate: int = 22050


class TTSService:
    """
    Singleton TTS service with offline-first architecture.
    
    Priority order:
    1. Coqui TTS (XTTS) - Best quality, supports voice cloning
    2. Piper TTS - Lightweight offline option
    3. Edge-TTS - Online fallback (requires internet)
    """
    
    # Audio streaming configuration
    CHUNK_SIZE = 4096  # Bytes per chunk for streaming
    MAX_TEXT_LENGTH = 5000  # Maximum characters per synthesis
    
    def __init__(self):
        self._initialized = False
        self._engine = "none"
        self._coqui_tts = None
        self._piper_voice = None
        self._sample_rate = 22050
        self._default_voice = "en-US-AriaNeural"
        self._speaker_profiles: Dict[str, SpeakerProfile] = {}
        self._voices_dir = Path("./data/voices")
        self._profiles_dir = Path("./data/speaker_profiles")
        
    async def initialize(self) -> bool:
        """
        Initialize the TTS engine with offline-first priority.
        """
        if self._initialized:
            return True
        
        # Ensure directories exist
        self._voices_dir.mkdir(parents=True, exist_ok=True)
        self._profiles_dir.mkdir(parents=True, exist_ok=True)
        
        # Load existing speaker profiles
        await self._load_speaker_profiles()
        
        # Try Coqui TTS first (best quality, supports cloning)
        if await self._init_coqui_tts():
            self._initialized = True
            return True
        
        # Try Piper TTS (lightweight offline)
        if await self._init_piper():
            self._initialized = True
            return True
        
        # Fall back to edge-tts (online)
        if await self._init_edge_tts():
            self._initialized = True
            return True
        
        logger.error("No TTS engine available!")
        return False
    
    async def _init_coqui_tts(self) -> bool:
        """Initialize Coqui TTS (XTTS) for high-quality offline synthesis."""
        try:
            from TTS.api import TTS
            import torch
            
            # Determine device (GPU preferred for XTTS)
            device = "cuda" if torch.cuda.is_available() else "cpu"
            
            # Load XTTS v2 model (supports voice cloning)
            logger.info(f"Loading Coqui XTTS v2 on {device}...")
            self._coqui_tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)
            
            self._engine = "coqui-xtts"
            self._sample_rate = 22050
            logger.info(f"Coqui XTTS initialized successfully on {device}")
            return True
            
        except ImportError:
            logger.info("Coqui TTS not installed")
            return False
        except Exception as e:
            logger.warning(f"Coqui TTS initialization failed: {e}")
            return False
    
    async def _init_piper(self) -> bool:
        """Initialize Piper TTS for lightweight offline synthesis."""
        try:
            import piper
            
            # Look for voice models
            if self._voices_dir.exists():
                onnx_files = list(self._voices_dir.glob("*.onnx"))
                if onnx_files:
                    voice_path = onnx_files[0]
                    self._piper_voice = piper.PiperVoice.load(str(voice_path))
                    self._engine = "piper"
                    self._sample_rate = 22050
                    logger.info(f"Piper TTS loaded: {voice_path.name}")
                    return True
            
            logger.info("No Piper voice models found")
            return False
            
        except ImportError:
            logger.info("Piper TTS not installed")
            return False
        except Exception as e:
            logger.warning(f"Piper initialization failed: {e}")
            return False
    
    async def _init_edge_tts(self) -> bool:
        """Initialize Edge-TTS as online fallback."""
        try:
            import edge_tts
            self._engine = "edge-tts"
            self._sample_rate = 24000
            logger.info("Edge-TTS initialized (online fallback)")
            return True
        except ImportError:
            logger.warning("Edge-TTS not available")
            return False
    
    async def _load_speaker_profiles(self):
        """Load existing speaker profiles from disk."""
        profiles_file = self._profiles_dir / "profiles.json"
        if profiles_file.exists():
            try:
                with open(profiles_file, 'r') as f:
                    data = json.load(f)
                    for profile_data in data.get("profiles", []):
                        profile = SpeakerProfile(**profile_data)
                        self._speaker_profiles[profile.id] = profile
                logger.info(f"Loaded {len(self._speaker_profiles)} speaker profiles")
            except Exception as e:
                logger.warning(f"Failed to load speaker profiles: {e}")
    
    async def _save_speaker_profiles(self):
        """Save speaker profiles to disk."""
        profiles_file = self._profiles_dir / "profiles.json"
        try:
            data = {
                "profiles": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "source_file": p.source_file,
                        "embedding_path": p.embedding_path,
                        "created_at": p.created_at,
                        "sample_rate": p.sample_rate
                    }
                    for p in self._speaker_profiles.values()
                ]
            }
            with open(profiles_file, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save speaker profiles: {e}")
    
    @property
    def engine(self) -> str:
        """Get current TTS engine name."""
        return self._engine
    
    @property
    def sample_rate(self) -> int:
        """Get audio sample rate."""
        return self._sample_rate
    
    @property
    def supports_cloning(self) -> bool:
        """Check if current engine supports voice cloning."""
        return self._engine == "coqui-xtts"
    
    async def clone_voice(
        self,
        audio_data: bytes,
        profile_name: str,
        source_filename: str
    ) -> dict:
        """
        Create a speaker profile from a reference audio file.
        
        Args:
            audio_data: WAV audio bytes (reference voice sample)
            profile_name: Name for the speaker profile
            source_filename: Original filename of the audio
            
        Returns:
            Dict with profile info or error
        """
        if not self.supports_cloning:
            return {
                "success": False,
                "error": f"Voice cloning not supported with {self._engine} engine. Requires Coqui XTTS."
            }
        
        try:
            import uuid
            from datetime import datetime
            
            profile_id = str(uuid.uuid4())[:8]
            
            # Save the reference audio
            ref_audio_path = self._profiles_dir / f"{profile_id}_reference.wav"
            with open(ref_audio_path, 'wb') as f:
                f.write(audio_data)
            
            # For XTTS, we store the reference audio path directly
            # XTTS uses the audio file to extract speaker embeddings at synthesis time
            embedding_path = str(ref_audio_path)
            
            # Validate the audio can be processed
            try:
                import wave
                with wave.open(str(ref_audio_path), 'rb') as wav:
                    duration = wav.getnframes() / wav.getframerate()
                    if duration < 3:
                        return {
                            "success": False,
                            "error": "Reference audio must be at least 3 seconds long"
                        }
                    if duration > 30:
                        return {
                            "success": False,
                            "error": "Reference audio should be under 30 seconds"
                        }
            except Exception as e:
                ref_audio_path.unlink(missing_ok=True)
                return {
                    "success": False,
                    "error": f"Invalid WAV file: {str(e)}"
                }
            
            # Create and save profile
            profile = SpeakerProfile(
                id=profile_id,
                name=profile_name,
                source_file=source_filename,
                embedding_path=embedding_path,
                created_at=datetime.now().isoformat(),
                sample_rate=self._sample_rate
            )
            
            self._speaker_profiles[profile_id] = profile
            await self._save_speaker_profiles()
            
            logger.info(f"Created speaker profile: {profile_name} ({profile_id})")
            
            return {
                "success": True,
                "profile": {
                    "id": profile_id,
                    "name": profile_name,
                    "source_file": source_filename,
                    "created_at": profile.created_at
                }
            }
            
        except Exception as e:
            logger.error(f"Voice cloning failed: {e}")
            return {
                "success": False,
                "error": str(e)
            }
    
    async def delete_speaker_profile(self, profile_id: str) -> bool:
        """Delete a speaker profile."""
        if profile_id not in self._speaker_profiles:
            return False
        
        profile = self._speaker_profiles[profile_id]
        
        # Delete the reference audio file
        try:
            Path(profile.embedding_path).unlink(missing_ok=True)
        except Exception:
            pass
        
        del self._speaker_profiles[profile_id]
        await self._save_speaker_profiles()
        
        logger.info(f"Deleted speaker profile: {profile_id}")
        return True
    
    def list_speaker_profiles(self) -> list[dict]:
        """List all available speaker profiles."""
        return [
            {
                "id": p.id,
                "name": p.name,
                "source_file": p.source_file,
                "created_at": p.created_at
            }
            for p in self._speaker_profiles.values()
        ]
    
    async def generate_audio(
        self,
        text: str,
        voice: Optional[str] = None,
        speaker_profile_id: Optional[str] = None
    ) -> bytes:
        """
        Generate complete audio for text.
        
        Args:
            text: Text to synthesize
            voice: Voice ID (for edge-tts) or ignored for offline engines
            speaker_profile_id: Optional cloned speaker profile to use
            
        Returns:
            WAV audio bytes
        """
        if not self._initialized:
            await self.initialize()
        
        # Truncate text if too long
        if len(text) > self.MAX_TEXT_LENGTH:
            text = text[:self.MAX_TEXT_LENGTH]
            logger.warning(f"Text truncated to {self.MAX_TEXT_LENGTH} characters")
        
        if self._engine == "coqui-xtts":
            return await self._generate_coqui(text, speaker_profile_id)
        elif self._engine == "piper" and self._piper_voice:
            return await self._generate_piper(text)
        else:
            return await self._generate_edge_tts(text, voice or self._default_voice)
    
    async def generate_audio_stream(
        self,
        text: str,
        voice: Optional[str] = None,
        speaker_profile_id: Optional[str] = None
    ) -> AsyncGenerator[bytes, None]:
        """
        Stream audio chunks as they're generated.
        Minimizes latency by yielding chunks immediately.
        
        Args:
            text: Text to synthesize
            voice: Voice ID
            speaker_profile_id: Optional cloned speaker to use
            
        Yields:
            Audio chunk bytes
        """
        if not self._initialized:
            await self.initialize()
        
        # For Coqui and Piper, we generate full audio and stream in chunks
        if self._engine in ("coqui-xtts", "piper"):
            audio = await self.generate_audio(text, voice, speaker_profile_id)
            
            # Stream in chunks
            for i in range(0, len(audio), self.CHUNK_SIZE):
                yield audio[i:i + self.CHUNK_SIZE]
                await asyncio.sleep(0)  # Allow other coroutines to run
        else:
            # Edge-TTS supports native streaming
            async for chunk in self._stream_edge_tts(text, voice or self._default_voice):
                yield chunk
    
    async def _generate_coqui(
        self,
        text: str,
        speaker_profile_id: Optional[str] = None
    ) -> bytes:
        """Generate audio using Coqui XTTS."""
        loop = asyncio.get_event_loop()
        
        def _synthesize():
            speaker_wav = None
            
            # Get speaker reference if using voice cloning
            if speaker_profile_id and speaker_profile_id in self._speaker_profiles:
                profile = self._speaker_profiles[speaker_profile_id]
                speaker_wav = profile.embedding_path
                logger.info(f"Using cloned voice: {profile.name}")
            
            # Generate audio
            if speaker_wav:
                wav = self._coqui_tts.tts(
                    text=text,
                    speaker_wav=speaker_wav,
                    language="en"
                )
            else:
                # Use default speaker
                wav = self._coqui_tts.tts(
                    text=text,
                    language="en"
                )
            
            # Convert to WAV bytes
            audio_buffer = io.BytesIO()
            import numpy as np
            
            # Normalize and convert to int16
            wav_array = np.array(wav)
            wav_array = np.clip(wav_array, -1.0, 1.0)
            wav_int16 = (wav_array * 32767).astype(np.int16)
            
            with wave.open(audio_buffer, 'wb') as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(self._sample_rate)
                wav_file.writeframes(wav_int16.tobytes())
            
            return audio_buffer.getvalue()
        
        return await loop.run_in_executor(None, _synthesize)
    
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
        voices = []
        
        # Add cloned speaker profiles
        for profile in self._speaker_profiles.values():
            voices.append({
                "id": f"clone:{profile.id}",
                "name": f"🎭 {profile.name} (Cloned)",
                "engine": "coqui-xtts",
                "type": "cloned"
            })
        
        if self._engine == "piper":
            # Return installed Piper voices
            if self._voices_dir.exists():
                for onnx_file in self._voices_dir.glob("*.onnx"):
                    voices.append({
                        "id": onnx_file.stem,
                        "name": onnx_file.stem.replace("_", " ").title(),
                        "engine": "piper",
                        "type": "local"
                    })
        elif self._engine == "coqui-xtts":
            # XTTS uses reference audio for voice
            voices.append({
                "id": "default",
                "name": "Default English",
                "engine": "coqui-xtts",
                "type": "built-in"
            })
        elif self._engine == "edge-tts":
            # Return edge-tts voices
            try:
                import edge_tts
                voices_list = await edge_tts.list_voices()
                for v in voices_list[:50]:  # Limit to 50 voices
                    voices.append({
                        "id": v["ShortName"],
                        "name": v["FriendlyName"],
                        "locale": v["Locale"],
                        "gender": v["Gender"],
                        "engine": "edge-tts",
                        "type": "online"
                    })
            except Exception as e:
                logger.error(f"Failed to list edge-tts voices: {e}")
        
        return voices
    
    async def close(self):
        """Cleanup resources."""
        self._coqui_tts = None
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
