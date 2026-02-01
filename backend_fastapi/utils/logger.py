"""
Structured logging configuration using Loguru.
Provides file-based logging with rotation and structured format.
"""

import os
import sys
from pathlib import Path

from loguru import logger

# Remove default handler
logger.remove()

# Determine log directory
LOG_DIR = Path(__file__).parent.parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

# Log format
LOG_FORMAT = (
    "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
    "<level>{level: <8}</level> | "
    "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
    "<level>{message}</level>"
)

FILE_LOG_FORMAT = (
    "{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | "
    "{name}:{function}:{line} - {message}"
)

# Add file handler with rotation
logger.add(
    LOG_DIR / "backend-{time:YYYY-MM-DD}.log",
    rotation="1 day",
    retention="14 days",
    format=FILE_LOG_FORMAT,
    level="INFO",
    backtrace=True,
    diagnose=True,
    enqueue=True  # Thread-safe async logging
)

# Add error-only file
logger.add(
    LOG_DIR / "backend-error-{time:YYYY-MM-DD}.log",
    rotation="1 day",
    retention="30 days",
    format=FILE_LOG_FORMAT,
    level="ERROR",
    backtrace=True,
    diagnose=True,
    enqueue=True
)

# Add minimal console output for development
if os.getenv("APP_ENVIRONMENT", "development") == "development":
    logger.add(
        sys.stderr,
        format=LOG_FORMAT,
        level="WARNING",  # Only show warnings and errors in console
        colorize=True
    )


def get_logger(name: str = "backend"):
    """Get a logger instance with the given name."""
    return logger.bind(name=name)


# Convenience functions
def log_request(endpoint: str, method: str, **kwargs):
    """Log an API request."""
    logger.info(f"Request: {method} {endpoint}", **kwargs)


def log_stream(event: str, message: str, **kwargs):
    """Log a streaming event."""
    logger.debug(f"Stream [{event}]: {message}", **kwargs)


def log_error(error: Exception, context: str = "", **kwargs):
    """Log an error with context."""
    logger.exception(f"Error in {context}: {error}", **kwargs)


def log_security(event: str, message: str, **kwargs):
    """Log a security event."""
    logger.warning(f"Security [{event}]: {message}", **kwargs)


# Export logger instance
__all__ = ["logger", "get_logger", "log_request", "log_stream", "log_error", "log_security"]
