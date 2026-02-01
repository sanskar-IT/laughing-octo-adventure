"""
Chat API Routes.
Handles streaming chat with LLM and sentence-level TTS triggering.
"""

import asyncio
from datetime import datetime
from typing import Any, AsyncGenerator

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend_fastapi.api.deps import (
    CharacterManagerDep,
    CurrentUserDep,
    LLMServiceDep,
    RateLimitDep,
    SettingsDep,
)
from backend_fastapi.core.security import sanitize_chat_message, sanitize_model_identifier
from backend_fastapi.utils.logger import get_logger, log_stream

logger = get_logger("chat")
router = APIRouter(prefix="/chat", tags=["chat"])


class ChatMessage(BaseModel):
    """Chat message model."""
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., min_length=1, max_length=32000)


class ChatRequest(BaseModel):
    """Chat request model."""
    messages: list[ChatMessage]
    model: str | None = Field(default=None, max_length=100)
    character_id: str | None = Field(default=None, max_length=50)
    conversation_id: str | None = Field(default="default-session", max_length=50)
    stream: bool = Field(default=True)
    enable_tts: bool = Field(default=True)


class ChatResponse(BaseModel):
    """Non-streaming chat response."""
    success: bool
    content: str
    provider: str
    model: str
    usage: dict[str, Any] | None = None
    timestamp: str


async def trigger_tts_for_sentence(
    sentence: str,
    settings: Any,
    http_client: httpx.AsyncClient
) -> None:
    """
    Trigger TTS synthesis for a completed sentence.
    This is called asynchronously to not block the main stream.
    
    Args:
        sentence: Completed sentence to synthesize
        settings: Application settings
        http_client: HTTP client for TTS requests
    """
    try:
        tts_url = f"http://{settings.tts.host}:{settings.tts.port}/generate"
        
        await http_client.post(
            tts_url,
            json={
                "text": sentence,
                "stream": True,
                "voice": settings.tts.voice_id
            },
            timeout=30.0
        )
        log_stream("tts_trigger", f"TTS triggered for: {sentence[:50]}...")
    except Exception as e:
        logger.warning(f"TTS trigger failed: {e}")


