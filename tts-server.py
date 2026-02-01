"""
TTS Server - FastAPI Async Implementation
Converts blocking http.server to async FastAPI with streaming support
"""

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import AsyncGenerator, Optional
from datetime import datetime, timedelta
from collections import defaultdict
from loguru import logger
import asyncio
import base64
import json
import sys
import os
import edge_tts  # Async TTS library
import uvicorn

# Configure Loguru for structured file logging
# Remove default console handler to keep terminal clean
logger.remove()

# Ensure logs directory exists
logs_dir = os.path.join(os.path.dirname(__file__), 'logs')
os.makedirs(logs_dir, exist_ok=True)

# Add file handler with rotation
logger.add(
    os.path.join(logs_dir, "tts-server-{time:YYYY-MM-DD}.log"),
    rotation="1 day",
    retention="14 days",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
    level="INFO",
    serialize=False  # Set to True for JSON format
)

# Add error-only file for quick error review
logger.add(
    os.path.join(logs_dir, "tts-error-{time:YYYY-MM-DD}.log"),
    rotation="1 day",
    retention="14 days",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
    level="ERROR"
)

# Configuration
PORT = 8000
HOST = "localhost"
ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000'
]
MAX_TEXT_LENGTH = 1000
RATE_LIMIT_REQUESTS = 100
RATE_LIMIT_WINDOW = 60  # seconds

# Async-safe rate limiting storage
rate_limit_locks = defaultdict(asyncio.Lock)
rate_limit_storage = defaultdict(list)

# Viseme mapping for lip-sync
VISEME_MAP = {
    'a': 1, 'e': 2, 'i': 3, 'o': 4, 'u': 5,
    'b': 6, 'm': 6, 'p': 6, 'f': 7, 'v': 7, 'w': 8,
    'r': 8, 'l': 9, 'd': 10, 'n': 10, 't': 10, 's': 11,
    'z': 11, 'j': 12, 'ch': 12, 'sh': 13, 'k': 14,
    'g': 14, 'x': 14, 'y': 15, 'h': 16
}

# FastAPI app initialization
app = FastAPI(
    title="AI Companion TTS Server",
    description="Async text-to-speech with streaming audio and viseme generation",
    version="2.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["POST", "OPTIONS", "GET"],
    allow_headers=["*"],
)


# Startup event to launch background cleanup task
@app.on_event("startup")
async def start_background_tasks():
    """Start background tasks on application startup."""
    # Start rate limit cleanup task to prevent memory leaks
    asyncio.create_task(cleanup_stale_rate_limits())
    logger.info("Background rate limit cleanup task started")


# Pydantic models for request/response validation
class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH, description="Text to synthesize")
    stream: bool = Field(default=True, description="Enable streaming audio chunks")
    voice: str = Field(default="en-US-AriaNeural", description="Voice ID for TTS")


class TTSResponse(BaseModel):
    success: bool
    audio: Optional[str] = None  # Base64 encoded (for non-streaming)
    visemes: list[dict]
    timestamp: str


# Async helper functions
async def check_rate_limit_async(client_ip: str) -> tuple[bool, Optional[str]]:
    """
    Thread-safe async rate limiting with sliding window.
    Allows 100 requests per 60 seconds per IP.
    """
    async with rate_limit_locks[client_ip]:
        now = datetime.now()
        window_start = now - timedelta(seconds=RATE_LIMIT_WINDOW)
        
        # Clean old requests outside the window
        rate_limit_storage[client_ip] = [
            req_time for req_time in rate_limit_storage[client_ip]
            if req_time > window_start
        ]
        
        # Check if limit exceeded
        if len(rate_limit_storage[client_ip]) >= RATE_LIMIT_REQUESTS:
            remaining_time = int((rate_limit_storage[client_ip][0] - window_start).total_seconds())
            return False, f"Rate limit exceeded. Try again in {remaining_time} seconds."
        
        # Record this request
        rate_limit_storage[client_ip].append(now)
        return True, None


