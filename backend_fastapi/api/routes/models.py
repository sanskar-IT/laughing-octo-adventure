"""
Models API Routes.
Handles listing available LLM models and provider status.
"""

from datetime import datetime

from fastapi import APIRouter

from backend_fastapi.api.deps import CurrentUserDep, LLMServiceDep, SettingsDep
from backend_fastapi.utils.logger import get_logger

logger = get_logger("models")
router = APIRouter(prefix="/models", tags=["models"])


@router.get("")
async def list_models(
    llm_service: LLMServiceDep,
    settings: SettingsDep,
    current_user: CurrentUserDep
):
    """
    List all available LLM models from configured providers.
    
    Returns models from:
    - Ollama (local)
    - LM Studio (local)
    - OpenAI (cloud, if API key configured)
    - Anthropic (cloud, if API key configured)
    """
    models = await llm_service.get_available_models()
    
    return {
        "success": True,
        "data": models,
        "count": len(models),
        "active_model": llm_service.active_model,
        "timestamp": datetime.now().isoformat()
    }


@router.get("/status")
async def get_status(
    llm_service: LLMServiceDep,
    settings: SettingsDep,
    current_user: CurrentUserDep
):
    """
    Get the status of all configured providers.
    
    Returns connection status for each provider and the active model.
    """
    # Check active provider
    active_health = await llm_service.check_connection()
    
    # Get all available models (includes health check)
    available_models = await llm_service.get_available_models()
    
    # Group by provider
    providers = {}
    for model in available_models:
        provider = model["provider"]
        if provider not in providers:
            providers[provider] = {
                "name": provider,
                "type": model["type"],
                "models": [],
                "connected": True  # If we see models, it's connected
            }
        providers[provider]["models"].append(model["name"])
    
    return {
        "status": "online",
        "active_model": llm_service.active_model,
        "active_provider": {
            "connected": active_health["connected"],
            "type": active_health["type"],
            "details": active_health.get("details", {})
        },
        "providers": list(providers.values()),
        "configuration": {
            "max_tokens": settings.llm.max_tokens,
            "temperature": settings.llm.temperature,
            "timeout_ms": settings.llm.timeout
        },
        "timestamp": datetime.now().isoformat()
    }


@router.post("/switch")
async def switch_model(
    new_model: str,
    llm_service: LLMServiceDep,
    current_user: CurrentUserDep
):
    """
    Switch the active LLM model.
    
    Args:
        new_model: Model identifier (e.g., 'ollama/llama3.2', 'openai/gpt-4o')
    """
    success = llm_service.switch_model(new_model)
    
    if success:
        # Verify connection
        health = await llm_service.check_connection(new_model)
        
        return {
            "success": True,
            "message": f"Switched to {new_model}",
            "active_model": new_model,
            "connected": health["connected"],
            "timestamp": datetime.now().isoformat()
        }
    else:
        return {
            "success": False,
            "error": f"Failed to switch to {new_model}",
            "active_model": llm_service.active_model,
            "timestamp": datetime.now().isoformat()
        }
