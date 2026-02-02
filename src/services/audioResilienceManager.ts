/**
 * Audio Resilience Manager - Production Hardened
 *
 * Handles autoplay policy, format validation, and audio system failures.
 * Implements proper AudioContext suspension/resume on first user interaction.
 * 
 * Features:
 * - Automatic AudioContext resume on first user click/touch/keydown
 * - Audio format validation (WAV, MP3, OGG support)
 * - Device change monitoring
 * - Graceful degradation for unsupported browsers
 * - Memory-safe audio playback with proper cleanup
 */

export interface AudioInitResult {
  success: boolean;
  audioContext?: AudioContext;
  error?: string;
  requiresUserInteraction?: boolean;
}

export interface AudioPlaybackResult {
  success: boolean;
  duration?: number;
  error?: string;
  requiresInteraction?: boolean;
}

export interface AudioContextState {
  state: 'suspended' | 'running' | 'closed';
  isResumed: boolean;
  userInteractionReceived: boolean;
}

type UserInteractionHandler = () => void;

export class AudioResilienceManager {
  private audioContext: AudioContext | null = null;
  private deviceChangeListener: ((event: Event) => void) | null = null;
  private userInteractionReceived = false;
  private pendingResume: Promise<void> | null = null;
  private onUserInteractionCallbacks: UserInteractionHandler[] = [];
  private boundInteractionHandler: (() => void) | null = null;
  private activeSourceNodes: Set<AudioBufferSourceNode> = new Set();
  private objectURLs: Set<string> = new Set();

