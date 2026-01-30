/**
 * Abstract base class for all LLM providers
 * Provides unified interface for streaming, health checks, and model management
 */

class BaseLLMProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = this.constructor.name;
    this.type = this.getProviderType();
  }

  /**
   * Generate streaming response for given roleplay context
   * @param {Object} roleplayContext - Roleplay context with system prompt and messages
   * @returns {AsyncGenerator} Async generator of LLM stream chunks
   */
  async* generateStream(roleplayContext) {
    throw new Error('generateStream must be implemented by subclass');
  }

  /**
   * Check if provider is healthy and accessible
   * @returns {Promise<ConnectionStatus>} Connection status with details
   */
  async checkConnection() {
    throw new Error('checkConnection must be implemented by subclass');
  }

  /**
   * Get available models for this provider
   * @returns {Promise<Array<ModelInfo>>} Array of available models
   */
  async getModels() {
    throw new Error('getModels must be implemented by subclass');
  }

  /**
   * Get provider name for identification
   * @returns {string} Provider name
   */
  getName() {
    return this.name;
  }

  /**
   * Get provider type (local/cloud)
   * @returns {string} 'local' or 'cloud'
   */
  getProviderType() {
    throw new Error('getProviderType must be implemented by subclass');
  }

  /**
   * Format messages for specific provider
   * @param {Object} roleplayContext - Roleplay context
   * @returns {Array} Formatted messages for provider
   */
  formatMessages(roleplayContext) {
    const messages = [
      { role: 'system', content: roleplayContext.systemPrompt },
      ...roleplayContext.messages
    ];
    return messages;
  }

  /**
   * Create standardized error response
   * @param {Error} error - Error object
   * @returns {Object} Standardized error chunk
   */
  createErrorChunk(error) {
    return {
      content: '',
      provider: this.getName(),
      model: this.getModel(),
      error: error.message,
      done: true,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create standardized content chunk
   * @param {string} content - Content chunk
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Standardized content chunk
   */
  createContentChunk(content, metadata = {}) {
    return {
      content,
      provider: this.getName(),
      model: this.getModel(),
      done: false,
      timestamp: new Date().toISOString(),
      ...metadata
    };
  }

  /**
   * Create standardized done chunk
   * @param {Object} usage - Token usage information
   * @param {string} fullContent - Complete response content
   * @returns {Object} Standardized done chunk
   */
  createDoneChunk(usage, fullContent) {
    return {
      content: '',
      provider: this.getName(),
      model: this.getModel(),
      done: true,
      usage,
      full_content: fullContent,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get current model name
   * @returns {string} Model name
   */
  getModel() {
    return this.config.model || 'default';
  }
}

module.exports = BaseLLMProvider;