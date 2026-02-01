"""
Characters API Routes.
Handles character card upload, listing, and management.
"""

import base64
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from backend_fastapi.api.deps import (
    CharacterManagerDep,
    CurrentUserDep,
    RateLimitDep,
    validate_character_id_param,
)
from backend_fastapi.services.character_service import CharacterCardParser
from backend_fastapi.utils.logger import get_logger

logger = get_logger("characters")
router = APIRouter(prefix="/characters", tags=["characters"])


class CharacterCreateRequest(BaseModel):
    """Request to create a character from raw data."""
    character_data: dict[str, Any]
    live2d_model_id: str | None = None
    live2d_model_path: str | None = None


class CharacterUpdateRequest(BaseModel):
    """Request to update a character."""
    live2d_model_id: str | None = None
    live2d_model_path: str | None = None


class CharacterResponse(BaseModel):
    """Character response model."""
    success: bool
    data: dict[str, Any]


class CharacterListResponse(BaseModel):
    """Character list response."""
    success: bool
    data: list[dict[str, Any]]


def extract_json_from_png(png_data: bytes) -> dict[str, Any] | None:
    """
    Extract JSON from PNG file (Chub AI format).
    PNG files may contain character card data in tEXt chunks.
    
    Args:
        png_data: Raw PNG file data
        
    Returns:
        Extracted character data or None
    """
    try:
        # PNG signature check
        if png_data[:8] != b'\x89PNG\r\n\x1a\n':
            return None
        
        offset = 8  # Skip PNG signature
        
        while offset < len(png_data):
            # Read chunk length and type
            length = int.from_bytes(png_data[offset:offset + 4], 'big')
            chunk_type = png_data[offset + 4:offset + 8].decode('ascii')
            
            if chunk_type == 'tEXt':
                # Read chunk data
                data = png_data[offset + 8:offset + 8 + length]
                
                # Find null separator between keyword and text
                null_idx = data.find(b'\x00')
                if null_idx != -1:
                    keyword = data[:null_idx].decode('ascii')
                    text = data[null_idx + 1:]
                    
                    # Chub AI uses 'chara' keyword
                    if keyword == 'chara':
                        try:
                            # Text is usually base64 encoded
                            decoded = base64.b64decode(text).decode('utf-8')
                            import json
                            return json.loads(decoded)
                        except Exception:
                            # Try direct JSON parse
                            try:
                                import json
                                return json.loads(text.decode('utf-8'))
                            except Exception:
                                pass
            
            if chunk_type == 'IEND':
                break
            
            # Move to next chunk (length + type + data + CRC)
            offset += 12 + length
        
        return None
    except Exception as e:
        logger.error(f"Error extracting JSON from PNG: {e}")
        return None


@router.post("/upload", response_model=CharacterResponse)
async def upload_character(
    file: UploadFile = File(...),
    character_manager: CharacterManagerDep = None,
    current_user: CurrentUserDep = None,
    rate_limit: RateLimitDep = None
):
    """
    Upload a character card file (JSON or PNG format).
    
    PNG files are expected to contain embedded character data
    in tEXt chunks (Chub AI format).
    
    **Supported formats:**
    - JSON: Direct character card data
    - PNG: Character card with embedded data
    
    **Returns:**
    Character information including:
    - characterId: UUID of the saved character
    - name: Character name
    - description: Character description
    - firstMessage: First message (first_mes)
    - systemPrompt: Generated system prompt
    """
    # Validate file type
    allowed_types = ["application/json", "image/png"]
    if file.content_type not in allowed_types and not file.filename.endswith(('.json', '.png')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file type. Only JSON and PNG files are allowed."
        )
    
    # Read file content
    content = await file.read()
    
    # Validate file size (5MB max)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File too large. Maximum size is 5MB."
        )
    
    # Parse based on file type
    character_data = None
    source_format = "json"
    
    if file.content_type == "image/png" or file.filename.endswith('.png'):
        character_data = extract_json_from_png(content)
        source_format = "png"
        
        if not character_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not extract character data from PNG file"
            )
    else:
        try:
            import json
            character_data = json.loads(content.decode('utf-8'))
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON format: {str(e)}"
            )
    
    # Validate character card
    validation = CharacterCardParser.validate(character_data)
    if not validation["valid"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "Invalid character card format",
                "details": validation["errors"]
            }
        )
    
    # Save character
    try:
        created_by = current_user.get("username", "unknown") if current_user else "unknown"
        character_id = await character_manager.save_character(
            character_data,
            created_by=created_by
        )
        
        # Parse for response
        parsed = CharacterCardParser.parse(character_data)
        
        logger.info(f"Character uploaded: {parsed.name} by {created_by}")
        
        return CharacterResponse(
            success=True,
            data={
                "characterId": character_id,
                "name": parsed.name,
                "description": parsed.description,
                "personality": parsed.personality,
                "firstMessage": parsed.first_message,
                "systemPrompt": parsed.system_prompt,
                "sourceFormat": source_format,
                "validation": {
                    "valid": True,
                    "warnings": validation["warnings"]
                }
            }
        )
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.exception(f"Character upload error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server error during character upload"
        )


