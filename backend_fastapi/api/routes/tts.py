"""
TTS API Router - Unified Text-to-Speech endpoints.

Migrated from standalone tts-server.py into unified FastAPI backend.
"""

import asyncio
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, status
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
MAX_TEXT_LENGTH = 1000


class TTSRequest(BaseModel):
    """TTS generation request."""
    text: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH)
    stream: bool = Field(default=False, description="Enable streaming audio")
    voice: str = Field(default="en-US-AriaNeural", description="Voice ID")


class TTSResponse(BaseModel):
    """TTS generation response."""
    success: bool
    audio: Optional[str] = None  # Base64 encoded audio
    visemes: list[dict] = []
    timestamp: str


class VisemeRequest(BaseModel):
    """Viseme-only generation request."""
    text: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH)


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
    
    try:
        # Generate audio and visemes
        audio_bytes = await service.generate_audio(text, request.voice)
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
    
    # Generate visemes first (for header)
    visemes = service.generate_visemes(text)
    import json
    visemes_json = json.dumps(visemes)
    
    async def audio_generator():
        async for chunk in service.generate_audio_stream(text, request.voice):
            yield chunk
    
    return StreamingResponse(
        audio_generator(),
        media_type="audio/wav",
        headers={
            "X-Visemes": visemes_json,
            "X-Engine": service.engine,
            "Cache-Control": "no-cache"
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


@router.get("/voices")
async def list_voices():
    """List available TTS voices."""
    service = get_tts_service()
    
    try:
        voices = await service.list_voices()
        return {
            "success": True,
            "engine": service.engine,
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
