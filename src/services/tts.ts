import axios from 'axios';

class TTSService {
  private isInitialized: boolean = false;
  private audioContext: AudioContext | null = null;
  private baseUrl: string = 'http://localhost:8000';

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

  async speak(text: string, onViseme?: (viseme: any) => void): Promise<boolean> {
    if (!this.isInitialized) await this.initialize();

    try {
      const response = await axios.post(`${this.baseUrl}/generate`, { text });

      if (response.data.success) {
        const { audio: audioBase64, visemes } = response.data;

        // Play Audio
        await this.playAudio(audioBase64, visemes, onViseme);
        return true;
      }
      return false;
    } catch (error) {
      console.error('TTS speak error:', error);
      return false;
    }
  }

  private async playAudio(base64Data: string, visemes: any[], onViseme?: (v: any) => void) {
    if (!this.audioContext) return;

    // Convert base64 to array buffer
    const binaryString = window.atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer);
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    // Start playback
    const startTime = this.audioContext.currentTime;
    source.start(startTime);

    // Schedule visemes
    if (onViseme && visemes.length > 0) {
      visemes.forEach(v => {
        const time = v.time; // time in seconds usually
        const delay = time * 1000;

        setTimeout(() => {
          onViseme(v);
        }, delay);
      });
    }

    return new Promise<void>((resolve) => {
      source.onended = () => resolve();
    });
  }

  shutdown(): void {
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.isInitialized = false;
  }
}

export const ttsService = new TTSService();
export default ttsService;
