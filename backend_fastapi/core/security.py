"""
Security utilities for the AI Companion backend.
Includes output sanitization, CSP headers, and prompt injection prevention.
"""

import html
import re
from typing import Any

import bleach


# Allowed HTML tags for sanitized output (very restrictive)
ALLOWED_TAGS: list[str] = []
ALLOWED_ATTRIBUTES: dict[str, list[str]] = {}

# Patterns that could indicate prompt injection or script execution
DANGEROUS_PATTERNS = [
    r"<script[^>]*>.*?</script>",  # Script tags
    r"javascript:",  # JavaScript protocol
    r"on\w+\s*=",  # Event handlers (onclick, onerror, etc.)
    r"<iframe[^>]*>",  # iframes
    r"<object[^>]*>",  # Object embeds
    r"<embed[^>]*>",  # Embed tags
    r"<link[^>]*>",  # Link tags (potential CSS injection)
    r"<style[^>]*>.*?</style>",  # Style tags
    r"expression\s*\(",  # CSS expressions
    r"url\s*\(\s*['\"]?\s*javascript:",  # CSS JavaScript URLs
    r"data:text/html",  # Data URLs with HTML
    r"vbscript:",  # VBScript protocol
    r"\{\{.*\}\}",  # Template injection
    r"\$\{.*\}",  # Template literals
    r"<!--.*-->",  # HTML comments (can hide attacks)
]

# Compiled patterns for efficiency
COMPILED_DANGEROUS_PATTERNS = [
    re.compile(pattern, re.IGNORECASE | re.DOTALL) 
    for pattern in DANGEROUS_PATTERNS
]


def sanitize_llm_output(text: str) -> str:
    """
    Sanitize LLM output to prevent prompt injection and XSS attacks.
    This is critical for preventing malicious content from executing
    in the Live2D WebGL context.
    
    Args:
        text: Raw LLM output text
        
    Returns:
        Sanitized text safe for frontend rendering
    """
    if not text:
        return ""
    
    # Step 1: Remove dangerous patterns
    sanitized = text
    for pattern in COMPILED_DANGEROUS_PATTERNS:
        sanitized = pattern.sub("", sanitized)
    
    # Step 2: HTML escape any remaining angle brackets
    sanitized = html.escape(sanitized, quote=True)
    
    # Step 3: Use bleach for additional sanitization
    sanitized = bleach.clean(
        sanitized,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        strip=True
    )
    
    # Step 4: Remove any null bytes or other control characters
    sanitized = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", sanitized)
    
    return sanitized


def sanitize_user_input(text: str, max_length: int = 10000) -> str:
    """
    Sanitize user input before processing.
    
    Args:
        text: Raw user input
        max_length: Maximum allowed length
        
    Returns:
        Sanitized input
    """
    if not text:
        return ""
    
    # Truncate to max length
    text = text[:max_length]
    
    # Remove null bytes and control characters
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    
    return text.strip()


def sanitize_model_identifier(model: str) -> str | None:
    """
    Validate and sanitize model identifier.
    
    Args:
        model: Model identifier string
        
    Returns:
        Sanitized model string or None if invalid
    """
    if not model:
        return None
    
    # Only allow alphanumeric, slashes, underscores, hyphens, and dots
    if not re.match(r"^[a-zA-Z0-9/_.-]+$", model):
        return None
    
    # Max length check
    if len(model) > 100:
        return None
    
    return model


def sanitize_conversation_id(conversation_id: str) -> str:
    """
    Validate and sanitize conversation ID.
    
    Args:
        conversation_id: Conversation ID string
        
    Returns:
        Sanitized ID or default value
    """
    if not conversation_id:
        return "default-session"
    
    # Only allow alphanumeric, underscores, and hyphens
    if not re.match(r"^[a-zA-Z0-9_-]+$", conversation_id):
        return "default-session"
    
    if len(conversation_id) > 50:
        return conversation_id[:50]
    
    return conversation_id


def validate_character_id(character_id: str) -> bool:
    """
    Validate character ID format (UUID).
    
    Args:
        character_id: Character ID to validate
        
    Returns:
        True if valid UUID format
    """
    if not character_id:
        return False
    
    # UUID format: 8-4-4-4-12 hex characters
    uuid_pattern = r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"
    return bool(re.match(uuid_pattern, character_id.lower()))


def get_csp_headers() -> dict[str, str]:
    """
    Get Content Security Policy headers for the application.
    
    Returns:
        Dictionary of CSP headers
    """
    csp_directives = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cubism.live2d.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* wss://localhost:*",
        "font-src 'self' data:",
        "object-src 'none'",
        "media-src 'self' blob:",
        "frame-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests"
    ]
    
    return {
        "Content-Security-Policy": "; ".join(csp_directives),
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-XSS-Protection": "1; mode=block",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "geolocation=(), microphone=(), camera=()"
    }


def sanitize_chat_message(message: dict[str, Any]) -> dict[str, Any] | None:
    """
    Sanitize a chat message object.
    
    Args:
        message: Chat message with 'role' and 'content' keys
        
    Returns:
        Sanitized message or None if invalid
    """
    if not isinstance(message, dict):
        return None
    
    role = message.get("role", "").strip().lower()
    content = message.get("content", "")
    
    # Validate role
    if role not in ("user", "assistant", "system"):
        return None
    
    # Sanitize content
    if not isinstance(content, str):
        return None
    
    sanitized_content = sanitize_user_input(content)
    if not sanitized_content:
        return None
    
    return {
        "role": role,
        "content": sanitized_content
    }
