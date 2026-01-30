const { completion } = require('litellm');
const BaseLLMProvider = require('./BaseLLMProvider');
const axios = require('axios');

/**
 * LiteLLM Provider - Unified interface for multiple LLM providers
 * Supports Ollama, OpenAI, Anthropic, and other LiteLLM-compatible providers
 */
class LiteLLMProvider extends BaseLLMProvider {
  constructor(model, config = {}) {
    super(config);
    this.model = model;
    this.providerInfo = this.extractProviderInfo(model);
  }

  /**
   * Extract provider information from model string
   * @param {string} model - Model string (e.g., 'ollama/llama3', 'openai/gpt-4')
   * @returns {Object} Provider information
   */
  extractProviderInfo(model) {
    const [provider, modelName] = model.split('/');
    return {
      provider: provider || 'openai',
      modelName: modelName || model,
      isLocal: provider === 'ollama' || provider === 'lmstudio'
    };
  }

  /**
   * Generate streaming response using LiteLLM
   * @param {Object} roleplayContext - Roleplay context
   * @returns {AsyncGenerator} Stream chunks
   */
  async* generateStream(roleplayContext) {
    try {
      const messages = this.formatMessages(roleplayContext);
      
      // Configure LiteLLM based on provider type
      const litellmConfig = this.getLiteLLMConfig();
      
      console.log(`[${this.getName()}] Starting stream with model: ${this.model}`);
      
      const stream = await completion({
        model: this.model,
        messages,
        stream: true,
        timeout: this.config.timeout || 30000,
        max_tokens: this.config.maxTokens || 2048,
        temperature: this.config.temperature || 0.7,
        ...litellmConfig
      });

      let fullResponse = '';
      
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        
        if (content) {
          fullResponse += content;
          yield this.createContentChunk(content, {
            usage: chunk.usage,
            finish_reason: chunk.choices[0]?.finish_reason
          });
        }

        // Check if stream is complete
        if (chunk.choices[0]?.finish_reason) {
          yield this.createDoneChunk(
            chunk.usage,
            fullResponse
          );
          break;
        }
      }
      
    } catch (error) {
      console.error(`[${this.getName()}] Stream error:`, error);
      yield this.createErrorChunk(error);
    }
  }

  /**
   * Check provider connection status
   * @returns {Promise<Object>} Connection status
   */
  async checkConnection() {
    try {
      const { providerInfo } = this;
      
      if (providerInfo.isLocal) {
        // Health check for local providers
        if (providerInfo.provider === 'ollama') {
          const response = await axios.get('http://localhost:11434/api/tags', {
            timeout: 5000
          });
          return {
            connected: response.status === 200,
            provider: this.getName(),
            type: 'local',
            details: {
              models: response.data?.models?.length || 0,
              baseUrl: 'http://localhost:11434'
            }
          };
        } else if (providerInfo.provider === 'lmstudio') {
          const response = await axios.get('http://localhost:1234/v1/models', {
            timeout: 5000
          });
          return {
            connected: response.status === 200,
            provider: this.getName(),
            type: 'local',
            details: {
              models: response.data?.data?.length || 0,
              baseUrl: 'http://localhost:1234/v1'
            }
          };
        }
      } else {
        // Health check for cloud providers
        await completion({
          model: this.model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1,
          ...this.getLiteLLMConfig()
        });
        
        return {
          connected: true,
          provider: this.getName(),
          type: 'cloud',
          details: {
            provider: providerInfo.provider,
            model: providerInfo.modelName
          }
        };
      }
    } catch (error) {
      const isOffline = error.code === 'ECONNREFUSED' || 
                       error.code === 'ETIMEDOUT' ||
                       error.response?.status === 0;
      
      return {
        connected: false,
        provider: this.getName(),
        type: this.providerInfo.isLocal ? 'local' : 'cloud',
        error: error.message,
        details: {
          isNetworkError: isOffline,
          code: error.code
        }
      };
    }
  }

  /**
   * Get available models for this provider
   * @returns {Promise<Array>} Available models
   */
  async getModels() {
    try {
      const { providerInfo } = this;
      
      if (providerInfo.isLocal) {
        if (providerInfo.provider === 'ollama') {
          const response = await axios.get('http://localhost:11434/api/tags');
          return response.data?.models?.map(model => ({
            name: model.name,
            size: model.size,
            modified_at: model.modified_at,
            provider: 'ollama'
          })) || [];
        } else if (providerInfo.provider === 'lmstudio') {
          const response = await axios.get('http://localhost:1234/v1/models');
          return response.data?.data?.map(model => ({
            name: model.id,
            provider: 'lmstudio'
          })) || [];
        }
      } else {
        // For cloud providers, return common models
        if (providerInfo.provider === 'openai') {
          return [
            { name: 'gpt-4o', provider: 'openai' },
            { name: 'gpt-4o-mini', provider: 'openai' },
            { name: 'gpt-3.5-turbo', provider: 'openai' }
          ];
        } else if (providerInfo.provider === 'anthropic') {
          return [
            { name: 'claude-3-5-sonnet', provider: 'anthropic' },
            { name: 'claude-3-5-haiku', provider: 'anthropic' }
          ];
        }
      }
      
      return [];
    } catch (error) {
      console.error(`[${this.getName()}] Error getting models:`, error);
      return [];
    }
  }

  /**
   * Get provider type
   * @returns {string} 'local' or 'cloud'
   */
  getProviderType() {
    return this.providerInfo.isLocal ? 'local' : 'cloud';
  }

  /**
   * Get LiteLLM configuration based on provider
   * @returns {Object} LiteLLM configuration
   */
  getLiteLLMConfig() {
    const { providerInfo } = this;
    
    if (providerInfo.isLocal) {
      if (providerInfo.provider === 'ollama') {
        return {
          api_base: 'http://localhost:11434',
          api_key: 'not-needed'
        };
      } else if (providerInfo.provider === 'lmstudio') {
        return {
          api_base: 'http://localhost:1234/v1',
          api_key: 'not-needed'
        };
      }
    } else {
      // Cloud providers use environment variables
      return {
        api_key: this.config.api_key || process.env[`${providerInfo.provider.toUpperCase()}_API_KEY`]
      };
    }
    
    return {};
  }

  /**
   * Get provider information
   * @returns {Object} Provider details
   */
  getProviderInfo() {
    return this.providerInfo;
  }
}

module.exports = LiteLLMProvider;