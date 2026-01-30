const providerFactory = require('../providers/ProviderFactory');
const RoleplayContextBuilder = require('../characters/RoleplayContextBuilder');
const CharacterCardParser = require('../characters/CharacterCardParser');
const { sanitizeChatMessage, sanitizeInput } = require('../middleware/auth');

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

function getCorsOrigin(req) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  return ALLOWED_ORIGINS[0] || 'http://localhost:5173';
}

class StreamingController {
  constructor() {
    this.providerFactory = providerFactory;
  }

  async handleStreamRequest(req, res) {
    let { messages, character_card, model, conversationId } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Messages array is required and must not be empty' }));
      return;
    }

    messages = messages.map(msg => sanitizeChatMessage(msg)).filter(msg => msg !== null);

    if (messages.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No valid messages after sanitization' }));
      return;
    }

    if (model) {
      model = sanitizeInput(model, 100);
      if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(model)) {
        console.warn(`[Security] Invalid model format: ${model}`);
        model = null;
      }
    }

    if (conversationId) {
      conversationId = sanitizeInput(conversationId, 50);
      if (!/^[a-zA-Z0-9_-]+$/.test(conversationId)) {
        console.warn(`[Security] Invalid conversation ID format`);
        conversationId = 'default-session';
      }
    }

    const corsOrigin = getCorsOrigin(req);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Headers': 'Cache-Control, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });

    const sendSSE = (event, data) => {
      const eventData = JSON.stringify(data);
      res.write(`event: ${event}\n`);
      res.write(`data: ${eventData}\n\n`);
    };

    try {
      console.log(`[StreamingController] Request received with model: ${model || 'default'}`);

      let characterInfo = null;
      if (character_card) {
        try {
          characterInfo = CharacterCardParser.parse(character_card);
          console.log(`[StreamingController] Character loaded: ${characterInfo.name}`);
        } catch (error) {
          console.error('[StreamingController] Character parse error:', error);
          sendSSE('error', {
            type: 'character_parse_error',
            error: error.message,
            timestamp: new Date().toISOString()
          });
          res.end();
          return;
        }
      }

      let provider;
      try {
        provider = await this.providerFactory.getActiveProvider();
        console.log(`[StreamingController] Active provider: ${provider.getName()}`);
      } catch (error) {
        console.error('[StreamingController] Provider error:', error);
        sendSSE('error', {
          type: 'provider_init_error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
        res.end();
        return;
      }

      const isHealthy = await provider.checkConnection();
      if (!isHealthy.connected) {
        console.log(`[StreamingController] Provider unhealthy: ${isHealthy.error}`);

        if (isHealthy.type === 'local') {
          sendSSE('error', {
            status: 'offline',
            provider: 'local',
            error: isHealthy.error || 'Local LLM provider is not available',
            suggestion: 'Please check if Ollama is running on localhost:11434',
            timestamp: new Date().toISOString()
          });
          res.end();
          return;
        } else {
          const fallbackProvider = await this.providerFactory.getFallbackProvider(provider.getModel());

          if (fallbackProvider) {
            sendSSE('provider_switch', {
              from: provider.getName(),
              to: fallbackProvider.getName(),
              reason: 'primary_offline',
              timestamp: new Date().toISOString()
            });
            provider = fallbackProvider;
          } else {
            sendSSE('error', {
              status: 'all_offline',
              provider: provider.getName(),
              error: 'All providers are unavailable',
              timestamp: new Date().toISOString()
            });
            res.end();
            return;
          }
        }
      }

      sendSSE('provider_connected', {
        provider: provider.getName(),
        model: provider.getModel(),
        type: isHealthy.type,
        character: characterInfo?.name || null,
        timestamp: new Date().toISOString()
      });

      const roleplayContext = RoleplayContextBuilder.buildContext(
        characterInfo,
        messages,
        messages[messages.length - 1]?.content,
        null
      );

      const maxTokens = provider.config.max_tokens || 4096;
      const finalContext = RoleplayContextBuilder.truncateContext(roleplayContext, maxTokens);

      let fullResponse = '';
      let chunkCount = 0;
      const startTime = Date.now();

      for await (const chunk of provider.generateStream(finalContext)) {
        chunkCount++;

        if (chunk.error) {
          console.error(`[StreamingController] Stream error from ${provider.getName()}:`, chunk.error);
          sendSSE('error', {
            provider: chunk.provider,
            model: chunk.model,
            error: chunk.error,
            chunk_count: chunkCount,
            timestamp: new Date().toISOString()
          });
          continue;
        }

        if (chunk.content) {
          fullResponse += chunk.content;
          sendSSE('content', {
            content: chunk.content,
            provider: chunk.provider,
            model: chunk.model,
            chunk_index: chunkCount,
            timestamp: new Date().toISOString()
          });
        }

        if (chunk.done) {
          const endTime = Date.now();
          const latency = endTime - startTime;

          sendSSE('done', {
            provider: chunk.provider,
            model: chunk.model,
            usage: chunk.usage,
            full_content: fullResponse,
            chunk_count: chunkCount,
            latency: latency,
            character: characterInfo?.name || null,
            conversation_id: conversationId || 'default',
            timestamp: new Date().toISOString()
          });
          break;
        }
      }

    } catch (error) {
      console.error('[StreamingController] Fatal error:', error);
      sendSSE('fatal_error', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
    } finally {
      res.end();
    }
  }

  handleOptions(req, res) {
    const corsOrigin = getCorsOrigin(req);
    res.writeHead(200, {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
  }

  async handleStatusRequest(req, res) {
    try {
      const availableProviders = await this.providerFactory.getAvailableProviders();
      const activeProvider = await this.providerFactory.getActiveProvider();
      const activeModel = this.providerFactory.getActiveModel();

      res.json({
        status: 'online',
        active_model: activeModel,
        active_provider: activeProvider.getName(),
        available_providers: availableProviders.map(p => ({
          name: p.type,
          model: p.model,
          connected: p.health.connected,
          type: p.health.type,
          details: p.health.details || {}
        })),
        configuration: {
          fallback_chain: this.providerFactory.getConfig().fallback_chain || [],
          auto_switch: this.providerFactory.getConfig().fallback_behavior?.auto_switch || false
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('[StreamingController] Status error:', error);
      res.status(500).json({
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  async handleSwitchRequest(req, res) {
    try {
      const { new_model } = req.body;

      if (!new_model) {
        return res.status(400).json({
          error: 'new_model is required'
        });
      }

      console.log(`[StreamingController] Switching to model: ${new_model}`);

      const success = await this.providerFactory.switchProvider(new_model);

      if (success) {
        res.json({
          success: true,
          message: `Successfully switched to ${new_model}`,
          active_model: new_model,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(400).json({
          success: false,
          error: `Failed to switch to ${new_model}`,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      console.error('[StreamingController] Switch error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
}

module.exports = StreamingController;
