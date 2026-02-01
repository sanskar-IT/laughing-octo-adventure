import axios from 'axios';

interface VisemeFrame {
  time: number;
  value: number;
  duration: number;
}

interface VisemeData {
  value: number;
  intensity: number;
}

class EnhancedTTSService {
  private isInitialized: boolean = false;
  private audioContext: AudioContext | null = null;
  private baseUrl: string = 'http://localhost:3000/api/tts';
  private activeSource: AudioBufferSourceNode | null = null;
  private animationFrameId: number | null = null;
  private startTime: number = 0;
  private isPlaying: boolean = false;

  async initialize(): Promise<boolean> {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('Failed to initialize AudioContext:', error);
      return false;
    }
  }

  async speak(text: string, onViseme?: (viseme: VisemeData) => void): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const response = await axios.post(`${this.baseUrl}/generate`, { text }, {
        timeout: 30000
      });

      if (response.data.success) {
        const { audio: audioBase64, visemes } = response.data;

        // Convert base64 to AudioBuffer
        const audioBuffer = await this.createAudioBuffer(audioBase64);

        // Process visemes for smooth synchronization
        const processedVisemes = this.processVisemes(visemes, audioBuffer.duration);

        // Play synchronized audio and visemes
        await this.playSynchronized(audioBuffer, processedVisemes, onViseme);
        return true;
      }

      return false;
    } catch (error) {
      console.error('TTS speak error:', error);
      return false;
    }
  }

  private async createAudioBuffer(base64Data: string): Promise<AudioBuffer> {
    const binaryString = window.atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    if (!this.audioContext) throw new Error('AudioContext not initialized');
    return await this.audioContext.decodeAudioData(bytes.buffer);
  }

  private processVisemes(visemes: any[], _audioDuration?: number): VisemeFrame[] {
    const processed: VisemeFrame[] = [];

    for (let i = 0; i < visemes.length; i++) {
      const viseme = visemes[i];
      processed.push({
        time: viseme.time || (i * 0.05),
        value: viseme.value || 0,
        duration: viseme.duration || 0.1
      });
    }

    return processed;
  }

  private async playSynchronized(
    audioBuffer: AudioBuffer,
    visemeFrames: VisemeFrame[],
    onViseme?: (viseme: VisemeData) => void
  ): Promise<void> {
    if (!this.audioContext) throw new Error('AudioContext not initialized');

    // Create audio source
    this.activeSource = this.audioContext.createBufferSource();
    this.activeSource.buffer = audioBuffer;
    this.activeSource.connect(this.audioContext.destination);

    // Start playback
    this.startTime = this.audioContext.currentTime;
    this.isPlaying = true;
    this.activeSource.start(0);

    let currentVisemeIndex = 0;

    return new Promise<void>((resolve) => {
      const updateViseme = () => {
        if (!this.isPlaying) return;

        const currentTime = (this.audioContext?.currentTime ?? 0) - this.startTime;

        // Find current viseme frame
        while (currentVisemeIndex < visemeFrames.length &&
          currentTime >= visemeFrames[currentVisemeIndex].time) {

          const visemeFrame = visemeFrames[currentVisemeIndex];

          if (onViseme) {
            // Convert viseme value (0-16) to intensity (0-1)
            const intensity = Math.min(1.0, visemeFrame.value / 10);

            onViseme({
              value: visemeFrame.value,
              intensity
            });
          }

          currentVisemeIndex++;
        }

        // Continue animation loop
        if (currentTime < audioBuffer.duration) {
          this.animationFrameId = requestAnimationFrame(updateViseme);
        } else {
          // Audio finished
          this.cleanup();
          resolve();
        }
      };

      // Start animation loop
      this.animationFrameId = requestAnimationFrame(updateViseme);
    });
  }

  private cleanup(): void {
    this.isPlaying = false;

    if (this.activeSource) {
      try {
        this.activeSource.stop();
        this.activeSource.disconnect();
        this.activeSource = null;
      } catch (error) {
        console.warn('Error cleaning up audio source:', error);
      }
    }

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  // Public method to stop playback
  stop(): void {
    this.cleanup();
  }

  shutdown(): void {
    this.cleanup();

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.isInitialized = false;
  }

  isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }
}

export default EnhancedTTSService;