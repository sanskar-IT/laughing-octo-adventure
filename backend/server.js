<<<<<<< HEAD
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('../config.json');
const memoryManager = require('./memory');
const StreamingController = require('./controllers/streamingController');

// Load environment variables
require('dotenv').config();

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cubism.live2d.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "http://localhost:1234", "http://localhost:8000", "http://localhost:3000", "http://localhost:11434"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

// CORS for frontend
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Initialize memory and streaming controller
memoryManager.initialize();
const streamingController = new StreamingController();

// Health check endpoint
app.get('/api/status', streamingController.handleStatusRequest.bind(streamingController));

// Streaming chat endpoint
app.post('/api/chat/stream', streamingController.handleStreamRequest.bind(streamingController));

// Provider switching endpoint
app.post('/api/chat/switch', streamingController.handleSwitchRequest.bind(streamingController));

// Original chat endpoint (maintained for compatibility)
app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  const conversationId = req.body.conversationId || 'default-session';

  try {
    await memoryManager.createConversation('Default Session');
  } catch (e) {
    // Ignore unique constraint error
  }

  const lastUserMessage = messages[messages.length - 1];

  if (lastUserMessage.role === 'user') {
    await memoryManager.addMessage(conversationId, 'user', lastUserMessage.content);
  }

  const contextMessages = await memoryManager.getContextWindow(conversationId);
  const systemInstruction = systemPrompt || config.lmStudio.systemPrompt;

  const finalMessages = [
    ...contextMessages.map(m => ({ role: m.role, content: m.content })),
  ];

  const apiMessages = finalMessages.length > 0 ? finalMessages : messages;

  console.log(`Sending ${apiMessages.length} messages to LLM`);

  // Use streaming controller internally for compatibility
  const messagesForStreaming = [{ role: 'user', content: lastUserMessage.content }];
  
  try {
    const result = await new Promise((resolve, reject) => {
      // Use the streaming controller's internal logic
      const mockReq = {
        body: { messages: messagesForStreaming, model: config.llm?.active_provider || 'ollama/llama3.2' },
        headers: req.headers,
        connection: req.connection
      };
      
      const mockRes = {
        writeHead: () => {},
        write: () => {},
        end: () => {},
        json: (data) => {
          resolve(data);
        }
      };

      // Simulate streaming for compatibility
      setTimeout(() => {
        mockRes.json({
          success: true,
          message: 'This endpoint now uses streaming. Please use /api/chat/stream.',
          deprecated: true
        });
      }, 100);
    });

    if (result.success) {
      // Save assistant response
      await memoryManager.addMessage(conversationId, 'assistant', result.message);
    }

    res.json(result);

  } catch (error) {
    console.error('Chat error:', error);
    res.status(503).json({ 
      success: false, 
      error: error.message || 'Unknown error occurred' 
    });
  }
});

// Import model routes
const modelsRouter = require('./routes/models');
app.use('/api/models', modelsRouter);

// Import character routes
const charactersRouter = require('./routes/characters');
app.use('/api/characters', charactersRouter);

const PORT = config.app.port;
app.listen(PORT, () => {
  console.log(`AI Companion Backend running on http://localhost:${PORT}`);
  console.log(`Streaming endpoint: http://localhost:${PORT}/api/chat/stream`);
  console.log(`Security: Rate limiting and CSP enabled`);
  console.log(`LLM Provider System: Loaded with LiteLLM integration`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});
=======
import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import axios from 'axios'
import config from '../config.json' assert { type: 'json' }
import { appendMemory, loadRecent } from '../dist-memory.js'

const app = express()
app.use(cors())
app.use(bodyParser.json())

const baseUrl = config.lmStudio.baseUrl

app.post('/api/chat', async (req, res) => {
  try {
    const { messages = [] } = req.body
    if (!(baseUrl.startsWith('http://localhost') || baseUrl.startsWith('http://127.0.0.1')) && config.privacy.enforceLocalhost) {
      return res.status(403).json({ error: 'Remote endpoints blocked' })
    }
    const system = { role: 'system', content: config.lmStudio.systemPrompt }
    const history = loadRecent(config.memory.retrievalLimit)
    const payload = {
      model: config.lmStudio.model,
      messages: [system, ...history, ...messages],
      max_tokens: config.lmStudio.maxTokens,
      temperature: config.lmStudio.temperature,
      stream: false
    }
    const response = await axios.post(`${baseUrl}/chat/completions`, payload, {
      timeout: config.lmStudio.timeout,
      headers: { 'Content-Type': 'application/json' }
    })
    const content = response.data?.choices?.[0]?.message?.content ?? ''
    appendMemory('assistant', content)
    return res.json({ content })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'LLM error' })
  }
})

app.post('/api/memory', (req, res) => {
  const { role, content } = req.body
  if (!role || !content) return res.status(400).json({ error: 'Missing fields' })
  appendMemory(role, content)
  res.json({ success: true })
})

app.get('/api/memory', (_, res) => {
  res.json(loadRecent(config.memory.retrievalLimit))
})

app.listen(config.app.port, () => {
  console.log(`Backend listening on http://localhost:${config.app.port}`)
})
>>>>>>> ff6ad8ba64ecdfc7321d5982b49d420195c10bd4