  /**
   * Initialize the audio system
   */
  async initialize(): Promise<AudioInitResult> {
    try {
      // Check browser support
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) {
        return {
          success: false,
          error: 'Web Audio API not supported in this browser'
        };
      }

      // Create context if not exists
      if (!this.audioContext) {
        this.audioContext = new AudioContextClass();
      }

      // Handle autoplay policy
      if (this.audioContext.state === 'suspended') {
        console.log('[Audio] Context suspended, setting up user interaction listener');
        this.setupUserInteractionListener();

        // Try to resume immediately (may fail due to autoplay policy)
        try {
          await this.audioContext.resume();
          this.userInteractionReceived = true;
          console.log('[Audio] Context resumed immediately');
        } catch {
          // Expected to fail if no user interaction yet
          return {
            success: true,
            audioContext: this.audioContext,
            requiresUserInteraction: true,
            error: 'Audio requires user interaction (click/tap) to start'
          };
        }
      }

      // Monitor audio device changes
      this.setupDeviceChangeMonitoring();

      return {
        success: true,
        audioContext: this.audioContext,
        requiresUserInteraction: false
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `Audio initialization failed: ${errorMessage}`
      };
    }
  }

  /**
   * Set up listener to resume audio on first user interaction
   */
  private setupUserInteractionListener(): void {
    if (this.boundInteractionHandler) {
      return; // Already set up
    }

    this.boundInteractionHandler = async () => {
      if (!this.userInteractionReceived) {
        this.userInteractionReceived = true;

        const resumed = await this.ensureContextRunning();
        if (resumed) {
          console.log('[Audio] ✅ Audio enabled via user interaction');

          // Notify all registered callbacks
          this.onUserInteractionCallbacks.forEach(cb => {
            try {
              cb();
            } catch (e) {
              console.warn('[Audio] Callback error:', e);
            }
          });
        }

        // Remove listeners after successful resume
        this.removeInteractionListeners();
      }
    };

    // Listen on multiple event types for maximum compatibility
    const events = ['click', 'touchstart', 'touchend', 'keydown', 'mousedown'];
    events.forEach(event => {
      document.addEventListener(event, this.boundInteractionHandler!, {
        once: false,
        passive: true,
        capture: true
      });
    });

    console.log('[Audio] User interaction listeners registered');
  }

  /**
   * Remove interaction listeners
   */
  private removeInteractionListeners(): void {
    if (this.boundInteractionHandler) {
      const events = ['click', 'touchstart', 'touchend', 'keydown', 'mousedown'];
      events.forEach(event => {
        document.removeEventListener(event, this.boundInteractionHandler!, { capture: true });
      });
      this.boundInteractionHandler = null;
      console.log('[Audio] User interaction listeners removed');
    }
  }

  /**
   * Register a callback to be called when user interaction is received
   */
  onUserInteraction(callback: UserInteractionHandler): () => void {
    this.onUserInteractionCallbacks.push(callback);

    // If interaction already received, call immediately
    if (this.userInteractionReceived) {
      try {
        callback();
      } catch (e) {
        console.warn('[Audio] Callback error:', e);
      }
    }

    // Return unsubscribe function
    return () => {
      const index = this.onUserInteractionCallbacks.indexOf(callback);
      if (index > -1) {
        this.onUserInteractionCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Ensure AudioContext is running
   */
  async ensureContextRunning(): Promise<boolean> {
    if (!this.audioContext) return false;

    if (this.audioContext.state === 'suspended') {
      // Prevent multiple concurrent resume attempts
      if (this.pendingResume) {
        await this.pendingResume;
        // Re-check state after pending resume completes
        return this.audioContext?.state === 'running';
      }

      try {
        this.pendingResume = this.audioContext.resume();
        await this.pendingResume;
        console.log('[Audio] Context resumed, state:', this.audioContext.state);
        return true;
      } catch (error) {
        console.error('[Audio] Failed to resume context:', error);
        return false;
      } finally {
        this.pendingResume = null;
      }
    }

    return this.audioContext.state === 'running';
  }

  /**
   * Get current audio context state
   */
  getState(): AudioContextState | null {
    if (!this.audioContext) return null;

    return {
      state: this.audioContext.state as AudioContextState['state'],
      isResumed: this.audioContext.state === 'running',
      userInteractionReceived: this.userInteractionReceived
    };
  }

  /**
   * Create an object URL and track it for cleanup
   */
  createTrackedObjectURL(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.objectURLs.add(url);
    return url;
  }

  /**
   * Revoke a specific object URL
   */
  revokeObjectURL(url: string): void {
    if (this.objectURLs.has(url)) {
      URL.revokeObjectURL(url);
      this.objectURLs.delete(url);
    }
  }

  /**
   * Revoke all tracked object URLs
   */
  revokeAllObjectURLs(): void {
    this.objectURLs.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore errors during cleanup
      }
    });
    this.objectURLs.clear();
    console.log('[Audio] All object URLs revoked');
  }

  /**
   * Play audio safely with validation and error handling
   */
  async playAudioSafely(
    audioBuffer: ArrayBuffer,
    onProgress?: (progress: { currentTime: number; duration: number }) => void
  ): Promise<AudioPlaybackResult> {
    if (!this.audioContext) {
      return { success: false, error: 'AudioContext not initialized' };
    }

    // Ensure context is running (handle autoplay policy)
    const isRunning = await this.ensureContextRunning();
    if (!isRunning) {
      return {
        success: false,
        error: 'Audio context suspended. Please click/tap to enable audio.',
        requiresInteraction: true
      };
    }

    // Validate audio format before decoding
    const validation = this.validateAudioFormat(audioBuffer);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid audio format: ${validation.error}`
      };
    }

    // Check size limits
    const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50MB limit
    if (audioBuffer.byteLength > MAX_AUDIO_SIZE) {
      return {
        success: false,
        error: `Audio file too large (${(audioBuffer.byteLength / 1024 / 1024).toFixed(1)}MB > 50MB limit)`
      };
    }

    try {
      // Clone the buffer to avoid issues with transferred buffers
      const bufferCopy = audioBuffer.slice(0);

      // Decode with timeout
      const decodedBuffer = await Promise.race([
        this.audioContext.decodeAudioData(bufferCopy),
        this.createTimeout(10000, 'Audio decoding timeout')
      ]);

      if (!decodedBuffer || decodedBuffer.duration === 0) {
        return {
          success: false,
          error: 'Decoded audio has zero duration'
        };
      }

      // Create and start source
      const source = this.audioContext.createBufferSource();
      source.buffer = decodedBuffer;
      source.connect(this.audioContext.destination);

      // Track the source for cleanup
      this.activeSourceNodes.add(source);

      // Monitor playback progress
      const startTime = this.audioContext.currentTime;
      const duration = decodedBuffer.duration;

      let progressInterval: ReturnType<typeof setInterval> | null = null;

      if (onProgress) {
        progressInterval = setInterval(() => {
          if (this.audioContext) {
            const currentTime = this.audioContext.currentTime - startTime;
            onProgress({ currentTime: Math.min(currentTime, duration), duration });
          }
        }, 100);
      }

      // Play
      source.start(0);

      // Wait for completion
      await new Promise<void>((resolve) => {
        source.onended = () => {
          if (progressInterval) {
            clearInterval(progressInterval);
          }
          this.activeSourceNodes.delete(source);
          resolve();
        };
      });

      return {
        success: true,
        duration
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown playback error';
      return {
        success: false,
        error: `Playback failed: ${errorMessage}`
      };
    }
  }

  /**
   * Stop all currently playing audio
   */
  stopAllAudio(): void {
    this.activeSourceNodes.forEach(source => {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Ignore errors (source may already be stopped)
      }
    });
    this.activeSourceNodes.clear();
    console.log('[Audio] All audio stopped');
  }

  /**
   * Validate audio format
   */
  private validateAudioFormat(buffer: ArrayBuffer): { valid: boolean; error?: string; format?: string } {
    // Check minimum size
    if (buffer.byteLength < 12) {
      return { valid: false, error: 'Audio file too small (invalid)' };
    }

    const header = new Uint8Array(buffer.slice(0, 12));

    // Check WAV header (RIFF....WAVE)
    const riff = String.fromCharCode(...Array.from(header.slice(0, 4)));
    const wave = String.fromCharCode(...Array.from(header.slice(8, 12)));
    if (riff === 'RIFF' && wave === 'WAVE') {
      return { valid: true, format: 'wav' };
    }

    // Check MP3 header (ID3 or sync word 0xFFE or 0xFFF)
    if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
      return { valid: true, format: 'mp3' }; // ID3 tag
    }
    if ((header[0] === 0xFF) && ((header[1] & 0xE0) === 0xE0)) {
      return { valid: true, format: 'mp3' }; // MPEG sync
    }

    // Check OGG header
    const ogg = String.fromCharCode(...Array.from(header.slice(0, 4)));
    if (ogg === 'OggS') {
      return { valid: true, format: 'ogg' };
    }

    // Check FLAC header
    const flac = String.fromCharCode(...Array.from(header.slice(0, 4)));
    if (flac === 'fLaC') {
      return { valid: true, format: 'flac' };
    }

    // Unknown format - let Web Audio API try to decode it
    return { valid: true, format: 'unknown' };
  }

  /**
   * Set up device change monitoring
   */
  private setupDeviceChangeMonitoring(): void {
    if (navigator.mediaDevices) {
      this.deviceChangeListener = () => {
        console.log('[Audio] Audio devices changed, may need to reinitialize');
        // Could trigger re-initialization or notify user
      };

      navigator.mediaDevices.addEventListener(
        'devicechange',
        this.deviceChangeListener
      );
    }
  }

  /**
   * Create a timeout promise
   */
  private createTimeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    );
  }

  /**
   * Check if audio is ready to play
   */
  isReady(): boolean {
    return !!(this.audioContext && this.audioContext.state === 'running');
  }

  /**
   * Check if user interaction is needed
   */
  needsUserInteraction(): boolean {
    return !this.userInteractionReceived &&
      !!this.audioContext &&
      this.audioContext.state === 'suspended';
  }

  /**
   * Full cleanup
   */
  cleanup(): void {
    // Stop all playing audio
    this.stopAllAudio();

    // Revoke all object URLs
    this.revokeAllObjectURLs();

    // Remove device change listener
    if (this.deviceChangeListener && navigator.mediaDevices) {
      navigator.mediaDevices.removeEventListener(
        'devicechange',
        this.deviceChangeListener
      );
      this.deviceChangeListener = null;
    }

    // Remove user interaction listeners
    this.removeInteractionListeners();

    // Clear callbacks
    this.onUserInteractionCallbacks = [];

    // Close audio context
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {
        // Ignore close errors
      }
      this.audioContext = null;
    }

    this.userInteractionReceived = false;
    this.pendingResume = null;

    console.log('[Audio] AudioResilienceManager cleanup complete');
  }
}

// Singleton instance for global use
let _audioResilienceManager: AudioResilienceManager | null = null;

export function getAudioResilienceManager(): AudioResilienceManager {
  if (!_audioResilienceManager) {
    _audioResilienceManager = new AudioResilienceManager();
  }
  return _audioResilienceManager;
}
