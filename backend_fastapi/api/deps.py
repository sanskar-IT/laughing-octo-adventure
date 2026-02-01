"""
API Dependencies.
Provides dependency injection for services, authentication, and rate limiting.
"""

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Annotated, Optional

import asyncio
from fastapi import Depends, HTTPException, Request, status

from backend_fastapi.core.config import Settings, get_settings
from backend_fastapi.core.security import validate_character_id
from backend_fastapi.services.character_service import CharacterManager, get_character_manager
from backend_fastapi.services.litellm_service import LiteLLMService, get_litellm_service
from backend_fastapi.utils.logger import get_logger

logger = get_logger("deps")

# Rate limiting storage (async-safe)
rate_limit_locks = defaultdict(asyncio.Lock)
rate_limit_storage = defaultdict(list)


async def get_db():
    """Database session dependency (placeholder for SQLite/SQLAlchemy)."""
    # TODO: Implement database session management
    pass


def get_settings_dep() -> Settings:
    """Settings dependency."""
    return get_settings()


def get_llm_service_dep() -> LiteLLMService:
    """LiteLLM service dependency."""
    return get_litellm_service()


def get_character_manager_dep() -> CharacterManager:
    """Character manager dependency."""
    return get_character_manager()


async def check_rate_limit(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings_dep)]
) -> bool:
    """
    Rate limiting dependency.
    Limits requests per IP based on configuration.
    
    Args:
        request: FastAPI request
        settings: Application settings
        
    Returns:
        True if request is allowed
        
    Raises:
        HTTPException: If rate limit exceeded
    """
    client_ip = request.client.host if request.client else "unknown"
    max_requests = settings.security.rate_limit_requests
    window_seconds = settings.security.rate_limit_window
    
    async with rate_limit_locks[client_ip]:
        now = datetime.now()
        window_start = now - timedelta(seconds=window_seconds)
        
        # Clean old requests
        rate_limit_storage[client_ip] = [
            req_time for req_time in rate_limit_storage[client_ip]
            if req_time > window_start
        ]
        
        # Check limit
        if len(rate_limit_storage[client_ip]) >= max_requests:
            remaining_time = int(
                (rate_limit_storage[client_ip][0] - window_start).total_seconds()
            )
            logger.warning(f"Rate limit exceeded for IP: {client_ip}")
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Try again in {remaining_time} seconds."
            )
        
        # Record request
        rate_limit_storage[client_ip].append(now)
        return True


async def get_current_user(
    request: Request,
) -> Optional[dict]:
    """
    Get current user from request (placeholder for JWT auth).
    For local-first app, returns a default user.
    
    Args:
        request: FastAPI request
        
    Returns:
        User dictionary or None
    """
    # For local-first application, we use a default local user
    # In production, this would validate JWT tokens
    return {
        "username": "local_user",
        "is_authenticated": True
    }


async def validate_character_id_param(character_id: str) -> str:
    """
    Validate character ID path parameter.
    
    Args:
        character_id: Character ID from path
        
    Returns:
        Validated character ID
        
    Raises:
        HTTPException: If ID format is invalid
    """
    if not validate_character_id(character_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid character ID format"
        )
    return character_id


# Type aliases for dependency injection
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
LLMServiceDep = Annotated[LiteLLMService, Depends(get_llm_service_dep)]
CharacterManagerDep = Annotated[CharacterManager, Depends(get_character_manager_dep)]
RateLimitDep = Annotated[bool, Depends(check_rate_limit)]
CurrentUserDep = Annotated[Optional[dict], Depends(get_current_user)]
