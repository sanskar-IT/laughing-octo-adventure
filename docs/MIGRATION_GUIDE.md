# Migration Guide: Production-Hardened AI Companion

This document describes the migration from the Express.js backend to FastAPI and the production hardening changes.

## Overview

The AI Companion backend has been migrated from Node.js/Express to Python/FastAPI with production-hardened security. This provides:

- **Unified Python Stack**: Backend and TTS server now share the same runtime
- **LiteLLM Integration**: Single gateway for all LLM providers (Ollama, OpenAI, Anthropic)
- **Async-First Design**: Native async/await for better performance
- **Production-Ready**: Pydantic validation, structured logging, comprehensive security
- **Offline TTS with Voice Cloning**: Coqui XTTS support for offline voice synthesis
- **Strict Security**: Mandatory JWT_SECRET, strict CORS, CSP headers

## ⚠️ Breaking Changes (v2.0.0)

### Security: Mandatory JWT_SECRET

The application **will not start** without a valid `JWT_SECRET` environment variable.

```bash
# Generate a secure secret
python -c "import secrets; print(secrets.token_hex(32))"

# Add to .env
JWT_SECRET=<your_64_character_hex_string>
```

### CORS: Strict Origins Only

Only the following origins are allowed:
- `http://localhost:5173` (Vite dev server)
- `tauri://localhost` (Tauri app)

Any other origins (including `127.0.0.1`) are rejected.

## Directory Structure

```
backend_fastapi/
├── __init__.py
├── main.py              # FastAPI application entry point
├── requirements.txt     # Python dependencies
├── api/
│   ├── __init__.py
│   ├── deps.py         # Dependency injection
│   └── routes/
│       ├── chat.py     # Streaming chat with sentence-level TTS
│       ├── characters.py   # Character card management
│       ├── models.py   # LLM model listing/switching
│       └── tts.py      # TTS with voice cloning support
├── core/
│   ├── __init__.py
│   ├── config.py       # Pydantic settings (loads .env + config.json)
│   └── security.py     # Sanitization, CSP headers
├── services/
│   ├── __init__.py
│   ├── litellm_service.py  # LiteLLM provider gateway
│   ├── character_service.py    # V2 Spec parser + CharacterManager
│   └── tts_service.py  # Offline TTS with voice cloning
└── utils/
    ├── __init__.py
    └── logger.py       # Loguru structured logging
```

## Quick Start

### 1. Install Dependencies

```bash
pip install -r backend_fastapi/requirements.txt

# Optional: For offline TTS with voice cloning
pip install TTS numpy
```

### 2. Configure Environment

```bash
cp .env.example .env

# REQUIRED: Generate and set JWT_SECRET
python -c "import secrets; print(secrets.token_hex(32))"
# Paste the output into .env for JWT_SECRET
```

### 3. Start the Backend

```bash
# Using npm script
npm run start:backend

# Or directly
python -m backend_fastapi.main
```

### 4. Verify Installation

Open http://localhost:3000/docs for the API documentation.

## API Endpoints

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/health` | GET | Detailed health status |
| `/api/status` | GET | LLM provider status |
| `/api/chat/stream` | POST | Streaming chat with TTS |
| `/api/chat` | POST | Non-streaming chat |
| `/api/chat/switch` | POST | Switch LLM model |

### Character Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/characters` | GET | List characters |
| `/api/characters` | POST | Create character |
| `/api/characters/upload` | POST | Upload character card |
| `/api/characters/{id}` | GET/PUT/DELETE | Manage character |
| `/api/characters/{id}/activate` | POST | Set active character |

### Model Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/models` | GET | List available models |
| `/api/models/status` | GET | Provider status |
| `/api/models/switch` | POST | Switch model |

### TTS (Text-to-Speech)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tts/health` | GET | TTS service health |
| `/api/tts/generate` | POST | Generate TTS audio (base64) |
| `/api/tts/stream` | POST | Stream TTS audio chunks |
| `/api/tts/visemes` | POST | Generate visemes only |
| `/api/tts/voices` | GET | List available voices |
| `/api/tts/clone` | POST | Clone voice from audio file |
| `/api/tts/clone/profiles` | GET | List cloned voice profiles |
| `/api/tts/clone/profiles/{id}` | DELETE | Delete voice profile |

## Voice Cloning

### Requirements

- Coqui TTS installed: `pip install TTS`
- ~3GB disk space for XTTS v2 model (auto-downloads on first use)
- GPU recommended for fast synthesis (works on CPU too)

### Usage

```bash
# Clone a voice
curl -X POST http://localhost:3000/api/tts/clone \
  -F "audio_file=@reference.wav" \
  -F "profile_name=MyVoice"

# Use cloned voice
curl -X POST http://localhost:3000/api/tts/generate \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello!", "voice": "clone:abc123"}'
```

### Audio Requirements

- WAV format (mono or stereo)
- 3-30 seconds duration
- Clear speech with minimal background noise
- Maximum 10MB file size

## Key Features

### Sentence-Level TTS Streaming

The `/api/chat/stream` endpoint implements zero-latency audio-visual sync:

1. Tokens stream from LiteLLM
2. Sentence/clause boundaries detected in real-time
3. TTS triggered immediately on first complete sentence
4. Audio playback begins while LLM continues generating

### Character V2 Spec Support

Full support for Chub AI Character Card V2:

- `system_prompt`: Custom system prompt with `{{original}}` placeholder
- `post_history_instructions`: Instructions appended after conversation
- `first_mes`: Initial greeting message
- `character_book`: Lorebook entries

### Security Features

- **Mandatory JWT_SECRET**: App won't start without it
- **Strict CORS**: Only localhost:5173 and tauri://localhost
- **CSP Headers**: Content Security Policy protection
- **LLM Output Sanitization**: Prevents prompt injection
- **Rate Limiting**: Per-IP request limiting
- **Input Validation**: Pydantic validation on all endpoints
- **Path Traversal Protection**: Safe file operations

### Frontend Resilience

- **AudioResilienceManager**: Handles autoplay policy, resumes on first click
- **ResourceGuard**: Automatic cleanup on character switch or new prompt
- **Live2DParameterManager**: Auto-discovers model parameters at load time

## Legacy Backend

The Express.js backend is preserved at `backend/server.js` for reference.

To run the legacy backend:
```bash
npm run start:backend:legacy
```

## Troubleshooting

### App Won't Start: JWT_SECRET Not Configured

```
🚨 SECURITY CRITICAL: JWT_SECRET NOT CONFIGURED 🚨
```

Generate and set the JWT_SECRET:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
# Add to .env: JWT_SECRET=<output>
```

### CORS Errors

Only these origins are allowed:
- `http://localhost:5173`
- `tauri://localhost`

Make sure the frontend is running on the correct port.

### Port Already in Use

The FastAPI backend uses port 3000 by default. Change in `.env`:
```
APP_PORT=3001
```

### LiteLLM Connection Issues

Ensure Ollama is running:
```bash
ollama serve
```

Check connection:
```bash
curl http://localhost:11434/api/tags
```

### Voice Cloning Not Available

Install Coqui TTS:
```bash
pip install TTS numpy
```

### Missing Dependencies

```bash
pip install -r backend_fastapi/requirements.txt --upgrade
```
