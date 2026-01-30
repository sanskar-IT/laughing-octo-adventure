/**
 * Parser for Chub AI Character Card V2 format
 * Handles JSON parsing, validation, and system prompt generation
 */
class CharacterCardParser {
  /**
   * Parse character card from JSON data
   * @param {Object} characterData - Raw character card data
   * @returns {Object} Parsed character information
   */
  static parse(characterData) {
    // Validate format
    if (characterData.spec !== 'chara_card_v2') {
      throw new Error('Invalid character card format. Expected "chara_card_v2"');
    }

    if (characterData.spec_version !== '2.0') {
      throw new Error('Invalid character card version. Expected "2.0"');
    }

    const data = characterData.data;
    
    // Validate required fields
    const requiredFields = ['name', 'description', 'personality', 'first_mes'];
    for (const field of requiredFields) {
      if (!data[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    return {
      name: data.name,
      description: data.description,
      personality: data.personality,
      scenario: data.scenario || '',
      firstMessage: data.first_mes,
      exampleMessages: this.parseExampleMessages(data.mes_example || ''),
      systemPrompt: this.generateSystemPrompt(data),
      creatorNotes: data.creator_notes || '',
      postHistoryInstructions: data.post_history_instructions || '',
      alternateGreetings: data.alternate_greetings || [],
      tags: data.tags || [],
      creator: data.creator || 'Unknown',
      characterVersion: data.character_version || '1.0',
      extensions: data.extensions || {},
      characterBook: data.character_book || null,
      
      // Metadata for the system
      raw: data,
      parsedAt: new Date().toISOString()
    };
  }

  /**
   * Generate system prompt from character data
   * @param {Object} data - Character data object
   * @returns {string} Generated system prompt
   */
  static generateSystemPrompt(data) {
    let prompt = `You are ${data.name}.\n\n`;
    
    // Add personality
    if (data.personality) {
      prompt += `Personality: ${data.personality}\n\n`;
    }
    
    // Add description/background
    if (data.description) {
      prompt += `Background: ${data.description}\n\n`;
    }
    
    // Add scenario
    if (data.scenario) {
      prompt += `Scenario: ${data.scenario}\n\n`;
    }

    // Add example messages
    if (data.mes_example) {
      prompt += `Example responses:\n${this.cleanExamples(data.mes_example)}\n\n`;
    }

    // Add custom system prompt if provided
    if (data.system_prompt) {
      // Replace {{original}} placeholder
      const basePrompt = prompt.trim();
      prompt = data.system_prompt.replace(/\{\{original\}\}/g, basePrompt);
    }

    // Add post-history instructions if provided
    if (data.post_history_instructions) {
      prompt += `\nPost-history Instructions: ${data.post_history_instructions}`;
    }

    // Ensure character stays in character
    prompt += `\n\nIMPORTANT: Stay in character as ${data.name} at all times. Never break the fourth wall or acknowledge that this is a roleplay. Maintain your personality and speech patterns consistently.`;

    return prompt;
  }

  /**
   * Parse example messages from mes_example string
   * @param {string} mesExample - Example messages string
   * @returns {Array} Parsed example messages
   */
  static parseExampleMessages(mesExample) {
    const examples = [];
    
    // Split by <START> tokens
    const sections = mesExample.split('<START>').filter(section => section.trim());
    
    sections.forEach(section => {
      // Extract user and character messages
      const userMatch = section.match(/\{\{user\}\}: *(.+?)(?=\n|$)/s);
      const charMatch = section.match(/\{\{char\}\}: *(.+?)(?=\n|$)/s);
      
      if (userMatch && charMatch) {
        examples.push({
          user: userMatch[1].trim(),
          character: charMatch[1].trim()
        });
      }
    });
    
    return examples;
  }

  /**
   * Clean example messages for system prompt
   * @param {string} mesExample - Example messages string
   * @returns {string} Cleaned examples
   */
  static cleanExamples(mesExample) {
    return mesExample
      .split('<START>')
      .filter(section => section.trim())
      .map(section => {
        // Convert to readable format
        const userMatch = section.match(/\{\{user\}\}: *(.+?)(?=\n|$)/s);
        const charMatch = section.match(/\{\{char\}\}: *(.+?)(?=\n|$)/s);
        
        if (userMatch && charMatch) {
          return `User: ${userMatch[1].trim()}\n${section.includes('char') ? data.name : 'Character'}: ${charMatch[1].trim()}`;
        }
        return section;
      })
      .join('\n\n');
  }

  /**
   * Validate character card format
   * @param {Object} characterData - Character card data
   * @returns {Object} Validation result
   */
  static validate(characterData) {
    const errors = [];
    const warnings = [];
    
    try {
      // Check format version
      if (!characterData.spec) {
        errors.push('Missing spec field');
      } else if (characterData.spec !== 'chara_card_v2') {
        errors.push(`Invalid spec: ${characterData.spec}. Expected "chara_card_v2"`);
      }

      if (!characterData.spec_version) {
        errors.push('Missing spec_version field');
      } else if (characterData.spec_version !== '2.0') {
        warnings.push(`Unexpected spec_version: ${characterData.spec_version}. Expected "2.0"`);
      }

      const data = characterData.data;
      if (!data) {
        errors.push('Missing data field');
        return { valid: false, errors, warnings };
      }

      // Check required fields
      const requiredFields = ['name', 'description', 'personality', 'first_mes'];
      for (const field of requiredFields) {
        if (!data[field]) {
          errors.push(`Missing required field: ${field}`);
        } else if (typeof data[field] !== 'string') {
          errors.push(`Field ${field} must be a string`);
        }
      }

      // Validate mes_example format if present
      if (data.mes_example) {
        const hasStartTokens = data.mes_example.includes('<START>');
        const hasPlaceholders = data.mes_example.includes('{{user}}') || data.mes_example.includes('{{char}}');
        
        if (!hasStartTokens) {
          warnings.push('mes_example should use <START> tokens to separate conversations');
        }
        
        if (!hasPlaceholders) {
          warnings.push('mes_example should use {{user}} and {{char}} placeholders');
        }
      }

      // Validate character book if present
      if (data.character_book) {
        if (!data.character_book.entries || !Array.isArray(data.character_book.entries)) {
          errors.push('character_book.entries must be an array');
        } else {
          data.character_book.entries.forEach((entry, index) => {
            if (!entry.keys || !Array.isArray(entry.keys)) {
              errors.push(`character_book entry ${index} missing keys array`);
            }
            if (!entry.content) {
              errors.push(`character_book entry ${index} missing content`);
            }
          });
        }
      }

    } catch (error) {
      errors.push(`Validation error: ${error.message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Create minimal character card from basic info
   * @param {Object} basicInfo - Basic character information
   * @returns {Object} Character card data
   */
  static createBasicCard(basicInfo) {
    return {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: basicInfo.name || 'Unnamed Character',
        description: basicInfo.description || 'A mysterious character.',
        personality: basicInfo.personality || 'Friendly and curious.',
        scenario: basicInfo.scenario || '',
        first_mes: basicInfo.firstMessage || "Hello! I'm ${basicInfo.name}. Nice to meet you!",
        mes_example: basicInfo.exampleMessage || `<START>\n{{user}}: Hello!\n{{char}}: It's a pleasure to meet you!`,
        tags: basicInfo.tags || [],
        creator: basicInfo.creator || 'AI Companion'
      }
    };
  }

  /**
   * Convert character card to export format
   * @param {Object} parsedCharacter - Parsed character data
   * @returns {string} JSON string
   */
  static exportCharacter(parsedCharacter) {
    const exportData = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: parsedCharacter.raw
    };

    return JSON.stringify(exportData, null, 2);
  }
}

module.exports = CharacterCardParser;