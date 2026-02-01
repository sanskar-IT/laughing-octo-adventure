"""
AI Companion Backend - FastAPI Main Application.
Production-ready async backend with LiteLLM integration.
"""

from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from backend_fastapi.api.routes import chat, characters, models, tts
from backend_fastapi.core.config import get_settings
from backend_fastapi.core.security import get_csp_headers
from backend_fastapi.services.litellm_service import get_litellm_service
from backend_fastapi.services.character_service import get_character_manager
from backend_fastapi.services.tts_service import get_tts_service
from backend_fastapi.utils.logger import get_logger, log_error

logger = get_logger("main")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.
    Handles startup and shutdown events.
    """
    # Startup
    logger.info(f"Starting AI Companion Backend v{settings.app.version}")
    logger.info(f"Environment: {settings.app.environment}")
    logger.info(f"Active LLM: {settings.llm.active_provider}")
    
    # Initialize services
    llm_service = get_litellm_service()
    character_manager = get_character_manager()
    tts_service = get_tts_service()
    
    # Initialize TTS engine
    tts_initialized = await tts_service.initialize()
    if tts_initialized:
        logger.info(f"TTS Engine: {tts_service.engine}")
    else:
        logger.warning("TTS Engine failed to initialize")
    
    # Check LLM connection
    health = await llm_service.check_connection()
    if health["connected"]:
        logger.info(f"LLM Provider connected: {health['provider']} ({health['type']})")
    else:
        logger.warning(f"LLM Provider offline: {health.get('error', 'Unknown error')}")
    
    yield
    
    # Shutdown
    logger.info("Shutting down AI Companion Backend")
    await llm_service.close()
    await tts_service.close()


# Create FastAPI application
app = FastAPI(
    title="AI Companion Backend",
    description="Privacy-focused, locally-hosted AI companion with Live2D integration",
    version=settings.app.version,
    lifespan=lifespan,
    docs_url="/docs" if settings.app.environment == "development" else None,
    redoc_url="/redoc" if settings.app.environment == "development" else None
)


# Security headers middleware
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        # Add CSP and security headers
        csp_headers = get_csp_headers()
        for header, value in csp_headers.items():
            response.headers[header] = value
        
        return response


# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.security.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Add security headers
app.add_middleware(SecurityHeadersMiddleware)


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle uncaught exceptions."""
    log_error(exc, context=f"{request.method} {request.url.path}")
    
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": "Internal server error",
            "detail": str(exc) if settings.app.environment == "development" else None,
            "timestamp": datetime.now().isoformat()
        }
    )


# Include routers
app.include_router(chat.router, prefix="/api")
app.include_router(characters.router, prefix="/api")
app.include_router(models.router, prefix="/api")
app.include_router(tts.router, prefix="/api")


# Root endpoints
@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "online",
        "service": "AI Companion Backend",
        "version": settings.app.version,
        "timestamp": datetime.now().isoformat()
    }


@app.get("/health")
async def health_check():
    """Detailed health check."""
    llm_service = get_litellm_service()
    tts_service = get_tts_service()
    health = await llm_service.check_connection()
    
    return {
        "status": "healthy",
        "version": settings.app.version,
        "environment": settings.app.environment,
        "llm": {
            "provider": health["provider"],
            "connected": health["connected"],
            "type": health["type"]
        },
        "tts": {
            "engine": tts_service.engine,
            "sample_rate": tts_service.sample_rate
        },
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/status")
async def api_status():
    """API status endpoint (backward compatibility with Express)."""
    llm_service = get_litellm_service()
    health = await llm_service.check_connection()
    
    return {
        "status": "online",
        "active_model": llm_service.active_model,
        "active_provider": health["provider"],
        "configuration": {
            "max_tokens": settings.llm.max_tokens,
            "temperature": settings.llm.temperature
        },
        "timestamp": datetime.now().isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    
    print(f"🚀 Starting AI Companion Backend on http://localhost:{settings.app.port}")
    print(f"📖 API Documentation: http://localhost:{settings.app.port}/docs")
    print(f"🔒 Security: CSP and rate limiting enabled")
    print(f"🤖 LLM Provider: {settings.llm.active_provider}")
    print("-" * 60)
    
    uvicorn.run(
        "backend_fastapi.main:app",
        host="0.0.0.0",
        port=settings.app.port,
        reload=settings.app.environment == "development",
        log_level="info"
    )
