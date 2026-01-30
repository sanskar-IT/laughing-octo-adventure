/**
 * TTS Content Validator
 * Validates and sanitizes text input before sending to TTS service
 */

export interface TTSValidationResult {
  valid: boolean;
  text?: string;
  error?: string;
  warnings?: string[];
  isEmpty?: boolean;
  isTooLong?: boolean;
  requiresTruncation?: boolean;
}

export class TTSContentValidator {
  private static readonly MAX_LENGTH = 1000;
  private static readonly MIN_LENGTH = 2;

  static validate(text: string | null | undefined): TTSValidationResult {
    // Stage 1: Null/Undefined check
    if (text === null || text === undefined) {
      return {
        valid: false,
        error: 'TTS input is null or undefined',
        isEmpty: true
      };
    }

    // Stage 2: Type check
    if (typeof text !== 'string') {
      return {
        valid: false,
        error: `TTS input must be string, got ${typeof text}`,
        isEmpty: true
      };
    }

    // Stage 3: Trim and check empty
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return {
        valid: false,
        error: 'TTS input is empty or whitespace only',
        isEmpty: true
      };
    }

    // Stage 4: Check minimum meaningful content
    // Remove punctuation and check if anything remains
    const contentOnly = trimmed.replace(/[\p{P}\s]/gu, '');
    if (contentOnly.length < this.MIN_LENGTH) {
      return {
        valid: false,
        error: `TTS input has insufficient phonetic content (${contentOnly.length} chars)`,
        isEmpty: true
      };
    }

    const warnings: string[] = [];
    let processedText = trimmed;
    let requiresTruncation = false;

    // Stage 5: Check length limits
    if (trimmed.length > this.MAX_LENGTH) {
      warnings.push(`Text truncated from ${trimmed.length} to ${this.MAX_LENGTH} characters`);
      processedText = this.smartTruncate(trimmed, this.MAX_LENGTH);
      requiresTruncation = true;
    }

    // Stage 6: Sanitize problematic characters
    const sanitized = this.sanitizeForTTS(processedText);
    if (sanitized !== processedText) {
      warnings.push('Special characters were sanitized for better TTS output');
      processedText = sanitized;
    }

    return {
      valid: true,
      text: processedText,
      warnings: warnings.length > 0 ? warnings : undefined,
      requiresTruncation
    };
  }

  private static smartTruncate(text: string, maxLength: number): string {
    // Try to truncate at sentence boundary
    const truncated = text.substring(0, maxLength);

    // Find last sentence-ending punctuation
    const lastSentence = truncated.match(/.*[.!?]/);
    if (lastSentence && lastSentence[0].length > maxLength * 0.8) {
      // Truncate at sentence end if we have at least 80% of max length
      return lastSentence[0];
    }

    // Otherwise truncate at word boundary
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.8) {
      return truncated.substring(0, lastSpace) + '.';
    }

    return truncated + '...';
  }

  private static sanitizeForTTS(text: string): string {
    return text
      // Remove zero-width characters
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      // Replace multiple spaces with single space
      .replace(/\s+/g, ' ')
      // Normalize quotes
      .replace(/[""''']/g, '"')
      // Remove control characters
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
   * Quick check if text is suitable for TTS
   */
  static isValidForTTS(text: string): boolean {
    return this.validate(text).valid;
  }

  /**
   * Get validation error message for display
   */
  static getErrorMessage(result: TTSValidationResult): string {
    if (result.valid) {
      return '';
    }
    return result.error || 'Invalid TTS input';
  }
}
