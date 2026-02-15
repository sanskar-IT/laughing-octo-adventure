# AI Companion - Backend Dockerfile
# FastAPI with Hybrid LLM Support

FROM python:3.10-slim as base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p /app/data /app/logs /app/characters /app/models

# ==========================================
# PRODUCTION STAGE
# ==========================================
FROM base as production

ENV PYTHONUNBUFFERED=1
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/api/status || exit 1

# Run with gunicorn for production
CMD ["gunicorn", "-w", "4", "-k", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:3000", "--access-logfile", "-", "--error-logfile", "-", "main:app"]

# ==========================================
# DEVELOPMENT STAGE
# ==========================================
FROM base as development

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PORT=3000
ENV HOST=0.0.0.0
ENV LOG_LEVEL=debug

EXPOSE 3000

# Install development dependencies
RUN pip install pytest pytest-asyncio

# Run with uvicorn auto-reload
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3000", "--reload", "--log-level", "debug"]