async def cleanup_stale_rate_limits():
    """
    Background task to clean up stale IP entries from rate limiting storage.
    Removes entries that have been inactive for more than 60 seconds.
    This prevents memory leaks from accumulating IP addresses.
    """
    while True:
        await asyncio.sleep(60)  # Run every 60 seconds
        try:
            now = datetime.now()
            stale_threshold = now - timedelta(seconds=RATE_LIMIT_WINDOW)
            
            # Find IPs with no recent requests
            stale_ips = [
                ip for ip, timestamps in list(rate_limit_storage.items())
                if not timestamps or all(t < stale_threshold for t in timestamps)
            ]
            
            # Clean up stale entries
            for ip in stale_ips:
                if ip in rate_limit_storage:
                    del rate_limit_storage[ip]
                if ip in rate_limit_locks:
                    del rate_limit_locks[ip]
            
            if stale_ips:
                logger.debug(f"Cleaned {len(stale_ips)} stale rate limit entries")
                
        except Exception as e:
            logger.error(f"Error in rate limit cleanup: {e}")


def validate_text_sync(text: str) -> tuple[bool, str]:
    """
    Synchronous text validation (CPU-bound, minimal).
    Returns (is_valid, result_or_error_message).
    
    Security: Only blocks dangerous HTML/shell injection characters.
    Preserves linguistic punctuation like apostrophes and quotes.
    """
    if not text or not isinstance(text, str):
        return False, "Text is required and must be a string"
    
    if len(text) > MAX_TEXT_LENGTH:
        return False, f"Text too long (max {MAX_TEXT_LENGTH} characters)"
    
    # Only block dangerous HTML/shell characters: < > `
    # Preserve apostrophes (') and quotes (") for natural language
    import re
    dangerous_chars = re.compile(r'[<>`]')
    if dangerous_chars.search(text):
        return False, "Text contains potentially dangerous characters (< > `)"
    
    return True, text


async def validate_text_async(text: str) -> tuple[bool, str]:
    """
    Async wrapper for text validation (runs in thread pool if needed).
    """
    # For simple validation, we can run directly
    # For heavy processing, use: asyncio.get_event_loop().run_in_executor()
    return validate_text_sync(text)


def generate_visemes_sync(text: str) -> list[dict]:
    """
    Synchronous viseme generation from text.
    Maps phonemes to viseme indices for lip-sync animation.
    """
    visemes = []
    text_lower = text.lower()
    time_step = 0.05  # 50ms per character
    
    for i, char in enumerate(text_lower):
        if char in VISEME_MAP:
            value = VISEME_MAP[char]
            duration = 0.1
        elif char.isspace():
            value = 0
            duration = 0.05
        else:
            value = 0
            duration = 0.05
        
        visemes.append({
            "time": i * time_step,
            "value": value,
            "duration": duration
        })
    
    return visemes


async def generate_visemes_async(text: str) -> list[dict]:
    """
    Async viseme generation wrapper.
    For long text, runs in thread pool to avoid blocking.
    """
    if len(text) > 500:
        # Run CPU-bound work in thread pool for long text
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, generate_visemes_sync, text)
    else:
        # Short text - run directly
        return generate_visemes_sync(text)


async def generate_audio_stream(
    text: str, 
    voice: str = "en-US-AriaNeural"
) -> AsyncGenerator[bytes, None]:
    """
    Stream audio chunks in real-time using edge-tts.
    Yields audio data as it becomes available (no blocking!).
    """
    try:
        logger.info(f"Starting async TTS stream for text ({len(text)} chars)")
        
        # Create TTS communicator (fully async)
        communicate = edge_tts.Communicate(text, voice=voice)
        
        # Stream audio chunks as they arrive
        chunk_count = 0
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunk_count += 1
                yield chunk["data"]
                
                # Log progress every 10 chunks
                if chunk_count % 10 == 0:
                    logger.debug(f"Streamed {chunk_count} audio chunks")
                
                # Small yield to allow other requests
                await asyncio.sleep(0)
        
        logger.info(f"TTS stream complete: {chunk_count} chunks generated")
        
    except Exception as e:
        logger.error(f"TTS streaming error: {e}")
        raise


