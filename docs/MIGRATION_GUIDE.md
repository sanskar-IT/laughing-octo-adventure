# Migration Guide: Express.js to FastAPI

This document describes the migration from the Express.js backend to FastAPI.

## Overview

The AI Companion backend has been migrated from Node.js/Express to Python/FastAPI. This provides:

- **Unified Python Stack**: Backend and TTS server now share the same runtime
- **LiteLLM Integration**: Single gateway for all LLM providers (Ollama, OpenAI, Anthropic)
- **Async-First Design**: Native async/await for better performance
- **Production-Ready**: Pydantic validation, structured logging, comprehensive security

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
│       └── models.py   # LLM model listing/switching
├── core/
│   ├── __init__.py
│   ├── config.py       # Pydantic settings (loads .env + config.json)
│   └── security.py     # Sanitization, CSP headers
├── services/
│   ├── __init__.py
│   ├── litellm_service.py  # LiteLLM provider gateway
│   └── character_service.py    # V2 Spec parser + CharacterManager
└── utils/
    ├── __init__.py
    └── logger.py       # Loguru structured logging
```

## Quick Start

### 1. Install Dependencies

```bash
pip install -r backend_fastapi/requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your settings
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

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/health` | GET | Detailed health status |
| `/api/status` | GET | LLM provider status |
| `/api/chat/stream` | POST | Streaming chat with TTS |
| `/api/chat` | POST | Non-streaming chat |
| `/api/chat/switch` | POST | Switch LLM model |
| `/api/characters` | GET | List characters |
| `/api/characters` | POST | Create character |
| `/api/characters/upload` | POST | Upload character card |
| `/api/characters/{id}` | GET/PUT/DELETE | Manage character |
| `/api/characters/{id}/activate` | POST | Set active character |
| `/api/models` | GET | List available models |
| `/api/models/status` | GET | Provider status |
| `/api/models/switch` | POST | Switch model |

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

- Content Security Policy (CSP) headers
- LLM output sanitization (prevents prompt injection)
- Rate limiting per IP
- Input validation with Pydantic
- Path traversal protection

## Legacy Backend

The Express.js backend is preserved at `backend/server.js` for reference.

To run the legacy backend:
```bash
npm run start:backend:legacy
```

## Troubleshooting

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

### Missing Dependencies

```bash
pip install -r backend_fastapi/requirements.txt --upgrade
```
