"""
Models API Routes.
Handles listing available LLM models and provider status.
Also handles Live2D model upload with security controls.
"""

import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from backend_fastapi.api.deps import CurrentUserDep, LLMServiceDep, RateLimitDep, SettingsDep
from backend_fastapi.utils.logger import get_logger
from backend_fastapi.utils.secure_upload import (
    secure_extract_zip,
    validate_upload_file,
    ALLOWED_EXTENSIONS
)

logger = get_logger("models")
router = APIRouter(prefix="/models", tags=["models"])

# Live2D models directory
MODELS_DIR = Path("models")


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


@router.post("/upload")
async def upload_model(
    file: UploadFile = File(...),
    current_user: CurrentUserDep = None,
    rate_limit: RateLimitDep = None
):
    """
    Upload a Live2D model as a ZIP file.
    
    **Security controls:**
    - JWT authentication required
    - Rate limiting applied
    - ZIP bomb protection (max 200MB extracted)
    - Path traversal prevention
    - File extension whitelist
    
    Args:
        file: ZIP file containing Live2D model assets
        
    Returns:
        Upload result with extracted file count and model path
    """
    # Verify authentication
    if not current_user or not current_user.get("is_authenticated"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required for model upload"
        )
    
    # Validate file
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No filename provided"
        )
    
    if not file.filename.lower().endswith('.zip'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only ZIP files are accepted for model upload"
        )
    
    # Get file size (read into memory for small files, or use temp file)
    content = await file.read()
    file_size = len(content)
    
    # Validate upload
    error = await validate_upload_file(file.filename, file.content_type or "", file_size)
    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )
    
    # Save to temp file
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as tmp:
            tmp.write(content)
            tmp_path = Path(tmp.name)
        
        # Determine model name from filename
        model_name = Path(file.filename).stem
        
        # Sanitize model name (alphanumeric, underscore, hyphen only)
        import re
        model_name = re.sub(r'[^a-zA-Z0-9_-]', '_', model_name)
        
        if not model_name:
            model_name = "model"
        
        # Create extraction directory
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        extract_path = MODELS_DIR / model_name
        
        # Check if model already exists
        if extract_path.exists():
            # Add suffix to make unique
            counter = 1
            while (MODELS_DIR / f"{model_name}_{counter}").exists():
                counter += 1
            model_name = f"{model_name}_{counter}"
            extract_path = MODELS_DIR / model_name
        
        # Secure extraction
        result = await secure_extract_zip(tmp_path, extract_path)
        
        logger.info(
            f"Model uploaded by {current_user.get('username')}: "
            f"{model_name} ({result['file_count']} files, {result['total_size']}B)"
        )
        
        return {
            "success": True,
            "model_id": model_name,
            "model_path": str(extract_path),
            "file_count": result["file_count"],
            "total_size": result["total_size"],
            "skipped_files": len(result["skipped"]),
            "allowed_extensions": list(ALLOWED_EXTENSIONS),
            "timestamp": datetime.now().isoformat()
        }
        
    except ValueError as e:
        # Security validation error
        logger.warning(f"Model upload security error: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.exception(f"Model upload error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to process model upload"
        )
    finally:
        # Clean up temp file
        if tmp_path and tmp_path.exists():
            tmp_path.unlink()


@router.delete("/{model_id}")
async def delete_model(
    model_id: str,
    current_user: CurrentUserDep = None
):
    """
    Delete a Live2D model.
    
    **Security controls:**
    - JWT authentication required
    - Path traversal prevention
    - Model ID validation
    
    Args:
        model_id: Model identifier (directory name)
    """
    # Verify authentication
    if not current_user or not current_user.get("is_authenticated"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required for model deletion"
        )
    
    # Validate model_id format (alphanumeric, underscore, hyphen only)
    import re
    if not re.match(r'^[a-zA-Z0-9_-]+$', model_id):
        logger.warning(f"Invalid model ID format: {model_id}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid model ID format"
        )
    
    # Build path and validate it's within models directory
    model_path = MODELS_DIR / model_id
    
    try:
        resolved_model_path = model_path.resolve()
        resolved_models_dir = MODELS_DIR.resolve()
        
        # Path traversal check
        if not str(resolved_model_path).startswith(str(resolved_models_dir)):
            logger.warning(f"Path traversal attempt: {model_id}")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid model path"
        )
    
    # Check if model exists
    if not model_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model not found: {model_id}"
        )
    
    # Delete model directory
    try:
        shutil.rmtree(model_path)
        logger.info(f"Model deleted by {current_user.get('username')}: {model_id}")
        
        return {
            "success": True,
            "message": f"Model {model_id} deleted successfully",
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.exception(f"Model deletion error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete model"
        )
