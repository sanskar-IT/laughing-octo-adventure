# AI Companion - TTS Service Dockerfile
# FastAPI-based Text-to-Speech with viseme generation

FROM python:3.10-slim as base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    gcc \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements
COPY tts-server-requirements.txt .
RUN pip install --no-cache-dir -r tts-server-requirements.txt

# Copy TTS server code
COPY tts-server.py .
COPY tts-bridge/ ./tts-bridge/

# Create logs directory
RUN mkdir -p /app/logs

# Production stage
FROM base as production

ENV TTS_HOST=0.0.0.0
ENV TTS_PORT=8000
ENV LOG_LEVEL=info
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run with uvicorn for production
CMD ["uvicorn", "tts-server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

# Development stage
FROM base as development

ENV TTS_HOST=0.0.0.0
ENV TTS_PORT=8000
ENV LOG_LEVEL=debug
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

# Run with auto-reload for development
CMD ["uvicorn", "tts-server:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
