/**
 * Defensive TTS Service with Comprehensive Error Handling
 * 
 * This service integrates all QA defensive patterns:
 * - Content validation before sending to TTS
 * - Audio system resilience with autoplay handling
 * - Resource guard to prevent memory leaks
 * - Proper cleanup and cancellation support
 * - Fallback mechanisms for various failure modes
 */

import axios from 'axios';
import { TTSContentValidator } from './ttsContentValidator';
import { AudioResilienceManager } from './audioResilienceManager';
import { ResourceGuard } from './resourceGuard';

export interface VisemeData {
  time: number;
  value: number;
  duration: number;
}

interface TTSResponse {
  success: boolean;
  audio?: string;
  visemes: VisemeData[];
  timestamp: string;
}

interface SpeakOptions {
  text: string;
  onViseme?: (viseme: VisemeData) => void;
  onProgress?: (progress: { chunkCount: number; totalBytes: number }) => void;
  onError?: (error: string) => void;
  stream?: boolean;
}

class DefensiveTTSService {
  private isInitialized = false;
  private baseUrl = 'http://localhost:8000';
  private audioManager: AudioResilienceManager;
  private resourceGuard: ResourceGuard;

  constructor() {
    this.audioManager = new AudioResilienceManager();
    this.resourceGuard = new ResourceGuard();
  }

  /**
   * Initialize TTS service with defensive patterns
   */
  async initialize(): Promise<boolean> {
    try {
      const result = await this.audioManager.initialize();
      
      if (result.requiresUserInteraction) {
        // Audio will work after user interaction
        console.log('[TTS] Audio initialized, waiting for user interaction');
      }
      
      this.isInitialized = result.success;
      return result.success;
    } catch (error) {
      console.error('[TTS] Initialization failed:', error);
      return false;
    }
  }

  /**
   * Check if TTS server is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, {
        timeout: 5000
      });
      return response.data.status === 'healthy';
    } catch (error) {
      console.warn('[TTS] Health check failed:', error);
      return false;
    }
  }

  /**
   * Main speak method with comprehensive defensive patterns
   */
  async speak(options: SpeakOptions): Promise<boolean> {
    const { text, onViseme, onProgress, onError, stream = true } = options;

    // Validate input before anything else
    const validation = TTSContentValidator.validate(text);
    
    if (!validation.valid) {
      console.warn('[TTS] Content validation failed:', validation.error);
      onError?.(validation.error || 'Invalid TTS input');
      return false;
    }

    if (validation.warnings) {
      console.log('[TTS] Validation warnings:', validation.warnings);
    }

    const safeText = validation.text!;

    // Initialize if needed
    if (!this.isInitialized) {
      const initSuccess = await this.initialize();
      if (!initSuccess) {
        onError?.('Failed to initialize audio system');
        return false;
      }
    }

    // Acquire exclusive operation (cancels previous)
    const abortController = await this.resourceGuard.acquireExclusiveOperation('TTS');
    if (!abortController) {
      onError?.('Could not acquire TTS resources');
      return false;
    }

    try {
      console.log(`[TTS] Speaking: "${safeText.substring(0, 50)}..." (streaming=${stream})`);

      if (stream) {
        return await this.speakStreaming(safeText, onViseme, onProgress, abortController);
      } else {
        return await this.speakBuffered(safeText, onViseme, abortController);
      }
    } catch (error: any) {
      console.error('[TTS] Speak error:', error);
      onError?.(error.message || 'TTS failed');
      return false;
    }
  }