async def generate_full_audio_base64(
    text: str, 
    voice: str = "en-US-AriaNeural"
) -> str:
    """
    Generate complete audio and return as base64 (for non-streaming mode).
    Still uses async internally but buffers for compatibility.
    """
    audio_chunks = []
    
    async for chunk in generate_audio_stream(text, voice):
        audio_chunks.append(chunk)
    
    # Combine chunks
    full_audio = b''.join(audio_chunks)
    return base64.b64encode(full_audio).decode('utf-8')


# API Endpoints

@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "online",
        "service": "AI Companion TTS Server",
        "version": "2.0.0",
        "mode": "async",
        "timestamp": datetime.now().isoformat()
    }


@app.get("/health")
async def health_check():
    """Detailed health check with system status."""
    return {
        "status": "healthy",
        "uptime": "running",
        "concurrent_requests_supported": True,
        "streaming_enabled": True,
        "timestamp": datetime.now().isoformat()
    }


@app.post("/generate")
async def generate_tts(request: TTSRequest, http_request: Request):
    """
    Generate TTS audio with viseme data.
    
    **Two modes:**
    - `stream=True` (default): Returns StreamingResponse with audio chunks
    - `stream=False`: Returns complete base64-encoded audio
    
    **Rate Limiting:** 100 requests per 60 seconds per IP
    
    **Request Body:**
    - text: Text to synthesize (max 1000 chars)
    - stream: Enable streaming (default: true)
    - voice: Voice ID (default: "en-US-AriaNeural")
    
    **Response:**
    - Streaming: audio/wav stream
    - Non-streaming: JSON with base64 audio + visemes
    """
    
    # Get client IP for rate limiting
    client_ip = http_request.client.host
    
    # Check rate limit (async-safe)
    allowed, error_msg = await check_rate_limit_async(client_ip)
    if not allowed:
        logger.warning(f"Rate limit exceeded for IP: {client_ip}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=error_msg
        )
    
    # Validate text (async)
    is_valid, result = await validate_text_async(request.text)
    if not is_valid:
        logger.warning(f"Invalid text from IP {client_ip}: {result}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result
        )
    
    text = result
    logger.info(f"Processing TTS request: {len(text)} characters (streaming={request.stream})")
    
    # Generate visemes (async)
    visemes = await generate_visemes_async(text)
    
    if request.stream:
        # STREAMING MODE: Stream audio chunks immediately
        # This prevents UI freezing - first chunk arrives in ~100-500ms
        
        async def stream_with_metadata() -> AsyncGenerator[bytes, None]:
            """Stream audio with viseme metadata in headers sent first."""
            # First, we need to send visemes somehow
            # Option: Use multipart or send as first chunk with header
            # For simplicity, client should call /generate-visemes first
            async for chunk in generate_audio_stream(text, request.voice):
                yield chunk
        
        return StreamingResponse(
            stream_with_metadata(),
            media_type="audio/wav",
            headers={
                "X-Viseme-Count": str(len(visemes)),
                "X-Text-Length": str(len(text)),
                "X-Stream-Mode": "true",
                "Cache-Control": "no-cache"
            }
        )
    
    else:
        # NON-STREAMING MODE: Generate complete audio (backward compatibility)
        logger.info("Using non-streaming mode (backward compatibility)")
        
        try:
            audio_b64 = await generate_full_audio_base64(text, request.voice)
            
            return TTSResponse(
                success=True,
                audio=audio_b64,
                visemes=visemes,
                timestamp=datetime.now().isoformat()
            )
        
        except Exception as e:
            logger.error(f"TTS generation error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"TTS generation failed: {str(e)}"
            )


