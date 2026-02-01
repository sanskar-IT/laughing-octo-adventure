const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const config = require('../config.json');
const memoryManager = require('./memory');
const StreamingController = require('./controllers/streamingController');
const logger = require('./utils/logger');

require('dotenv').config();

const app = express();

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

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

memoryManager.initialize();
const streamingController = new StreamingController();

app.get('/api/status', streamingController.handleStatusRequest.bind(streamingController));

app.post('/api/chat/stream', streamingController.handleStreamRequest.bind(streamingController));

app.post('/api/chat/switch', streamingController.handleSwitchRequest.bind(streamingController));

app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  const conversationId = req.body.conversationId || 'default-session';

  try {
    await memoryManager.createConversation('Default Session');
  } catch (e) {
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

  logger.info(`Sending messages to LLM`, { messageCount: apiMessages.length });

  const messagesForStreaming = [{ role: 'user', content: lastUserMessage.content }];

  try {
    const result = await new Promise((resolve, reject) => {
      const mockReq = {
        body: { messages: messagesForStreaming, model: config.llm?.active_provider || 'ollama/llama3.2' },
        headers: req.headers,
        connection: req.connection
      };

      const mockRes = {
        writeHead: () => { },
        write: () => { },
        end: () => { },
        json: (data) => {
          resolve(data);
        }
      };

      setTimeout(() => {
        mockRes.json({
          success: true,
          message: 'This endpoint now uses streaming. Please use /api/chat/stream.',
          deprecated: true
        });
      }, 100);
    });

    if (result.success) {
      await memoryManager.addMessage(conversationId, 'assistant', result.message);
    }

    res.json(result);

  } catch (error) {
    logger.logError(error, { endpoint: '/api/chat' });
    res.status(503).json({
      success: false,
      error: error.message || 'Unknown error occurred'
    });
  }
});

const modelsRouter = require('./routes/models');
app.use('/api/models', modelsRouter);

const charactersRouter = require('./routes/characters');
app.use('/api/characters', charactersRouter);

const PORT = config.app.port;
app.listen(PORT, () => {
  console.log(`AI Companion Backend running on http://localhost:${PORT}`);
  console.log(`Streaming endpoint: http://localhost:${PORT}/api/chat/stream`);
  console.log(`Security: Rate limiting and CSP enabled`);
  console.log(`LLM Provider System: Loaded with LiteLLM integration`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  console.log('Shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  console.log('Shutting down...');
  process.exit(0);
});
