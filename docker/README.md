# AI Companion - Docker Deployment Guide

Complete Docker deployment for AI Companion with RTX 4050 GPU support and hybrid LLM (local + cloud fallback).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Network                           │
│                                                              │
│  Nginx (8080) ◄── Frontend (6000) [dev only]                │
│       │                                                      │
│       └──► Backend (3000) ◄── Ollama (5000) [GPU]            │
│              │                                               │
│              ├──► TTS (4000)                                 │
│              │                                               │
│              └──► [Fallback] Groq/OpenRouter/OpenAI         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Services & Ports**:
- **Backend**: 3000 - FastAPI main API
- **TTS**: 4000 - Text-to-speech service
- **Ollama**: 5000 - Local LLM inference (GPU)
- **Frontend**: 6000 - React dev server (dev mode)
- **Nginx**: 8080 - Production reverse proxy

## Quick Start

### 1. Prerequisites

**Required**:
- Docker Engine 20.10+
- Docker Compose 2.0+
- NVIDIA GPU (RTX 4050 recommended)
- NVIDIA Container Toolkit

**Install NVIDIA Container Toolkit**:
```bash
# Ubuntu/Debian
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Verify GPU access
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

### 2. Deploy

```bash
cd docker

# Deploy development environment
./scripts/deploy.sh

# Or deploy production
./scripts/deploy.sh --environment production
```

### 3. Access

Open http://localhost:8080 in your browser.

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Required
JWT_SECRET=your_64_char_hex_secret

# Cloud LLM Fallback (optional)
GROQ_API_KEY=your_groq_key
OPENROUTER_API_KEY=your_openrouter_key

# Ports (optional, defaults shown)
BACKEND_PORT=3000
TTS_PORT=4000
OLLAMA_PORT=5000
NGINX_PORT=8080
```

**Generate JWT Secret**:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### LLM Configuration

**Primary (Local GPU)**:
- Model: `qwen2.5:3b` (3B params, ~1.8GB)
- Inference: 15-20 tok/s on RTX 4050
- VRAM Usage: ~2.5GB

**Fallback Chain**:
1. Groq (fastest, free tier)
2. OpenRouter (cheapest)
3. OpenAI (most reliable)

Edit `OLLAMA_GPU_LAYERS` in `.env` based on your GPU:
- RTX 4050 (6GB): 35 layers
- RTX 4060 (8GB): 40 layers
- RTX 4070 (12GB): 45 layers

## Development vs Production

### Development Mode
```bash
./scripts/deploy.sh --environment development
```
- Hot reload for frontend
- Debug logging
- Individual service ports exposed
- Auto-restart on file changes

### Production Mode
```bash
./scripts/deploy.sh --environment production
```
- Optimized builds
- Resource limits enforced
- SSL/HTTPS ready
- Minimal logging
- All traffic through nginx

## Management Commands

```bash
# View logs
docker compose logs -f [service]

# Stop all services
docker compose down

# Restart service
docker compose restart backend

# Update deployment
./scripts/update.sh

# Full rebuild
./scripts/update.sh --full

# Shell into container
docker compose exec backend bash

# Check GPU usage
docker compose exec ollama nvidia-smi
```

## Troubleshooting

### GPU Not Detected

```bash
# Check NVIDIA drivers
nvidia-smi

# Verify Docker GPU support
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi

# If failed, install toolkit:
https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html
```

### Ollama Model Download Failed

```bash
# Check Ollama logs
docker compose logs ollama

# Pull model manually
docker compose exec ollama ollama pull qwen2.5:3b

# List available models
docker compose exec ollama ollama list
```

### Backend Won't Start

```bash
# Check if .env exists
ls -la .env

# Verify JWT_SECRET is set
grep JWT_SECRET .env

# Check backend logs
docker compose logs backend
```

### Port Conflicts

Edit `.env` to use different ports:
```bash
BACKEND_PORT=3001
TTS_PORT=4001
OLLAMA_PORT=5001
NGINX_PORT=8081
```

## Performance Tuning

### RTX 4050 Optimizations

With 6GB VRAM, you can run:
- 3B models comfortably (qwen2.5:3b, llama3.2:3b)
- 7B models in 4-bit quantized (llama3:7b-q4)

**Recommended Settings**:
```bash
# In .env
OLLAMA_GPU_LAYERS=35
OLLAMA_KEEP_ALIVE=30m
```

### Without GPU (CPU Only)

Works but slower (~5 tok/s):
```bash
# Skip GPU check during deploy
./scripts/deploy.sh --skip-gpu-check
```

Models will load to RAM instead of VRAM.

## Backup & Restore

### Backup Data

```bash
# Backup conversations and config
cp -r docker/data backup-$(date +%Y%m%d)
```

### Restore Data

```bash
# Restore from backup
cp -r backup-20240130 docker/data
docker compose restart backend
```

## Security

### JWT Secret
- Must be 64 hex characters
- Change default before production
- Store securely, never commit to git

### API Keys
- Cloud LLM keys in `.env`
- Never commit `.env`
- Use separate keys for dev/prod

### SSL/HTTPS

For production with SSL:
1. Place certificates in `docker/nginx/ssl/`
2. Update `docker-compose.prod.yml`
3. Deploy: `./scripts/deploy.sh -e production`

## Updating

```bash
# Pull latest images and restart
cd docker
./scripts/update.sh

# Or full rebuild (clear caches)
./scripts/update.sh --full
```

## API Endpoints

Once deployed:
- **Main App**: http://localhost:8080
- **API Docs**: http://localhost:3000/docs (backend swagger)
- **Health Check**: http://localhost:3000/api/status

## Support

- 📧 Issues: GitHub Issues
- 💬 Discord: AI Companion community
- 📖 Docs: See main README.md

---

**Ready to deploy?** Run:
```bash
cd docker && ./scripts/deploy.sh
```