@app.post("/generate-stream")
async def generate_tts_stream(request: TTSRequest, http_request: Request):
    """
    Advanced streaming endpoint with integrated viseme timing.
    
    Streams audio chunks with embedded viseme indices for real-time lip-sync.
    Format: [4-byte viseme index][audio chunk data]
    
    This enables true real-time lip-sync where audio and visemes are synchronized.
    """
    
    # Rate limiting
    client_ip = http_request.client.host
    allowed, error_msg = await check_rate_limit_async(client_ip)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=error_msg
        )
    
    # Validation
    is_valid, result = await validate_text_async(request.text)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result
        )
    
    text = result
    
    # Pre-calculate visemes
    visemes = await generate_visemes_async(text)
    
    async def stream_with_visemes() -> AsyncGenerator[bytes, None]:
        """
        Stream audio with embedded viseme indices.
        Each chunk: [4 bytes: viseme index][audio data]
        """
        chunk_duration = 0.1  # 100ms per chunk estimate
        current_time = 0.0
        viseme_idx = 0
        
        async for audio_chunk in generate_audio_stream(text, request.voice):
            # Find current viseme for this time point
            while (viseme_idx < len(visemes) - 1 and 
                   visemes[viseme_idx + 1]["time"] <= current_time):
                viseme_idx += 1
            
            # Create header with viseme index (4 bytes, little-endian)
            header = viseme_idx.to_bytes(4, byteorder='little')
            
            # Yield: header + audio data
            yield header + audio_chunk
            
            current_time += chunk_duration
            await asyncio.sleep(0)  # Yield control
    
    return StreamingResponse(
        stream_with_visemes(),
        media_type="application/octet-stream",
        headers={
            "X-Viseme-Count": str(len(visemes)),
            "X-Text-Length": str(len(text)),
            "X-Stream-Format": "viseme-index-4bytes-audio",
            "Cache-Control": "no-cache"
        }
    )


@app.post("/generate-visemes")
async def generate_visemes_endpoint(request: TTSRequest):
    """
    Generate only viseme data (no audio).
    Useful for client-side preview or when audio is handled separately.
    """
    is_valid, result = await validate_text_async(request.text)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result
        )
    
    visemes = await generate_visemes_async(result)
    
    return {
        "success": True,
        "text": result,
        "visemes": visemes,
        "count": len(visemes),
        "timestamp": datetime.now().isoformat()
    }


@app.get("/voices")
async def list_voices():
    """
    List available TTS voices from edge-tts.
    """
    try:
        voices = await edge_tts.list_voices()
        return {
            "success": True,
            "voices": voices,
            "count": len(voices)
        }
    except Exception as e:
        logger.error(f"Error listing voices: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list voices: {str(e)}"
        )


# Error handlers
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global error handler for uncaught exceptions."""
    # Log full error details internally
    logger.error(f"Global error: {exc}", exc_info=True)
    
    # Return generic message to client - do not expose internal details
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": "Internal server error",
            "timestamp": datetime.now().isoformat()
        }
    )


if __name__ == "__main__":
    print(f"🚀 Starting Async TTS Server on {HOST}:{PORT}")
    print(f"📖 API Documentation: http://{HOST}:{PORT}/docs")
    print(f"🔊 Streaming Audio: Enabled")
    print(f"⚡ Concurrent Requests: Supported")
    print(f"🎯 Max Text Length: {MAX_TEXT_LENGTH} characters")
    print(f"⏱️  Rate Limit: {RATE_LIMIT_REQUESTS} requests per {RATE_LIMIT_WINDOW} seconds")
    print("-" * 60)
    
    # Run with Uvicorn (ASGI server)
    # Use multiple workers for production: workers=4
    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="info",
        access_log=True
    )
