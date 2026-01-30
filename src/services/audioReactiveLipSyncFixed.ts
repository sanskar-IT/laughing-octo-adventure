/**
 * Audio-Reactive Lip Sync Service for Live2D Models - Fixed Version
 * Provides real-time mouth movement based on audio analysis
 */
export class AudioReactiveLipSyncFixed {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private animationFrameId: number | null = null;
  private live2dModel: any = null;
  
  // Audio analysis settings
  private sensitivity: number = 0.015;
  private smoothingFactor: number = 0.3;
  private minThreshold: number = 5;
  private maxThreshold: number = 100;
  private eyeBlinkThreshold: number = 25;
  
  // Frequency analysis settings
  private frequencyData: Uint8Array;
  private previousMouthOpen: number = 0;
  private eyeBlinkTimer: number | null = null;
  private lastBlinkTime: number = 0;

  constructor() {
    // Initialize with default values
    this.frequencyData = new Uint8Array(128);
  }

  /**
   * Initialize audio context and analyser
   * @param {HTMLAudioElement} audioElement - Audio element to analyze
   * @param {Object} live2dModel - Live2D model instance
   * @returns {Promise<boolean>} Success status
   */
  async initialize(audioElement: HTMLAudioElement, live2dModel: any): Promise<boolean> {
    try {
      this.live2dModel = live2dModel;
      
      // Create audio context
      const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) {
        throw new Error('Web Audio API not supported in this browser');
      }
      
      this.audioContext = new AudioContext();
      
      if (!this.audioContext) {
        throw new Error('Failed to create audio context');
      }
      
      // Create audio nodes
      this.source = this.audioContext.createMediaElementSource(audioElement);
      this.analyser = this.audioContext.createAnalyser();
      
      if (!this.analyser) {
        throw new Error('Failed to create analyser');
      }
      
      // Configure analyser for real-time audio analysis
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -10;
      
      // Connect audio nodes
      this.source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      
      // Initialize frequency data array
      const bufferLength = this.analyser.frequencyBinCount;
      this.frequencyData = new Uint8Array(bufferLength);
      
      console.log('[AudioReactiveLipSync] Initialized with sensitivity:', this.sensitivity);
      return true;
      
    } catch (error) {
      console.error('[AudioReactiveLipSync] Initialization error:', error);
      return false;
    }
  }

  /**
   * Start real-time lip sync animation
   */
  startRealTimeSync(): void {
    if (!this.analyser || !this.live2dModel) {
      console.warn('[AudioReactiveLipSync] Cannot start: analyzer or model not initialized');
      return;
    }

    console.log('[AudioReactiveLipSync] Starting real-time sync');
    const updateMouthMovement = () => {
      if (!this.analyser) return;
      
      // Copy frequency data to avoid reference issues
      const dataArray = new Uint8Array(this.frequencyData.length);
      this.analyser.getByteFrequencyData(dataArray);
      
      // Calculate RMS (Root Mean Square) for volume analysis
      let sum = 0;
      const bufferLength = dataArray.length;
      
      for (let i = 0; i < bufferLength; i++) {
        const value = dataArray[i];
        sum += value * value;
      }
      
      const rms = Math.sqrt(sum / bufferLength);
      
      // Normalize and apply sensitivity
      let mouthOpen = Math.min(rms * this.sensitivity, 1.0);
      
      // Apply smoothing to prevent jittery movement
      mouthOpen = this.previousMouthOpen * this.smoothingFactor + 
                   mouthOpen * (1 - this.smoothingFactor);
      this.previousMouthOpen = mouthOpen;
      
      // Update Live2D model parameters
      this.updateModelParameters(mouthOpen, rms);
      
      // Continue animation loop
      this.animationFrameId = requestAnimationFrame(updateMouthMovement);
    };

    updateMouthMovement();
  }

  /**
   * Update Live2D model parameters based on audio analysis
   * @param {number} mouthOpen - Normalized mouth opening (0-1)
   * @param {number} rms - Raw RMS value
   */
  private updateModelParameters(mouthOpen: number, rms: number): void {
    if (!this.live2dModel || !this.live2dModel.internalModel) {
      return;
    }

    try {
      // Standard Cubism parameter for mouth movement
      this.live2dModel.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', mouthOpen);
      
      // Additional mouth parameters for more realistic movement
      this.live2dModel.internalModel.coreModel.setParameterValueById('ParamMouthForm', mouthOpen * 0.5);
      
      // Eye blinking based on audio volume (subtle effect)
      const shouldBlink = rms > this.eyeBlinkThreshold && 
                           Date.now() - this.lastBlinkTime > 3000; // Min 3 seconds between blinks
      
      if (shouldBlink) {
        this.live2dModel.internalModel.coreModel.setParameterValueById('ParamEyeLOpen', 0.8);
        this.live2dModel.internalModel.coreModel.setParameterValueById('ParamEyeROpen', 0.8);
        
        // Reset blink after short duration
        if (this.eyeBlinkTimer) {
          clearTimeout(this.eyeBlinkTimer);
        }
        
        this.eyeBlinkTimer = window.setTimeout(() => {
          this.live2dModel.internalModel.coreModel.setParameterValueById('ParamEyeLOpen', 1.0);
          this.live2dModel.internalModel.coreModel.setParameterValueById('ParamEyeROpen', 1.0);
        }, 150);
        
        this.lastBlinkTime = Date.now();
      }
      
      // Optional: Breathing effect during speech
      if (rms > this.minThreshold) {
        this.live2dModel.internalModel.coreModel.setParameterValueById('ParamBreath', rms / this.maxThreshold);
      }
      
    } catch (error) {
      // Model may not support these parameters
      console.warn('[AudioReactiveLipSync] Parameter update failed:', (error as Error).message);
    }
  }

  /**
   * Stop real-time lip sync animation
   */
  stopRealTimeSync(): void {
    console.log('[AudioReactiveLipSync] Stopping real-time sync');
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Clear timers
    if (this.eyeBlinkTimer) {
      clearTimeout(this.eyeBlinkTimer);
      this.eyeBlinkTimer = null;
    }
    
    // Reset model to neutral state
    this.resetModelParameters();
  }

  /**
   * Reset Live2D model parameters to neutral state
   */
  private resetModelParameters(): void {
    if (!this.live2dModel || !this.live2dModel.internalModel) {
      return;
    }

    try {
      // Reset mouth to closed position
      this.live2dModel.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 0);
      this.live2dModel.internalModel.coreModel.setParameterValueById('ParamMouthForm', 0);
      
      // Reset eyes to open
      this.live2dModel.internalModel.coreModel.setParameterValueById('ParamEyeLOpen', 1.0);
      this.live2dModel.internalModel.coreModel.setParameterValueById('ParamEyeROpen', 1.0);
      
      // Reset breathing
      this.live2dModel.internalModel.coreModel.setParameterValueById('ParamBreath', 0);
      
      // Reset previous values
      this.previousMouthOpen = 0;
      this.lastBlinkTime = 0;
      
    } catch (error) {
      console.warn('[AudioReactiveLipSync] Parameter reset failed:', (error as Error).message);
    }
  }

  /**
   * Adjust sensitivity for mouth movement
   * @param {number} newSensitivity - New sensitivity value
   */
  adjustSensitivity(newSensitivity: number): void {
    this.sensitivity = Math.max(0.001, Math.min(0.1, newSensitivity));
    console.log(`[AudioReactiveLipSync] Sensitivity adjusted to: ${this.sensitivity}`);
  }

  /**
   * Adjust smoothing factor for mouth movement
   * @param {number} newSmoothing - New smoothing factor (0-1)
   */
  adjustSmoothing(newSmoothing: number): void {
    this.smoothingFactor = Math.max(0.1, Math.min(0.9, newSmoothing));
    console.log(`[AudioReactiveLipSync] Smoothing adjusted to: ${this.smoothingFactor}`);
  }

  /**
   * Adjust audio analysis thresholds
   * @param {Object} thresholds - Threshold configuration
   */
  adjustThresholds(thresholds: { min?: number; max?: number; eyeBlink?: number }): void {
    if (thresholds.min !== undefined) {
      this.minThreshold = Math.max(0, thresholds.min);
    }
    if (thresholds.max !== undefined) {
      this.maxThreshold = Math.max(1, thresholds.max);
    }
    if (thresholds.eyeBlink !== undefined) {
      this.eyeBlinkThreshold = Math.max(0, thresholds.eyeBlink);
    }
    
    console.log('[AudioReactiveLipSync] Thresholds updated:', {
      min: this.minThreshold,
      max: this.maxThreshold,
      eyeBlink: this.eyeBlinkThreshold
    });
  }

  /**
   * Get current analysis metrics
   * @returns {Object} Current audio analysis state
   */
  getCurrentMetrics(): {
    sensitivity: number;
    smoothingFactor: number;
    thresholds: { min: number; max: number; eyeBlink: number };
    isRunning: boolean;
    hasAudioContext: boolean;
    hasAnalyser: boolean;
    lastBlinkTime: number;
  } {
    return {
      sensitivity: this.sensitivity,
      smoothingFactor: this.smoothingFactor,
      thresholds: {
        min: this.minThreshold,
        max: this.maxThreshold,
        eyeBlink: this.eyeBlinkThreshold
      },
      isRunning: this.animationFrameId !== null,
      hasAudioContext: this.audioContext !== null,
      hasAnalyser: this.analyser !== null,
      lastBlinkTime: this.lastBlinkTime
    };
  }

  /**
   * Test audio setup with a sound
   * @returns {Promise<boolean>} Test result
   */
  async testAudioSetup(): Promise<boolean> {
    if (!this.audioContext || !this.analyser) {
      return false;
    }

    try {
      if (!this.audioContext) {
        return false;
      }

      // Create test oscillator
      const oscillator = this.audioContext.createOscillator();
      if (!oscillator) {
        return false;
      }

      const gainNode = this.audioContext.createGain();
      if (!gainNode) {
        oscillator.disconnect();
        return false;
      }
      
      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      oscillator.frequency.value = 440; // A4 note
      gainNode.gain.value = 0.1;
      oscillator.start();
      
      // Test for 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      oscillator.stop();
      
      console.log('[AudioReactiveLipSync] Audio test completed successfully');
      return true;
      
    } catch (error) {
      console.error('[AudioReactiveLipSync] Audio test failed:', (error as Error).message);
      return false;
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stopRealTimeSync();
    
    // Clear timers
    if (this.eyeBlinkTimer) {
      clearTimeout(this.eyeBlinkTimer);
      this.eyeBlinkTimer = null;
    }
    
    // Disconnect audio nodes
    if (this.source) {
      try {
        this.source.disconnect();
      } catch (error) {
        console.warn('[AudioReactiveLipSync] Source disconnect error:', (error as Error).message);
      }
      this.source = null;
    }
    
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch (error) {
        console.warn('[AudioReactiveLipSync] Analyser disconnect error:', (error as Error).message);
      }
      this.analyser = null;
    }
    
    // Close audio context
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (error) {
        console.warn('[AudioReactiveLipSync] Audio context close error:', (error as Error).message);
      }
      this.audioContext = null;
    }
    
    console.log('[AudioReactiveLipSync] Cleanup completed');
  }
}

export default AudioReactiveLipSyncFixed;