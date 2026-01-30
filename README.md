# AI Companion - Privacy-Focused Local AI Assistant

![License](https://img.shields.io/badge/license-MIT-blue.svg) ![Node](https://img.shields.io/badge/node-18%2B-green) ![Python](https://img.shields.io/badge/python-3.10%2B-yellow)

A privacy-centric AI companion application integrating **LM Studio** (LLMs), **Live2D** (Interactive Avatars), **Persistent Memory**, and **Local TTS**. This project demonstrates a full-stack local-first architecture for AI agents.

## 🌟 Features

- **Privacy-First**: All processing happens locally (127.0.0.1) - no external API calls or telemetry.
- **LM Studio Integration**: Connects seamlessly to any OpenAI-compatible local LLM server.
- **Live2D Character Engine**: Renders high-fidelity anime-style characters with physics and lip-syncing (Visemes) using `pixi-live2d-display`.
- **Persistent Memory**: Stores conversation history and context locally using a JSON-based database/SQLite.
- **Local Text-to-Speech**: Integrated Python-based TTS bridge for generating voice and viseme data.
- **Responsive UI**: Modern React + Vite frontend with glassmorphism design.

## 🏗️ Architecture

The application follows a modular architecture:

1.  **Frontend (React + Vite)**: Handles the UI, Live2D rendering (PixiJS), and state management (Zustand).
2.  **Backend (Node.js/Express)**: Manages API requests, conversation memory, and communicates with local AI services.
3.  **AI Services**:
    *   **LLM**: LM Studio (running locally on port 1234).
    *   **TTS**: Python server (running locally on port 8000) for audio generation.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+
- [LM Studio](https://lmstudio.ai/) (with any model loaded)

### 1. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/yourusername/ai-companion.git
cd ai-companion

# Install Node.js dependencies
npm install

# Install Python dependencies (for TTS)
# (Optional if you have a custom environment)
npm run install:all 
```

### 2. Live2D Model Setup (Custom Models)

The app comes with a placeholder configuration. To use your own model (e.g., **Ruan Mei**):

1.  Navigate to `public/models/`.
2.  Create a folder for your model, e.g., `ruan_mei`.
3.  Unzip your Live2D model files into this folder.
    *   Ensure the `.model3.json` file is present (e.g., `ruan_mei.model3.json`).
4.  Update `src/App.tsx`:

```typescript
// src/App.tsx
// ...
<Live2DCanvas modelPath="./models/ruan_mei/ruan_mei.model3.json" />
// ...
```

### 3. Running the Application

You need to run the Backend, TTS Server, and Frontend simultaneously.

**Terminal 1: Backend**
```bash
npm run start:backend
```

**Terminal 2: TTS Server**
```bash
npm run start:tts
```

**Terminal 3: Frontend**
```bash
npm run dev
```

Open your browser to `http://localhost:5173`.

## ⚙️ Configuration

Edit `config.json` to customize ports and default system prompts.

```json
{
  "lmStudio": {
    "baseUrl": "http://localhost:1234/v1"
  },
  "live2d": {
    "lipSyncEnabled": true
  }
}
```

## 🔒 Privacy & Security

This application is designed to be completely offline-capable.
- **No Data Collection**: Your chats stay on your machine in `data/memory.json`.
- **Local Inference**: Relies solely on your local hardware for AI processing.

## 📄 License

MIT License - feel free to use this for your own portfolio or personal projects.
<<<<<<< HEAD
"# AI-cuddle" 
=======
"# AI-cuddle" 
>>>>>>> ff6ad8ba64ecdfc7321d5982b49d420195c10bd4
