"""
TTS API Router - Unified Text-to-Speech endpoints with Voice Cloning.

Migrated from standalone tts-server.py into unified FastAPI backend.
Supports offline TTS with Coqui XTTS and voice cloning.
"""

import asyncio
import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form, status
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

from backend_fastapi.services.tts_service import get_tts_service
from backend_fastapi.core.config import get_settings
from backend_fastapi.utils.logger import get_logger

logger = get_logger("tts_routes")
settings = get_settings()

router = APIRouter(prefix="/tts", tags=["TTS"])

# Rate limiting storage (async-safe)
_rate_limit_lock = asyncio.Lock()
_rate_limits: dict[str, list[float]] = {}
RATE_LIMIT_REQUESTS = 100
RATE_LIMIT_WINDOW = 60  # seconds
MAX_TEXT_LENGTH = 5000
MAX_AUDIO_SIZE = 10 * 1024 * 1024  # 10MB max for voice cloning


class TTSRequest(BaseModel):
    """TTS generation request."""
    text: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH)
    stream: bool = Field(default=False, description="Enable streaming audio")
    voice: str = Field(default="en-US-AriaNeural", description="Voice ID")
    speaker_profile_id: Optional[str] = Field(
        default=None, 
        description="Cloned speaker profile ID (use voices starting with 'clone:')"
    )


class TTSResponse(BaseModel):
    """TTS generation response."""
    success: bool
    audio: Optional[str] = None  # Base64 encoded audio
    visemes: list[dict] = []
    timestamp: str


class VisemeRequest(BaseModel):
    """Viseme-only generation request."""
    text: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH)


class VoiceCloningResponse(BaseModel):
    """Voice cloning response."""
    success: bool
    profile: Optional[dict] = None
    error: Optional[str] = None
    timestamp: str


async def check_rate_limit(client_ip: str) -> bool:
    """
    Check if client is within rate limit.
    
    Returns True if allowed, False if rate limited.
    """
    async with _rate_limit_lock:
        now = asyncio.get_event_loop().time()
        
        if client_ip not in _rate_limits:
            _rate_limits[client_ip] = []
        
        # Remove expired entries
        _rate_limits[client_ip] = [
            t for t in _rate_limits[client_ip]
            if now - t < RATE_LIMIT_WINDOW
        ]
        
        if len(_rate_limits[client_ip]) >= RATE_LIMIT_REQUESTS:
            return False
        
        _rate_limits[client_ip].append(now)
        return True


def validate_text(text: str) -> tuple[bool, str]:
    """
    Validate text for TTS.
    
    Returns (is_valid, error_message_or_cleaned_text)
    """
    if not text or not text.strip():
        return False, "Text cannot be empty"
    
    # Check for dangerous characters (basic injection protection)
    dangerous_chars = ['<', '>', '&', '"', "'", '\\', '\x00']
    for char in dangerous_chars:
        if char in text:
            text = text.replace(char, '')
    
    if len(text) > MAX_TEXT_LENGTH:
        return False, f"Text too long (max {MAX_TEXT_LENGTH} characters)"
    
    return True, text.strip()


@router.get("/health")
async def tts_health():
    """TTS service health check."""
    service = get_tts_service()
    
    return {
        "status": "healthy",
        "engine": service.engine,
        "sample_rate": service.sample_rate,
        "supports_cloning": service.supports_cloning,
        "timestamp": datetime.now().isoformat()
    }


@router.post("/generate", response_model=TTSResponse)
async def generate_tts(request: TTSRequest, http_request: Request):
    """
    Generate TTS audio with viseme data.
    
    Returns base64-encoded audio and viseme timing data.
    """
    client_ip = http_request.client.host if http_request.client else "unknown"
    
    # Rate limiting
    if not await check_rate_limit(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded"
        )
    
    # Validate text
    is_valid, result = validate_text(request.text)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result
        )
    
    text = result
    service = get_tts_service()
    
    # Parse speaker profile from voice if it starts with 'clone:'
    speaker_profile_id = request.speaker_profile_id
    if request.voice.startswith("clone:"):
        speaker_profile_id = request.voice.replace("clone:", "")
    
    try:
        # Generate audio and visemes
        audio_bytes = await service.generate_audio(
            text, 
            request.voice if not speaker_profile_id else None,
            speaker_profile_id
        )
        visemes = service.generate_visemes(text)
        
        # Encode audio as base64
        import base64
        audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
        
        return TTSResponse(
            success=True,
            audio=audio_b64,
            visemes=visemes,
            timestamp=datetime.now().isoformat()
        )
        
    except Exception as e:
        logger.error(f"TTS generation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"TTS generation failed: {str(e)}"
        )