@router.post("", response_model=CharacterResponse)
async def create_character(
    request: CharacterCreateRequest,
    character_manager: CharacterManagerDep,
    current_user: CurrentUserDep,
    rate_limit: RateLimitDep
):
    """
    Create a character from raw character data.
    """
    # Validate
    validation = CharacterCardParser.validate(request.character_data)
    if not validation["valid"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "Invalid character card format",
                "details": validation["errors"]
            }
        )
    
    # Save
    try:
        created_by = current_user.get("username", "unknown") if current_user else "unknown"
        character_id = await character_manager.save_character(
            request.character_data,
            created_by=created_by
        )
        
        parsed = CharacterCardParser.parse(request.character_data)
        
        return CharacterResponse(
            success=True,
            data={
                "characterId": character_id,
                "name": parsed.name,
                "description": parsed.description,
                "firstMessage": parsed.first_message
            }
        )
    
    except Exception as e:
        logger.exception(f"Character creation error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.get("", response_model=CharacterListResponse)
async def list_characters(
    character_manager: CharacterManagerDep,
    current_user: CurrentUserDep
):
    """
    List all available characters.
    """
    characters = await character_manager.list_characters()
    return CharacterListResponse(
        success=True,
        data=characters
    )


@router.get("/{character_id}", response_model=CharacterResponse)
async def get_character(
    character_id: str,
    character_manager: CharacterManagerDep,
    current_user: CurrentUserDep
):
    """
    Get a character by ID.
    """
    await validate_character_id_param(character_id)
    
    try:
        character = await character_manager.load_character(character_id)
        
        return CharacterResponse(
            success=True,
            data={
                "id": character_id,
                "name": character.name,
                "description": character.description,
                "personality": character.personality,
                "firstMessage": character.first_message,
                "systemPrompt": character.system_prompt,
                "postHistoryInstructions": character.post_history_instructions,
                "tags": character.tags,
                "creator": character.creator
            }
        )
    
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found"
        )


@router.put("/{character_id}", response_model=CharacterResponse)
async def update_character(
    character_id: str,
    request: CharacterUpdateRequest,
    character_manager: CharacterManagerDep,
    current_user: CurrentUserDep
):
    """
    Update a character's Live2D model association.
    """
    await validate_character_id_param(character_id)
    
    # Load character to verify it exists
    try:
        await character_manager.load_character(character_id)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found"
        )
    
    # Update the character file
    character_path = character_manager.characters_dir / f"{character_id}.json"
    
    import json
    with open(character_path, "r", encoding="utf-8") as f:
        record = json.load(f)
    
    if request.live2d_model_id is not None:
        record["live2d_model_id"] = request.live2d_model_id
    if request.live2d_model_path is not None:
        record["live2d_model_path"] = request.live2d_model_path
    record["updated_at"] = datetime.now().isoformat()
    
    with open(character_path, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
    
    logger.info(f"Character updated: {record.get('name', character_id)}")
    
    return CharacterResponse(
        success=True,
        data={
            "id": character_id,
            "name": record.get("name"),
            "live2d_model_id": record.get("live2d_model_id"),
            "live2d_model_path": record.get("live2d_model_path"),
            "updated_at": record["updated_at"]
        }
    )


@router.delete("/{character_id}")
async def delete_character(
    character_id: str,
    character_manager: CharacterManagerDep,
    current_user: CurrentUserDep
):
    """
    Delete a character by ID.
    """
    await validate_character_id_param(character_id)
    
    deleted = await character_manager.delete_character(character_id)
    
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found"
        )
    
    logger.info(f"Character deleted: {character_id}")
    
    return {
        "success": True,
        "message": "Character deleted successfully"
    }


@router.post("/{character_id}/activate")
async def activate_character(
    character_id: str,
    character_manager: CharacterManagerDep,
    current_user: CurrentUserDep
):
    """
    Set a character as the active persona.
    """
    await validate_character_id_param(character_id)
    
    try:
        character = await character_manager.load_character(character_id)
        
        return {
            "success": True,
            "message": f"Activated character: {character.name}",
            "character": {
                "id": character_id,
                "name": character.name,
                "firstMessage": character.first_message
            }
        }
    
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Character not found"
        )