  /**
   * Streaming TTS with resource limits
   */
  private async speakStreaming(
    text: string,
    onViseme?: (viseme: VisemeData) => void,
    onProgress?: (progress: { chunkCount: number; totalBytes: number }) => void,
    abortController?: AbortController
  ): Promise<boolean> {
    // Get visemes first
    const visemes = await this.generateVisemes(text);
    if (visemes.length === 0) {
      console.warn('[TTS] No visemes generated');
    }

    // Fetch with streaming
    const response = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, stream: true }),
      signal: abortController?.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    // Read stream with resource limits
    const reader = response.body.getReader();
    const audioChunks: Uint8Array[] = [];
    let chunkCount = 0;
    let totalBytes = 0;
    const MAX_CHUNKS = 100; // Prevent memory bloat

    try {
      while (true) {
        // Check for cancellation
        if (abortController?.signal.aborted) {
          throw new Error('Cancelled');
        }

        const { done, value } = await reader.read();
        if (done) break;

        chunkCount++;
        totalBytes += value.length;
        audioChunks.push(value);

        onProgress?.({ chunkCount, totalBytes });

        // Limit accumulation
        if (chunkCount >= MAX_CHUNKS) {
          console.warn('[TTS] Reached chunk limit, processing...');
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Combine and play
    if (audioChunks.length === 0) {
      throw new Error('No audio received');
    }

    const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combinedAudio = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of audioChunks) {
      combinedAudio.set(chunk, offset);
      offset += chunk.length;
    }

    // Play with audio resilience
    const playResult = await this.audioManager.playAudioSafely(
      combinedAudio.buffer,
      (progress) => {
        // Sync visemes with audio progress
        if (onViseme && visemes.length > 0) {
          const visemeIndex = Math.floor(
            (progress.currentTime / progress.duration) * visemes.length
          );
          if (visemeIndex >= 0 && visemeIndex < visemes.length) {
            onViseme(visemes[visemeIndex]);
          }
        }
      }
    );

    if (!playResult.success) {
      throw new Error(playResult.error || 'Audio playback failed');
    }

    return true;
  }

  /**
   * Buffered (non-streaming) TTS
   */
  private async speakBuffered(
    text: string,
    onViseme?: (viseme: VisemeData) => void,
    abortController?: AbortController
  ): Promise<boolean> {
    const response = await axios.post<TTSResponse>(
      `${this.baseUrl}/generate`,
      { text, stream: false },
      { signal: abortController?.signal }
    );

    if (!response.data.success || !response.data.audio) {
      throw new Error('TTS generation failed');
    }

    const { audio, visemes } = response.data;

    // Decode base64
    const binaryString = window.atob(audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Play
    const playResult = await this.audioManager.playAudioSafely(bytes.buffer);
    
    if (!playResult.success) {
      throw new Error(playResult.error || 'Playback failed');
    }

    // Schedule visemes
    if (onViseme && visemes.length > 0) {
      visemes.forEach(v => {
        setTimeout(() => onViseme(v), v.time * 1000);
      });
    }

    return true;
  }

  /**
   * Generate visemes for the given text
   */
  async generateVisemes(text: string): Promise<VisemeData[]> {
    try {
      const response = await axios.post(`${this.baseUrl}/generate-visemes`, { text });
      if (response.data.success) {
        return response.data.visemes;
      }
      return [];
    } catch (error) {
      console.error('[TTS] Viseme generation error:', error);
      return [];
    }
  }

  /**
   * Stop current speech and cleanup
   */
  stop(): void {
    console.log('[TTS] Stopping speech');
    this.resourceGuard.cleanup();
  }

  /**
   * Full cleanup
   */
  shutdown(): void {
    console.log('[TTS] Shutting down');
    this.stop();
    this.audioManager.cleanup();
    this.isInitialized = false;
  }

  /**
   * Quick validation without speaking
   */
  validateText(text: string): { valid: boolean; error?: string } {
    const result = TTSContentValidator.validate(text);
    return {
      valid: result.valid,
      error: result.error
    };
  }
}

// Export singleton instance
export const ttsService = new DefensiveTTSService();
export default ttsService;

// Convenience function for simple usage
export async function speak(
  text: string,
  onViseme?: (viseme: VisemeData) => void
): Promise<boolean> {
  return ttsService.speak({ text, onViseme });
}