@router.post("/stream")
async def stream_tts(request: TTSRequest, http_request: Request):
    """
    Stream TTS audio chunks.
    
    Returns audio/wav streaming response with viseme data in headers.
    Chunked streaming minimizes latency for real-time applications.
    """
    client_ip = http_request.client.host if http_request.client else "unknown"
    
    # Rate limiting
    if not await check_rate_limit(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded"
        )
    
    # Validate text
    is_valid, result = validate_text(request.text)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result
        )
    
    text = result
    service = get_tts_service()
    
    # Parse speaker profile from voice if it starts with 'clone:'
    speaker_profile_id = request.speaker_profile_id
    if request.voice.startswith("clone:"):
        speaker_profile_id = request.voice.replace("clone:", "")
    
    # Generate visemes first (for header)
    visemes = service.generate_visemes(text)
    import json
    visemes_json = json.dumps(visemes)
    
    async def audio_generator():
        """Stream audio chunks with backpressure handling."""
        chunk_count = 0
        async for chunk in service.generate_audio_stream(
            text, 
            request.voice if not speaker_profile_id else None,
            speaker_profile_id
        ):
            chunk_count += 1
            yield chunk
            
            # Prevent memory bloat by limiting concurrent chunks
            if chunk_count > 1000:
                logger.warning("Streaming chunk limit reached")
                break
    
    return StreamingResponse(
        audio_generator(),
        media_type="audio/wav",
        headers={
            "X-Visemes": visemes_json,
            "X-Engine": service.engine,
            "X-Supports-Cloning": str(service.supports_cloning).lower(),
            "Cache-Control": "no-cache",
            "Transfer-Encoding": "chunked"
        }
    )


@router.post("/visemes")
async def generate_visemes(request: VisemeRequest):
    """
    Generate only viseme data (no audio).
    
    Useful for client-side preview or when audio is handled separately.
    """
    is_valid, result = validate_text(request.text)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result
        )
    
    text = result
    service = get_tts_service()
    visemes = service.generate_visemes(text)
    
    return {
        "success": True,
        "visemes": visemes,
        "count": len(visemes),
        "timestamp": datetime.now().isoformat()
    }


@router.post("/clone", response_model=VoiceCloningResponse)
async def clone_voice(
    http_request: Request,
    audio_file: UploadFile = File(..., description="Reference WAV file (3-30 seconds)"),
    profile_name: str = Form(..., min_length=1, max_length=100, description="Name for the voice profile")
):
    """
    Clone a voice from a reference audio file.
    
    Creates a local speaker profile that can be used for TTS generation.
    Requires Coqui XTTS engine for voice cloning functionality.
    
    Requirements:
    - WAV file format (mono or stereo)
    - 3-30 seconds duration
    - Clear speech with minimal background noise
    - Maximum 10MB file size
    """
    client_ip = http_request.client.host if http_request.client else "unknown"
    
    # Rate limiting (stricter for cloning)
    if not await check_rate_limit(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded"
        )
    
    service = get_tts_service()
    
    # Check if cloning is supported
    if not service.supports_cloning:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=f"Voice cloning not available with {service.engine} engine. "
                   "Install Coqui TTS (pip install TTS) for voice cloning support."
        )
    
    # Validate file type
    if not audio_file.filename or not audio_file.filename.lower().endswith('.wav'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only WAV files are supported for voice cloning"
        )
    
    # Read and validate file size
    audio_data = await audio_file.read()
    if len(audio_data) > MAX_AUDIO_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Audio file too large. Maximum size is {MAX_AUDIO_SIZE // (1024*1024)}MB"
        )
    
    if len(audio_data) < 1000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Audio file too small or empty"
        )
    
    # Clone the voice
    result = await service.clone_voice(
        audio_data=audio_data,
        profile_name=profile_name,
        source_filename=audio_file.filename
    )
    
    if not result["success"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.get("error", "Voice cloning failed")
        )
    
    return VoiceCloningResponse(
        success=True,
        profile=result["profile"],
        timestamp=datetime.now().isoformat()
    )


@router.get("/clone/profiles")
async def list_speaker_profiles():
    """List all cloned speaker profiles."""
    service = get_tts_service()
    profiles = service.list_speaker_profiles()
    
    return {
        "success": True,
        "profiles": profiles,
        "count": len(profiles),
        "supports_cloning": service.supports_cloning,
        "timestamp": datetime.now().isoformat()
    }


@router.delete("/clone/profiles/{profile_id}")
async def delete_speaker_profile(profile_id: str):
    """Delete a cloned speaker profile."""
    service = get_tts_service()
    
    success = await service.delete_speaker_profile(profile_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Speaker profile '{profile_id}' not found"
        )
    
    return {
        "success": True,
        "message": f"Profile '{profile_id}' deleted",
        "timestamp": datetime.now().isoformat()
    }


@router.get("/voices")
async def list_voices():
    """
    List available TTS voices.
    
    Includes:
    - Cloned speaker profiles (prefixed with 'clone:')
    - Built-in voices for the active engine
    """
    service = get_tts_service()
    
    try:
        voices = await service.list_voices()
        return {
            "success": True,
            "engine": service.engine,
            "supports_cloning": service.supports_cloning,
            "voices": voices,
            "count": len(voices),
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to list voices: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list voices: {str(e)}"
        )
