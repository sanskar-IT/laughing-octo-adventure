const LiteLLMProvider = require('./LiteLLMProvider');
const fs = require('fs');
const path = require('path');

/**
 * Factory for creating and managing LLM providers
 * Handles dynamic configuration, fallback chains, and hot-swapping
 */
class ProviderFactory {
  constructor() {
    this.currentProvider = null;
    this.config = null;
    this.configPath = path.join(__dirname, '../config/llm-providers.json');
    this.lastConfigCheck = 0;
    this.configCheckInterval = 30000; // 30 seconds
  }

  /**
   * Load configuration from file
   * @returns {Object} Provider configuration
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        this.config = JSON.parse(configData);
        console.log('Loaded LLM provider configuration');
      } else {
        // Create default configuration
        this.config = this.getDefaultConfig();
        this.saveConfig();
      }
    } catch (error) {
      console.error('Error loading provider config:', error);
      this.config = this.getDefaultConfig();
    }
    
    return this.config;
  }

  /**
   * Get default configuration
   * @returns {Object} Default provider configuration
   */
  getDefaultConfig() {
    return {
      active_provider: "ollama/llama3.2",
      fallback_chain: ["ollama/llama3.2", "openai/gpt-4o-mini"],
      providers: {
        ollama: {
          base_url: "http://localhost:11434",
          timeout: 30000,
          models: ["llama3.2", "qwen2.5", "mistral"]
        },
        openai: {
          api_key: "${OPENAI_API_KEY}",
          timeout: 30000,
          models: ["gpt-4o-mini", "gpt-4o"]
        },
        anthropic: {
          api_key: "${ANTHROPIC_API_KEY}",
          timeout: 45000,
          models: ["claude-3-5-sonnet", "claude-3-5-haiku"]
        }
      },
      fallback_behavior: {
        auto_switch: true,
        notify_user: true,
        retry_count: 2
      }
    };
  }

  /**
   * Save configuration to file
   */
  saveConfig() {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      console.log('Saved LLM provider configuration');
    } catch (error) {
      console.error('Error saving provider config:', error);
    }
  }

  /**
   * Get active provider instance
   * @returns {Promise<LiteLLMProvider>} Provider instance
   */
  async getActiveProvider() {
    // Check if we need to reload config
    if (Date.now() - this.lastConfigCheck > this.configCheckInterval) {
      this.loadConfig();
      this.lastConfigCheck = Date.now();
    }

    if (!this.config) {
      this.loadConfig();
    }

    const activeModel = this.config.active_provider;
    
    // Extract provider configuration
    const [providerType, modelName] = activeModel.split('/');
    const providerConfig = this.config.providers[providerType];
    
    if (!providerConfig) {
      throw new Error(`Provider ${providerType} not found in configuration`);
    }

    // Create provider instance
    const provider = new LiteLLMProvider(
      activeModel,
      {
        ...providerConfig,
        model: modelName
      }
    );

    console.log(`Active provider: ${provider.getName()} (${activeModel})`);
    return provider;
  }

  /**
   * Get fallback provider when primary fails
   * @param {string} failedModel - Model that failed
   * @returns {Promise<LiteLLMProvider|null>} Fallback provider or null
   */
  async getFallbackProvider(failedModel = null) {
    if (!this.config || !this.config.fallback_chain) {
      return null;
    }

    // Get fallback chain excluding failed model
    const fallbackChain = this.config.fallback_chain.filter(model => model !== failedModel);
    
    if (fallbackChain.length === 0) {
      return null;
    }

    // Try each provider in the fallback chain
    for (const model of fallbackChain) {
      try {
        const [providerType, modelName] = model.split('/');
        const providerConfig = this.config.providers[providerType];
        
        if (!providerConfig) continue;

        const provider = new LiteLLMProvider(
          model,
          {
            ...providerConfig,
            model: modelName
          }
        );

        // Check if provider is healthy
        const health = await provider.checkConnection();
        if (health.connected) {
          console.log(`Fallback provider found: ${provider.getName()} (${model})`);
          return provider;
        }
      } catch (error) {
        console.warn(`Fallback provider ${model} failed:`, error.message);
      }
    }

    return null;
  }

  /**
   * Get all available providers
   * @returns {Promise<Array>} Array of provider information
   */
  async getAvailableProviders() {
    if (!this.config) {
      this.loadConfig();
    }

    const availableProviders = [];
    
    for (const [providerType, config] of Object.entries(this.config.providers)) {
      try {
        // Test with a generic model from the provider
        const testModel = `${providerType}/${config.models[0]}`;
        const provider = new LiteLLMProvider(testModel, config);
        
        const health = await provider.checkConnection();
        availableProviders.push({
          type: providerType,
          model: testModel,
          providerInstance: provider,
          health,
          config: config
        });
      } catch (error) {
        console.warn(`Provider ${providerType} unavailable:`, error.message);
        availableProviders.push({
          type: providerType,
          model: null,
          providerInstance: null,
          health: { connected: false, error: error.message },
          config
        });
      }
    }
    
    return availableProviders;
  }

  /**
   * Switch active provider
   * @param {string} newModel - New model to use
   * @returns {Promise<boolean>} Success status
   */
  async switchProvider(newModel) {
    try {
      // Validate new model exists in configuration
      const [providerType, modelName] = newModel.split('/');
      const providerConfig = this.config.providers[providerType];
      
      if (!providerConfig) {
        throw new Error(`Provider ${providerType} not configured`);
      }

      // Test the new provider
      const testProvider = new LiteLLMProvider(newModel, {
        ...providerConfig,
        model: modelName
      });

      const health = await testProvider.checkConnection();
      if (!health.connected) {
        throw new Error(`Provider ${newModel} is not accessible`);
      }

      // Update configuration
      this.config.active_provider = newModel;
      this.saveConfig();
      
      // Clear current provider cache
      this.currentProvider = null;
      
      console.log(`Switched to provider: ${testProvider.getName()} (${newModel})`);
      return true;
      
    } catch (error) {
      console.error(`Failed to switch to provider ${newModel}:`, error);
      return false;
    }
  }

  /**
   * Update configuration
   * @param {Object} updates - Configuration updates
   */
  updateConfig(updates) {
    if (!this.config) {
      this.loadConfig();
    }

    // Deep merge updates
    this.config = this.mergeDeep(this.config, updates);
    this.saveConfig();
    
    // Clear provider cache to force reload
    this.currentProvider = null;
  }

  /**
   * Deep merge objects
   * @param {Object} target - Target object
   * @param {Object} source - Source object
   * @returns {Object} Merged object
   */
  mergeDeep(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.mergeDeep(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }

  /**
   * Get current configuration
   * @returns {Object} Current configuration
   */
  getConfig() {
    if (!this.config) {
      this.loadConfig();
    }
    return { ...this.config };
  }

  /**
   * Get active model name
   * @returns {string} Active model
   */
  getActiveModel() {
    if (!this.config) {
      this.loadConfig();
    }
    return this.config.active_provider;
  }
}

// Singleton instance
const providerFactory = new ProviderFactory();

module.exports = providerFactory;