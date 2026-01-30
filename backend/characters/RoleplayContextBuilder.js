const CharacterCardParser = require('./CharacterCardParser');

/**
 * Builder for creating roleplay contexts
 * Combines character information with conversation history and memory
 */
class RoleplayContextBuilder {
  /**
   * Build roleplay context from character and conversation
   * @param {Object} characterCard - Parsed character card
   * @param {Array} conversationHistory - Chat message history
   * @param {string} userMessage - Current user message
   * @param {Object} memoryManager - Memory manager instance
   * @returns {Object} Roleplay context for LLM
   */
  static async buildContext(characterCard, conversationHistory, userMessage, memoryManager) {
    try {
      // Get relevant context from memory if available
      let contextMessages = [];
      if (memoryManager) {
        // Try to get conversation context
        if (characterCard && characterCard.name) {
          // Use character name for conversation identification
          const conversationId = `character-${characterCard.name}`;
          
          try {
            contextMessages = await memoryManager.getContextWindow(conversationId);
          } catch (error) {
            console.warn('Could not get memory context:', error.message);
            contextMessages = [];
          }
        }
      }

      // Combine memory context with current conversation
      let messages = [];
      
      // Add memory context (most recent)
      if (contextMessages.length > 0) {
        // Take last few messages from memory to provide context
        const memorySlice = contextMessages.slice(-5); // Last 5 messages for context
        messages = memorySlice.map(msg => ({
          role: msg.role,
          content: msg.content
        }));
      }

      // Add current conversation if different from memory context
      if (conversationHistory && conversationHistory.length > 0) {
        // Filter out messages that might overlap with memory context
        const newMessages = conversationHistory.filter(msg => {
          // Simple check - in production, you'd want more sophisticated deduplication
          return !contextMessages.some(memMsg => 
            memMsg.content === msg.content && 
            Math.abs(new Date(memMsg.timestamp) - new Date(msg.timestamp || Date.now())) < 1000
          );
        });
        
        messages = messages.concat(newMessages);
      }

      // Build system prompt
      let systemPrompt = "You are a helpful AI assistant.";
      
      if (characterCard) {
        systemPrompt = characterCard.systemPrompt;
      }

      // Create roleplay context
      const roleplayContext = {
        systemPrompt,
        characterInfo: characterCard,
        messages,
        metadata: {
          timestamp: new Date().toISOString(),
          characterName: characterCard ? characterCard.name : 'Assistant',
          model: null, // Will be set by provider
          contextSize: messages.length,
          hasMemoryContext: contextMessages.length > 0,
          userMessageLength: userMessage ? userMessage.length : 0
        }
      };

      // Add current user message if not already included
      if (userMessage && (!messages.length > 0 || messages[messages.length - 1].content !== userMessage)) {
        roleplayContext.messages.push({
          role: 'user',
          content: userMessage
        });
      }

      return roleplayContext;

    } catch (error) {
      console.error('Error building roleplay context:', error);
      
      // Fallback to basic context
      return {
        systemPrompt: characterCard ? characterCard.systemPrompt : "You are a helpful AI assistant.",
        messages: conversationHistory || [],
        metadata: {
          timestamp: new Date().toISOString(),
          characterName: characterCard ? characterCard.name : 'Assistant',
          model: null,
          contextSize: conversationHistory ? conversationHistory.length : 0,
          hasMemoryContext: false,
          userMessageLength: userMessage ? userMessage.length : 0,
          error: error.message
        }
      };
    }
  }

