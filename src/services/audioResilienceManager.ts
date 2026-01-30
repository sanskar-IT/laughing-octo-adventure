/**
 * Audio Resilience Manager
 * Handles autoplay policy, format validation, and audio system failures
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

export class AudioResilienceManager {
  private audioContext: AudioContext | null = null;
  private deviceChangeListener: ((event: Event) => void) | null = null;
  private userInteractionReceived = false;

  async initialize(): Promise<AudioInitResult> {
    try {
      // Check browser support
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        return {
          success: false,
          error: 'Web Audio API not supported in this browser'
        };
      }

      // Create context
      this.audioContext = new AudioContextClass();

      // Handle autoplay policy
      if (this.audioContext.state === 'suspended') {
        console.log('[Audio] Context suspended, waiting for user interaction');
        this.setupUserInteractionListener();
        
        // Try to resume immediately (may fail due to autoplay policy)
        try {
          await this.audioContext.resume();
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

    } catch (error: any) {
      return {
        success: false,
        error: `Audio initialization failed: ${error.message}`
      };
    }
  }

  private setupUserInteractionListener(): void {
    const handler = async () => {
      if (!this.userInteractionReceived) {
        this.userInteractionReceived = true;
        await this.ensureContextRunning();
        console.log('[Audio] Audio enabled via user interaction');

        // Remove listeners
        document.removeEventListener('click', handler);
        document.removeEventListener('touchstart', handler);
        document.removeEventListener('keydown', handler);
      }
    };

    document.addEventListener('click', handler);
    document.addEventListener('touchstart', handler);
    document.addEventListener('keydown', handler);
  }

  async ensureContextRunning(): Promise<boolean> {
    if (!this.audioContext) return false;

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
        return true;
      } catch (error) {
        console.error('[Audio] Failed to resume context:', error);
        return false;
      }
    }

    return this.audioContext.state === 'running';
  }

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
      // Decode with timeout
      const decodedBuffer = await Promise.race([
        this.audioContext.decodeAudioData(audioBuffer),
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

      // Monitor playback progress
      const startTime = this.audioContext.currentTime;
      const duration = decodedBuffer.duration;

      const progressInterval = setInterval(() => {
        if (this.audioContext) {
          const currentTime = this.audioContext.currentTime - startTime;
          onProgress?.({ currentTime, duration });
        }
      }, 100);

      // Play
      source.start(0);

      // Wait for completion
      await new Promise<void>((resolve) => {
        source.onended = () => {
          clearInterval(progressInterval);
          resolve();
        };
      });

      return {
        success: true,
        duration
      };

    } catch (error: any) {
      return {
        success: false,
        error: `Playback failed: ${error.message}`
      };
    }
  }

  private validateAudioFormat(buffer: ArrayBuffer): { valid: boolean; error?: string } {
    // Check minimum size (WAV header is at least 44 bytes)
    if (buffer.byteLength < 44) {
      return { valid: false, error: 'Audio file too small (invalid)' };
    }

    // Check WAV header
    const header = new Uint8Array(buffer.slice(0, 12));
    const riff = String.fromCharCode(...Array.from(header.slice(0, 4)));
    const wave = String.fromCharCode(...Array.from(header.slice(8, 12)));

    if (riff !== 'RIFF' || wave !== 'WAVE') {
      return { valid: false, error: 'Not a valid WAV file' };
    }

    return { valid: true };
  }

  private setupDeviceChangeMonitoring(): void {
    if (navigator.mediaDevices) {
      this.deviceChangeListener = () => {
        console.log('[Audio] Audio devices changed');
        // Could trigger re-initialization or notify user
      };

      navigator.mediaDevices.addEventListener(
        'devicechange',
        this.deviceChangeListener
      );
    }
  }

  private createTimeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    );
  }

  cleanup(): void {
    if (this.deviceChangeListener && navigator.mediaDevices) {
      navigator.mediaDevices.removeEventListener(
        'devicechange',
        this.deviceChangeListener
      );
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