@router.post("/stream")
async def stream_chat(
    request: ChatRequest,
    http_request: Request,
    llm_service: LLMServiceDep,
    character_manager: CharacterManagerDep,
    settings: SettingsDep,
    rate_limit: RateLimitDep,
    current_user: CurrentUserDep
):
    """
    Stream chat response with sentence-level TTS triggering.
    
    This endpoint implements zero-latency audio-visual sync by:
    1. Streaming tokens from the LLM
    2. Detecting sentence/clause boundaries
    3. Triggering TTS synthesis on the first completed sentence
    4. Continuing to stream remaining content
    
    **Request Body:**
    - messages: Array of chat messages
    - model: Optional model override
    - character_id: Optional character to use
    - conversation_id: Conversation session ID
    - stream: Enable streaming (default: true)
    - enable_tts: Enable sentence-level TTS (default: true)
    
    **Response:**
    Server-Sent Events (SSE) stream with events:
    - provider_connected: Initial connection info
    - content: Text chunk
    - sentence_complete: A sentence is ready for TTS
    - done: Stream complete
    - error: Error occurred
    """
    # Sanitize messages
    sanitized_messages = []
    for msg in request.messages:
        sanitized = sanitize_chat_message({"role": msg.role, "content": msg.content})
        if sanitized:
            sanitized_messages.append(sanitized)
    
    if not sanitized_messages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid messages after sanitization"
        )
    
    # Validate model if provided
    model = None
    if request.model:
        model = sanitize_model_identifier(request.model)
        if not model:
            logger.warning(f"Invalid model format: {request.model}")
    
    # Load character if specified
    system_prompt = None
    character_name = None
    if request.character_id:
        try:
            character = await character_manager.load_character(request.character_id)
            system_prompt = character.system_prompt
            character_name = character.name
        except FileNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Character not found: {request.character_id}"
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
    elif character_manager.active_character:
        system_prompt = character_manager.get_system_prompt()
        character_name = character_manager.active_character.name
    
    # Get CORS origin
    origin = http_request.headers.get("origin", settings.security.allowed_origins[0])
    if origin not in settings.security.allowed_origins:
        origin = settings.security.allowed_origins[0]
    
    async def generate_sse() -> AsyncGenerator[str, None]:
        """Generate Server-Sent Events."""
        try:
            # Check provider connection
            health = await llm_service.check_connection(model)
            
            if not health["connected"]:
                yield f"event: error\ndata: {{\n"
                yield f'  "type": "provider_offline",\n'
                yield f'  "provider": "{health["provider"]}",\n'
                yield f'  "error": "{health.get("error", "Provider unavailable")}",\n'
                yield f'  "timestamp": "{datetime.now().isoformat()}"\n'
                yield f"}}\n\n"
                return
            
            # Send connection event
            yield f"event: provider_connected\ndata: {{\n"
            yield f'  "provider": "{health["provider"]}",\n'
            yield f'  "type": "{health["type"]}",\n'
            yield f'  "character": {f\'"{character_name}"\' if character_name else "null"},\n'
            yield f'  "timestamp": "{datetime.now().isoformat()}"\n'
            yield f"}}\n\n"
            
            # Create HTTP client for TTS
            http_client = httpx.AsyncClient() if request.enable_tts else None
            
            try:
                # Define TTS callback
                async def on_sentence(sentence: str):
                    if http_client:
                        await trigger_tts_for_sentence(sentence, settings, http_client)
                
                # Stream with sentence chunking
                chunk_count = 0
                full_content = ""
                
                async for chunk in llm_service.generate_stream_with_sentence_chunking(
                    sanitized_messages,
                    model,
                    system_prompt,
                    on_sentence if request.enable_tts else None
                ):
                    if chunk["type"] == "content":
                        chunk_count += 1
                        content = chunk.get("content", "")
                        full_content += content
                        
                        # Build content event
                        event_data = {
                            "content": content,
                            "provider": chunk["provider"],
                            "chunk_index": chunk_count,
                            "timestamp": datetime.now().isoformat()
                        }
                        
                        # Add sentence info if available
                        if chunk.get("sentence_complete"):
                            event_data["sentence_complete"] = True
                            event_data["sentence"] = chunk.get("sentence", "")
                        
                        yield f"event: content\ndata: {{\n"
                        for key, value in event_data.items():
                            if isinstance(value, bool):
                                yield f'  "{key}": {str(value).lower()},\n'
                            elif isinstance(value, int):
                                yield f'  "{key}": {value},\n'
                            else:
                                yield f'  "{key}": "{value}",\n'
                        yield f"}}\n\n"
                    
                    elif chunk["type"] == "done":
                        yield f"event: done\ndata: {{\n"
                        yield f'  "provider": "{chunk["provider"]}",\n'
                        yield f'  "chunk_count": {chunk["chunk_count"]},\n'
                        yield f'  "full_content": "{full_content.replace(chr(34), chr(92) + chr(34)).replace(chr(10), chr(92) + "n")}",\n'
                        yield f'  "character": {f\'"{character_name}"\' if character_name else "null"},\n'
                        yield f'  "conversation_id": "{request.conversation_id}",\n'
                        yield f'  "timestamp": "{datetime.now().isoformat()}"\n'
                        yield f"}}\n\n"
                    
                    elif chunk["type"] == "error":
                        yield f"event: error\ndata: {{\n"
                        yield f'  "provider": "{chunk["provider"]}",\n'
                        yield f'  "error": "{chunk["error"]}",\n'
                        yield f'  "timestamp": "{datetime.now().isoformat()}"\n'
                        yield f"}}\n\n"
            
            finally:
                if http_client:
                    await http_client.aclose()
        
        except Exception as e:
            logger.exception(f"Stream error: {e}")
            yield f"event: fatal_error\ndata: {{\n"
            yield f'  "error": "{str(e)}",\n'
            yield f'  "timestamp": "{datetime.now().isoformat()}"\n'
            yield f"}}\n\n"
    
    return StreamingResponse(
        generate_sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "Cache-Control, Content-Type",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
        }
    )


@router.post("", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    llm_service: LLMServiceDep,
    character_manager: CharacterManagerDep,
    settings: SettingsDep,
    rate_limit: RateLimitDep,
    current_user: CurrentUserDep
):
    """
    Non-streaming chat endpoint (for backward compatibility).
    
    For best performance, use the /stream endpoint instead.
    """
    if request.stream:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use /stream endpoint for streaming responses"
        )
    
    # Sanitize messages
    sanitized_messages = []
    for msg in request.messages:
        sanitized = sanitize_chat_message({"role": msg.role, "content": msg.content})
        if sanitized:
            sanitized_messages.append(sanitized)
    
    if not sanitized_messages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid messages"
        )
    
    # Get system prompt from character
    system_prompt = character_manager.get_system_prompt() if character_manager.active_character else None
    
    # Collect full response
    full_content = ""
    final_chunk = None
    
    async for chunk in llm_service.generate_stream(
        sanitized_messages,
        request.model,
        system_prompt
    ):
        if chunk["type"] == "content":
            full_content += chunk.get("content", "")
        elif chunk["type"] == "done":
            final_chunk = chunk
        elif chunk["type"] == "error":
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=chunk["error"]
            )
    
    return ChatResponse(
        success=True,
        content=full_content,
        provider=final_chunk["provider"] if final_chunk else "unknown",
        model=request.model or llm_service.active_model,
        usage=final_chunk.get("usage") if final_chunk else None,
        timestamp=datetime.now().isoformat()
    )


@router.post("/switch")
async def switch_model(
    new_model: str,
    llm_service: LLMServiceDep,
    current_user: CurrentUserDep
):
    """
    Switch the active LLM model.
    
    Args:
        new_model: Model identifier (e.g., 'ollama/llama3.2')
    """
    model = sanitize_model_identifier(new_model)
    if not model:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid model format"
        )
    
    if llm_service.switch_model(model):
        return {
            "success": True,
            "message": f"Switched to {model}",
            "active_model": model,
            "timestamp": datetime.now().isoformat()
        }
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to switch to {model}"
        )
