# AI Companion - Ollama Service Dockerfile
# Pre-configured with small models for RTX 4050

FROM ollama/ollama:latest

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Copy initialization script
COPY init-ollama.sh /tmp/init-ollama.sh
RUN chmod +x /tmp/init-ollama.sh

# Set environment variables
ENV OLLAMA_HOST=0.0.0.0
ENV OLLAMA_ORIGINS=*
ENV OLLAMA_NUM_PARALLEL=2
ENV OLLAMA_MAX_LOADED_MODELS=1
ENV OLLAMA_KEEP_ALIVE=30m

# Expose port
EXPOSE 11434

# Create volume mount point
VOLUME /root/.ollama

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:11434/api/tags || exit 1

# Start Ollama and pull models
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["/tmp/init-ollama.sh"]