  /**
   * Build context for characterless chat
   * @param {Array} conversationHistory - Chat message history
   * @param {string} userMessage - Current user message
   * @param {Object} memoryManager - Memory manager instance
   * @param {string} systemPrompt - Custom system prompt
   * @returns {Object} Basic roleplay context
   */
  static async buildBasicContext(conversationHistory, userMessage, memoryManager, systemPrompt = null) {
    try {
      // Get memory context
      let contextMessages = [];
      if (memoryManager) {
        try {
          contextMessages = await memoryManager.getContextWindow('default-session');
        } catch (error) {
          console.warn('Could not get memory context:', error.message);
          contextMessages = [];
        }
      }

      // Combine contexts
      let messages = [];
      
      if (contextMessages.length > 0) {
        const memorySlice = contextMessages.slice(-5);
        messages = memorySlice.map(msg => ({
          role: msg.role,
          content: msg.content
        }));
      }

      if (conversationHistory) {
        messages = messages.concat(conversationHistory);
      }

      return {
        systemPrompt: systemPrompt || "You are a friendly AI companion. You are caring, helpful, and engaging. You respond concisely but warmly.",
        characterInfo: null,
        messages,
        metadata: {
          timestamp: new Date().toISOString(),
          characterName: 'Assistant',
          model: null,
          contextSize: messages.length,
          hasMemoryContext: contextMessages.length > 0,
          userMessageLength: userMessage ? userMessage.length : 0
        }
      };

    } catch (error) {
      console.error('Error building basic context:', error);
      
      return {
        systemPrompt: systemPrompt || "You are a friendly AI companion.",
        characterInfo: null,
        messages: conversationHistory || [],
        metadata: {
          timestamp: new Date().toISOString(),
          characterName: 'Assistant',
          model: null,
          contextSize: conversationHistory ? conversationHistory.length : 0,
          hasMemoryContext: false,
          error: error.message
        }
      };
    }
  }

  /**
   * Estimate token count for context
   * @param {Object} roleplayContext - Roleplay context
   * @returns {number} Estimated token count
   */
  static estimateTokenCount(roleplayContext) {
    if (!roleplayContext) return 0;

    let totalTokens = 0;
    
    // Estimate system prompt tokens (4 chars per token)
    if (roleplayContext.systemPrompt) {
      totalTokens += Math.ceil(roleplayContext.systemPrompt.length / 4);
    }

    // Estimate message tokens
    if (roleplayContext.messages) {
      roleplayContext.messages.forEach(msg => {
        if (msg.content) {
          totalTokens += Math.ceil(msg.content.length / 4);
        }
      });
    }

    return totalTokens;
  }

  /**
   * Truncate context if too long
   * @param {Object} roleplayContext - Roleplay context
   * @param {number} maxTokens - Maximum allowed tokens
   * @returns {Object} Truncated roleplay context
   */
  static truncateContext(roleplayContext, maxTokens = 4096) {
    const estimatedTokens = this.estimateTokenCount(roleplayContext);
    
    if (estimatedTokens <= maxTokens) {
      return roleplayContext;
    }

    // Truncate messages from the beginning, keeping system prompt and recent messages
    let messages = [...(roleplayContext.messages || [])];
    let currentTokens = Math.ceil((roleplayContext.systemPrompt || '').length / 4);
    
    // Remove oldest messages until under token limit
    while (messages.length > 0 && currentTokens > maxTokens) {
      const removedMessage = messages.shift();
      currentTokens -= Math.ceil((removedMessage.content || '').length / 4);
    }

    return {
      ...roleplayContext,
      messages,
      metadata: {
        ...roleplayContext.metadata,
        truncated: true,
        originalTokenCount: estimatedTokens,
        truncatedTokenCount: currentTokens
      }
    };
  }

  /**
   * Create context for streaming response
   * @param {Object} roleplayContext - Base roleplay context
   * @param {string} partialResponse - Partial response for context
   * @returns {Object} Streaming context
   */
  static createStreamingContext(roleplayContext, partialResponse = '') {
    return {
      ...roleplayContext,
      metadata: {
        ...roleplayContext.metadata,
        streaming: true,
        partialResponse,
        streamStart: new Date().toISOString()
      }
    };
  }
}

module.exports = RoleplayContextBuilder;