"""
Secure file upload utilities with ZIP bomb and path traversal protection.

This module implements security controls for file uploads as specified
in the security audit report, migrated from the Node.js backend.
"""

import zipfile
import os
from pathlib import Path
from typing import Set, Optional
import asyncio

from backend_fastapi.utils.logger import get_logger

logger = get_logger("secure_upload")

# Security Limits
MAX_EXTRACTED_SIZE = 200 * 1024 * 1024  # 200MB - ZIP bomb protection
MAX_FILE_COUNT = 1000  # Maximum files in archive

# Whitelisted extensions for Live2D models and character assets
ALLOWED_EXTENSIONS: Set[str] = {
    ".json",   # Model/character configuration
    ".moc3",   # Live2D model
    ".png",    # Textures
    ".jpeg",   # Textures
    ".jpg",    # Textures
    ".wav",    # Audio
    ".mp3",    # Audio
    ".ogg",    # Audio
}


def is_safe_path(base_dir: Path, target_path: Path) -> bool:
    """
    Validate that target path doesn't escape base directory.
    Prevents path traversal attacks (e.g., ../../etc/passwd).
    
    Args:
        base_dir: The allowed base directory
        target_path: The target path to validate
        
    Returns:
        True if path is safe (within base_dir), False otherwise
    """
    try:
        resolved_base = base_dir.resolve()
        resolved_target = target_path.resolve()
        
        # Check if target is under base directory
        return str(resolved_target).startswith(str(resolved_base) + os.sep) or \
               resolved_target == resolved_base
    except (ValueError, OSError) as e:
        logger.warning(f"Path validation error: {e}")
        return False


def is_allowed_extension(filename: str) -> bool:
    """
    Check if file extension is in the whitelist.
    
    Args:
        filename: The filename to check
        
    Returns:
        True if extension is allowed
    """
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def validate_zip_entry(info: zipfile.ZipInfo, extract_dir: Path) -> Optional[str]:
    """
    Validate a single ZIP entry for security issues.
    
    Args:
        info: ZIP file info entry
        extract_dir: Target extraction directory
        
    Returns:
        Error message if validation fails, None if valid
    """
    # Check for absolute paths in archive
    if info.filename.startswith('/') or info.filename.startswith('\\'):
        return f"Absolute path in archive: {info.filename}"
    
    # Check for path traversal attempts
    if '..' in info.filename:
        return f"Path traversal attempt: {info.filename}"
    
    # Build target path and validate
    target_path = extract_dir / info.filename
    if not is_safe_path(extract_dir, target_path):
        return f"Path escapes target directory: {info.filename}"
    
    return None


async def secure_extract_zip(
    zip_path: Path,
    extract_dir: Path,
    allowed_extensions: Optional[Set[str]] = None
) -> dict:
    """
    Securely extract a ZIP file with comprehensive protections.
    
    Security measures:
    - Path traversal prevention
    - ZIP bomb protection (max size limit)
    - File count limit
    - File extension whitelist
    
    Args:
        zip_path: Path to the ZIP file
        extract_dir: Directory to extract to
        allowed_extensions: Optional custom extension whitelist
        
    Returns:
        Dictionary with extraction results:
        - file_count: Number of extracted files
        - total_size: Total extracted size in bytes
        - files: List of extracted file paths
        - skipped: List of skipped files (not allowed extensions)
        
    Raises:
        ValueError: If security check fails
        zipfile.BadZipFile: If ZIP file is corrupted
    """
    if allowed_extensions is None:
        allowed_extensions = ALLOWED_EXTENSIONS
    
    # Create extraction directory
    extract_dir = Path(extract_dir)
    extract_dir.mkdir(parents=True, exist_ok=True)
    
    total_size = 0
    file_count = 0
    extracted_files = []
    skipped_files = []
    
    # Run extraction in thread pool to avoid blocking
    def _extract():
        nonlocal total_size, file_count, extracted_files, skipped_files
        
        with zipfile.ZipFile(zip_path, 'r') as zf:
            # First pass: validate all entries
            for info in zf.infolist():
                if info.is_dir():
                    continue
                
                # Check file count limit
                file_count += 1
                if file_count > MAX_FILE_COUNT:
                    raise ValueError(
                        f"Too many files in archive (max {MAX_FILE_COUNT})"
                    )
                
                # Check accumulated size (ZIP bomb protection)
                total_size += info.file_size
                if total_size > MAX_EXTRACTED_SIZE:
                    raise ValueError(
                        f"Extracted size exceeds limit "
                        f"({MAX_EXTRACTED_SIZE // 1024 // 1024}MB)"
                    )
                
                # Validate entry
                error = validate_zip_entry(info, extract_dir)
                if error:
                    raise ValueError(error)
            
            # Reset counters for actual extraction
            total_size = 0
            file_count = 0
            
            # Second pass: extract allowed files
            for info in zf.infolist():
                if info.is_dir():
                    continue
                
                # Check extension whitelist
                if not is_allowed_extension(info.filename):
                    skipped_files.append(info.filename)
                    continue
                
                # Build target path
                target_path = extract_dir / info.filename
                
                # Create parent directories
                target_path.parent.mkdir(parents=True, exist_ok=True)
                
                # Extract file with size tracking
                with zf.open(info) as source:
                    data = source.read()
                    
                    # Double-check size during extraction
                    if len(data) != info.file_size:
                        logger.warning(
                            f"Size mismatch for {info.filename}: "
                            f"expected {info.file_size}, got {len(data)}"
                        )
                    
                    total_size += len(data)
                    
                    with open(target_path, 'wb') as target:
                        target.write(data)
                
                file_count += 1
                extracted_files.append(str(target_path))
        
        return {
            "file_count": file_count,
            "total_size": total_size,
            "files": extracted_files,
            "skipped": skipped_files
        }
    
    # Run in thread pool
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, _extract)
    
    logger.info(
        f"ZIP extraction complete: {result['file_count']} files, "
        f"{result['total_size'] / 1024:.1f}KB, "
        f"{len(result['skipped'])} skipped"
    )
    
    return result


async def validate_upload_file(
    filename: str,
    content_type: str,
    file_size: int
) -> Optional[str]:
    """
    Validate an upload file before processing.
    
    Args:
        filename: Original filename
        content_type: MIME content type
        file_size: File size in bytes
        
    Returns:
        Error message if validation fails, None if valid
    """
    # Check for null bytes in filename
    if '\x00' in filename:
        return "Invalid filename containing null bytes"
    
    # Check filename length
    if len(filename) > 255:
        return "Filename too long"
    
    # Check for directory traversal in filename
    if '..' in filename or '/' in filename or '\\' in filename:
        return "Invalid characters in filename"
    
    # Check file size for ZIP uploads
    if filename.lower().endswith('.zip'):
        if file_size > MAX_EXTRACTED_SIZE:
            return f"File too large (max {MAX_EXTRACTED_SIZE // 1024 // 1024}MB)"
    
    return None
