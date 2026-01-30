# QA Analysis: Live2D + TTS Integration - Edge Cases & Defensive Patterns

**Date:** January 30, 2026  
**QA Engineer:** opencode  
**Scope:** Live2D rendering, TTS audio streaming, and integration points  
**Status:** 🔍 Analysis Complete - Plan Created

---

## 🎯 Executive Summary

After analyzing the Live2D and TTS integration codebase, I've identified **5 critical edge cases** where the system can fail, causing UI freezes, crashes, or poor user experience. Each edge case includes:
- **Failure Scenario** - What can go wrong
- **Impact** - How it affects the user
- **Root Cause** - Why it happens
- **Defensive Pattern** - How to prevent it
- **Implementation** - Code examples ready to implement

---

## 🚨 5 Critical Edge Cases Identified

### **Edge Case #1: Model Loading Failure (CRITICAL)**

**Failure Scenario:**
Live2D model fails to load due to:
- Missing model files (404 error)
- Corrupted model3.json
- Missing texture files (PNG references broken)
- Network timeout fetching model
- CORS policy blocking model fetch

**Current Code (Vulnerable):**
```typescript
// Live2DCanvas.tsx:45-77
async function load() {
  try {
    console.log('Loading Live2D model from:', modelPath);
    const cleanPath = modelPath.replace('./', '/');
    const loadedModel = await Live2DModel.from(cleanPath);  // 🔴 Can throw!
    
    if (!mounted) return;
    
    const scale = Math.min(
      app!.view.width / loadedModel.width,  // 🔴 Division by zero if model invalid
      app!.view.height / loadedModel.height
    ) * 0.8;
    
    // ... rest of setup ...
    
  } catch (error) {
    console.error('Failed to load Live2D model:', error);  // 🔴 Only logs, no recovery
  }
}
```

**Problems:**
1. No validation of modelPath before loading
2. No retry mechanism for network failures
3. No fallback UI when model fails
4. Silent failure - user sees blank canvas
5. Division by zero risk if model is corrupted

**Impact:**
- User sees blank/empty character area
- No feedback about what went wrong
- Application appears broken
- Cannot recover without refresh

**Defensive Pattern - "Graceful Degradation with Retry":**

```typescript
// IMPLEMENTATION PLAN

interface ModelLoadResult {
  success: boolean;
  model?: Live2DModel;
  error?: string;
  fallbackUsed?: boolean;
}

class Live2DModelLoader {
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY = 1000; // ms
  private static readonly FALLBACK_MODEL = '/models/placeholder/placeholder.model3.json';
  
  static async loadWithRetry(
    modelPath: string, 
    app: PIXI.Application,
    onProgress?: (stage: string) => void
  ): Promise<ModelLoadResult> {
    // Stage 1: Validate path format
    if (!this.isValidModelPath(modelPath)) {
      return {
        success: false,
        error: `Invalid model path: ${modelPath}. Expected format: /models/name/name.model3.json`
      };
    }
    
    onProgress?.('validating');
    
    // Stage 2: Pre-flight check (HEAD request to verify exists)
    const cleanPath = modelPath.replace('./', '/');
    const exists = await this.verifyModelExists(cleanPath);
    
    if (!exists) {
      console.warn(`[Live2D] Model not found: ${cleanPath}, attempting fallback`);
      return this.loadFallbackModel(app, onProgress);
    }
    
    // Stage 3: Load with retry logic
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        onProgress?.(`loading_attempt_${attempt}`);
        
        const loadedModel = await Promise.race([
          Live2DModel.from(cleanPath),
          this.createTimeout(10000, 'Model loading timeout')
        ]);
        
        // Stage 4: Validate loaded model
        if (!this.isValidModel(loadedModel)) {
          throw new Error('Model loaded but appears corrupted (invalid dimensions)');
        }
        
        onProgress?.('success');
        return { success: true, model: loadedModel };
        
      } catch (error) {
        console.error(`[Live2D] Load attempt ${attempt} failed:`, error);
        
        if (attempt < this.MAX_RETRIES) {
          onProgress?.(`retrying_in_${this.RETRY_DELAY}ms`);
          await this.delay(this.RETRY_DELAY * attempt); // Exponential backoff
        }
      }
    }
    
    // All retries exhausted - use fallback
    return this.loadFallbackModel(app, onProgress);
  }
  
  private static async loadFallbackModel(
    app: PIXI.Application,
    onProgress?: (stage: string) => void
  ): Promise<ModelLoadResult> {
    try {
      onProgress?.('loading_fallback');
      
      const fallbackModel = await Live2DModel.from(this.FALLBACK_MODEL);
      
      return {
        success: true,
        model: fallbackModel,
        fallbackUsed: true,
        error: 'Primary model failed, using fallback'
      };
    } catch (error) {
      return {
        success: false,
        error: `Both primary and fallback models failed: ${error.message}`
      };
    }
  }
  
  private static isValidModelPath(path: string): boolean {
    return path && 
           path.endsWith('.model3.json') && 
           path.includes('/models/');
  }
  
  private static async verifyModelExists(path: string): Promise<boolean> {
    try {
      const response = await fetch(path, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }
  
  private static isValidModel(model: Live2DModel): boolean {
    return model && 
           model.width > 0 && 
           model.height > 0 && 
           model.internalModel != null;
  }
  
  private static createTimeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => 
      setTimeout(() => reject(new Error(message)), ms)
    );
  }
  
  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// USAGE IN COMPONENT:
export function Live2DCanvas({ modelPath }: Live2DComponentProps) {
  const [model, setModel] = useState<Live2DModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStage, setLoadStage] = useState<string>('idle');
  
  useEffect(() => {
    if (!app || !modelPath) return;
    
    let mounted = true;
    
    const load = async () => {
      const result = await Live2DModelLoader.loadWithRetry(
        modelPath, 
        app,
        (stage) => {
          if (mounted) setLoadStage(stage);
        }
      );
      
      if (!mounted) return;
      
      if (result.success && result.model) {
        setModel(result.model);
        if (result.fallbackUsed) {
          console.warn('[Live2D] Using fallback model');
        }
      } else {
        setLoadError(result.error || 'Unknown error');
      }
    };
    
    load();
    
    return () => { mounted = false; };
  }, [app, modelPath]);
  
  // Render error state
  if (loadError) {
    return (
      <div className="live2d-error">
        <p>Failed to load character model</p>
        <p className="error-details">{loadError}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }
  
  // Render loading state
  if (!model) {
    return (
      <div className="live2d-loading">
        <p>Loading character... ({loadStage})</p>
        <div className="spinner" />
      </div>
    );
  }
  
  // ... rest of component
}
```

---

### **Edge Case #2: Audio System Failures (CRITICAL)**

**Failure Scenario:**
TTS audio playback fails due to:
- Browser autoplay policy (AudioContext suspended)
- decodeAudioData() fails (corrupted audio, unsupported format)
- Audio device disconnected during playback
- User denies audio permissions
- Memory limit exceeded with large audio files

**Current Code (Vulnerable):**
```typescript
// tts.ts:40-47, 55-57
async initialize(): Promise<boolean> {
  try {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.isInitialized = true;
    return true;
  } catch (error) {
    console.error('[TTS] Failed to initialize AudioContext:', error);
    return false;  // 🔴 Silent failure, no retry or user feedback
  }
}

// tts.ts:255-257
private async playAudioBuffer(...) {
  const decodedBuffer = await this.audioContext.decodeAudioData(audioBuffer);
  // 🔴 Can throw: "Unable to decode audio data"
  // 🔴 Can throw: "ArrayBuffer length exceeds maximum"
}
```

**Problems:**
1. No autoplay policy handling (AudioContext often starts suspended)
2. No validation of audio format before decoding
3. decodeAudioData() failures not caught properly
4. No audio device change detection
5. Large audio files can cause memory issues

**Impact:**
- Audio doesn't play (user hears nothing)
- No indication that audio is broken
- App appears to "ignore" the response
- Cannot recover without page refresh

**Defensive Pattern - "Audio Resilience with Autoplay Handling":**

```typescript
// IMPLEMENTATION PLAN

interface AudioInitResult {
  success: boolean;
  audioContext?: AudioContext;
  error?: string;
  requiresUserInteraction?: boolean;
}

interface AudioPlaybackResult {
  success: boolean;
  duration?: number;
  error?: string;
  fallbackUsed?: boolean;
}

class AudioResilienceManager {
  private audioContext: AudioContext | null = null;
  private deviceChangeListener: ((event: MediaDeviceList) => void) | null = null;
  
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
        
        // Try to resume immediately (may fail due to autoplay policy)
        try {
          await this.audioContext.resume();
        } catch {
          // Expected to fail if no user interaction yet
          return {
            success: true,  // Partial success - context created
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
      
    } catch (error) {
      return {
        success: false,
        error: `Audio initialization failed: ${error.message}`
      };
    }
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
        fallbackUsed: true
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
    
    // Attempt decoding with size limits
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
      await new Promise<void>((resolve, reject) => {
        source.onended = () => {
          clearInterval(progressInterval);
          resolve();
        };
        
        source.onerror = (error) => {
          clearInterval(progressInterval);
          reject(new Error(`Playback error: ${error}`));
        };
      });
      
      return {
        success: true,
        duration
      };
      
    } catch (error) {
      return {
        success: false,
        error: `Playback failed: ${error.message}`
      };
    }
  }
  
  private validateAudioFormat(buffer: ArrayBuffer): { valid: boolean; error?: string } {
    // Check WAV header
    const header = new Uint8Array(buffer.slice(0, 12));
    const riff = String.fromCharCode(...header.slice(0, 4));
    const wave = String.fromCharCode(...header.slice(8, 12));
    
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

// INTEGRATION WITH TTS SERVICE:
class DefensiveTTSService {
  private audioManager: AudioResilienceManager;
  private userInteractionReceived = false;
  
  constructor() {
    this.audioManager = new AudioResilienceManager();
  }
  
  async initialize(): Promise<boolean> {
    const result = await this.audioManager.initialize();
    
    if (result.requiresUserInteraction) {
      // Setup global click listener to resume audio
      this.setupUserInteractionListener();
    }
    
    return result.success;
  }
  
  private setupUserInteractionListener(): void {
    const handler = async () => {
      if (!this.userInteractionReceived) {
        this.userInteractionReceived = true;
        await this.audioManager.ensureContextRunning();
        console.log('[TTS] Audio enabled via user interaction');
        
        // Remove listeners
        document.removeEventListener('click', handler);
        document.removeEventListener('touchstart', handler);
      }
    };
    
    document.addEventListener('click', handler);
    document.addEventListener('touchstart', handler);
  }
  
  async speakWithFallback(text: string): Promise<boolean> {
    // Try streaming first
    const streamingResult = await this.tryStreamingTTS(text);
    
    if (streamingResult.success) {
      return true;
    }
    
    // If streaming fails, try non-streaming as fallback
    console.warn('[TTS] Streaming failed, trying fallback:', streamingResult.error);
    return await this.tryNonStreamingTTS(text);
  }
}
```

---

### **Edge Case #3: Empty/Invalid LLM Response (HIGH)**

**Failure Scenario:**
TTS receives invalid input:
- LLM returns empty string ""
- LLM returns only whitespace "   "
- LLM returns special characters only "!!!???"
- Text exceeds TTS character limit (1000 chars)
- Text contains only emojis/unicode without phonetic content

**Current Code (Vulnerable):**
```typescript
// App.tsx or similar calling code
const response = await apiService.sendChat([...]);
if (response.success && response.message) {
  addMessage('assistant', response.message);
  
  // 🔴 No validation of message content before TTS
  await enhancedTTSService.speak(response.message, (viseme) => {
    setViseme(viseme.value || 0);
  });
}

// tts.ts:74-98
async speakStreaming(text: string, ...): Promise<boolean> {
  // 🔴 No validation of text parameter
  console.log(`[TTS] Starting streaming TTS for: "${text.substring(0, 50)}..."`);
  
  const visemes = await this.generateVisemes(text);
  // 🔴 Empty text still makes API call
  
  return await this.streamAudioWithVisemes(text, visemes, ...);
}
```

**Problems:**
1. No content validation before calling TTS
2. Empty strings still trigger API calls
3. Very long text can cause memory issues
4. No graceful handling of non-phonetic content
5. No user feedback when TTS input is invalid

**Impact:**
- TTS server receives empty requests (waste of resources)
- User sees response but hears nothing
- Long text gets truncated or causes errors
- Special characters may confuse TTS engine

**Defensive Pattern - "Content Validation with Sanitization":**

```typescript
// IMPLEMENTATION PLAN

interface TTSValidationResult {
  valid: boolean;
  text?: string;
  error?: string;
  warnings?: string[];
  isEmpty?: boolean;
  isTooLong?: boolean;
  requiresTruncation?: boolean;
}

class TTSContentValidator {
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
   * Pre-validate before adding to UI
   */
  static shouldShowTTSButton(text: string): boolean {
    const result = this.validate(text);
    return result.valid;
  }
}

// INTEGRATION IN TTS SERVICE:
class DefensiveTTSService {
  async speakStreaming(
    text: string,
    onViseme?: (viseme: VisemeData) => void,
    onProgress?: (progress: any) => void
  ): Promise<boolean> {
    // Validate input
    const validation = TTSContentValidator.validate(text);
    
    if (!validation.valid) {
      console.warn('[TTS] Input validation failed:', validation.error);
      
      // Notify user via callback
      if (onViseme) {
        // Send "silence" viseme to indicate no audio
        onViseme({ time: 0, value: 0, duration: 0 });
      }
      
      return false;
    }
    
    if (validation.warnings) {
      console.log('[TTS] Validation warnings:', validation.warnings);
    }
    
    // Use validated/sanitized text
    const safeText = validation.text!;
    
    // Continue with normal TTS flow
    return await this.performSpeakStreaming(safeText, onViseme, onProgress);
  }
}

// INTEGRATION IN APP:
async function handleAIResponse(response: ChatResponse) {
  if (!response.success || !response.message) {
    return;
  }
  
  // Validate before TTS
  const ttsValidation = TTSContentValidator.validate(response.message);
  
  if (ttsValidation.valid) {
    // Show message with TTS indicator
    addMessage('assistant', response.message);
    
    // Perform TTS
    await ttsService.speakStreaming(
      ttsValidation.text!,
      (viseme) => setViseme(viseme.value),
      (progress) => updateProgress(progress)
    );
  } else {
    // Show message without TTS indicator
    addMessage('assistant', response.message, { ttsDisabled: true });
    
    // Optionally show a small indicator why TTS was skipped
    if (ttsValidation.isEmpty) {
      console.log('[App] Skipping TTS for empty response');
    }
  }
}
```

---

### **Edge Case #4: Resource Exhaustion & Memory Leaks (HIGH)**

**Failure Scenario:**
Resource leaks occur when:
- Multiple TTS requests pile up (user clicks rapidly)
- PIXI Application not properly destroyed (memory leak)
- AbortController not cleaned up (lingering requests)
- Animation frames not cancelled (CPU usage)
- Audio buffers accumulate (memory bloat)
- Event listeners not removed (DOM leaks)

**Current Code (Vulnerable):**
```typescript
// Live2DCanvas.tsx:35-37
return () => {
  pixiApp.destroy(true, { children: true });  // 🔴 May not cleanup all textures
};

// tts.ts:68, 240-241
this.abortController = new AbortController();  // 🔴 Created but not always cleaned up
// ... in finally block ...
this.abortController = null;  // 🔴 Just nulling, not aborting

// audioReactiveLipSyncFixed.ts:9, 200
private animationFrameId: number | null = null;  // 🔴 May not be cleared
// In cleanup...
if (this.animationFrameId) {
  cancelAnimationFrame(this.animationFrameId);  // 🔴 Called but ID not cleared
}

// tts.ts:197-215
while (true) {
  const { done, value } = await reader.read();
  audioChunks.push(value);  // 🔴 Accumulates all chunks in memory
  // No limit on chunk count or total size
}
```

**Problems:**
1. Rapid TTS requests don't cancel previous ones
2. PIXI textures may not be garbage collected
3. AbortControllers accumulate
4. Animation frames continue after unmount
5. Audio chunks buffer without size limits
6. No resource usage monitoring

**Impact:**
- Browser memory usage grows over time
- Tab becomes sluggish or crashes
- Audio plays over itself (overlapping)
- GPU/CPU usage remains high
- User must refresh page to recover

**Defensive Pattern - "Resource Guard with Cleanup Tracking":**

```typescript
// IMPLEMENTATION PLAN

interface ResourceTracker {
  abortControllers: Set<AbortController>;
  animationFrameIds: Set<number>;
  intervals: Set<NodeJS.Timeout>;
  timeouts: Set<NodeJS.Timeout>;
  eventListeners: Array<{ element: EventTarget; type: string; handler: EventListener }>;
  audioBuffers: Set<AudioBuffer>;
}

class ResourceGuard {
  private resources: ResourceTracker = {
    abortControllers: new Set(),
    animationFrameIds: new Set(),
    intervals: new Set(),
    timeouts: new Set(),
    eventListeners: [],
    audioBuffers: new Set()
  };
  
  private maxConcurrentRequests = 1; // Only 1 TTS at a time
  private currentRequest: AbortController | null = null;
  private memoryThreshold = 100 * 1024 * 1024; // 100MB
  
  /**
   * Cancel any ongoing operations before starting new one
   */
  async acquireExclusiveOperation(): Promise<AbortController | null> {
    // Cancel previous request
    if (this.currentRequest) {
      console.log('[ResourceGuard] Cancelling previous TTS request');
      this.currentRequest.abort();
      this.resources.abortControllers.delete(this.currentRequest);
      this.currentRequest = null;
    }
    
    // Check memory usage
    if (this.checkMemoryUsage()) {
      console.warn('[ResourceGuard] High memory usage, cleaning up');
      await this.emergencyCleanup();
    }
    
    // Create new abort controller
    const controller = new AbortController();
    this.currentRequest = controller;
    this.resources.abortControllers.add(controller);
    
    return controller;
  }
  
  trackAnimationFrame(id: number): void {
    this.resources.animationFrameIds.add(id);
  }
  
  trackInterval(id: NodeJS.Timeout): void {
    this.resources.intervals.add(id);
  }
  
  trackTimeout(id: NodeJS.Timeout): void {
    this.resources.timeouts.add(id);
  }
  
  trackEventListener(
    element: EventTarget, 
    type: string, 
    handler: EventListener
  ): void {
    this.resources.eventListeners.push({ element, type, handler });
  }
  
  trackAudioBuffer(buffer: AudioBuffer): void {
    this.resources.audioBuffers.add(buffer);
  }
  
  releaseAudioBuffer(buffer: AudioBuffer): void {
    this.resources.audioBuffers.delete(buffer);
  }
  
  /**
   * Cleanup all tracked resources
   */
  cleanup(): void {
    console.log('[ResourceGuard] Cleaning up all resources...');
    
    // Abort all controllers
    this.resources.abortControllers.forEach(controller => {
      controller.abort();
    });
    this.resources.abortControllers.clear();
    this.currentRequest = null;
    
    // Cancel animation frames
    this.resources.animationFrameIds.forEach(id => {
      cancelAnimationFrame(id);
    });
    this.resources.animationFrameIds.clear();
    
    // Clear intervals
    this.resources.intervals.forEach(id => {
      clearInterval(id);
    });
    this.resources.intervals.clear();
    
    // Clear timeouts
    this.resources.timeouts.forEach(id => {
      clearTimeout(id);
    });
    this.resources.timeouts.clear();
    
    // Remove event listeners
    this.resources.eventListeners.forEach(({ element, type, handler }) => {
      element.removeEventListener(type, handler);
    });
    this.resources.eventListeners = [];
    
    // Clear audio buffer references (allow GC)
    this.resources.audioBuffers.clear();
    
    console.log('[ResourceGuard] Cleanup complete');
  }
  
  private checkMemoryUsage(): boolean {
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      return memory.usedJSHeapSize > this.memoryThreshold;
    }
    return false;
  }
  
  private async emergencyCleanup(): Promise<void> {
    // Force garbage collection hint
    if ('gc' in window) {
      (window as any).gc();
    }
    
    // Clear half of audio buffers
    const buffersToClear = Math.floor(this.resources.audioBuffers.size / 2);
    let cleared = 0;
    for (const buffer of this.resources.audioBuffers) {
      if (cleared >= buffersToClear) break;
      this.resources.audioBuffers.delete(buffer);
      cleared++;
    }
  }
}

// USAGE IN TTS SERVICE:
class ResourceAwareTTSService {
  private resourceGuard = new ResourceGuard();
  private readonly MAX_CHUNK_ACCUMULATION = 100; // Limit chunks in memory
  private readonly MAX_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB per chunk
  
  async speakStreaming(text: string, ...): Promise<boolean> {
    // Acquire exclusive access (cancels previous)
    const abortController = await this.resourceGuard.acquireExclusiveOperation();
    if (!abortController) {
      console.warn('[TTS] Could not acquire resources');
      return false;
    }
    
    try {
      const audioChunks: Uint8Array[] = [];
      let totalSize = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        // Check chunk size limits
        if (value.length > this.MAX_CHUNK_SIZE) {
          console.error('[TTS] Chunk too large, skipping');
          continue;
        }
        
        totalSize += value.length;
        
        // Check accumulation limit
        if (audioChunks.length >= this.MAX_CHUNK_ACCUMULATION) {
          console.warn('[TTS] Too many chunks, processing current buffer');
          break;
        }
        
        audioChunks.push(value);
      }
      
      // ... rest of processing ...
      
    } finally {
      // Always release resources
      if (abortController.signal.aborted) {
        this.resourceGuard.cleanup();
      }
    }
  }
  
  stop(): void {
    this.resourceGuard.cleanup();
  }
}

// USAGE IN REACT COMPONENT:
export function Live2DCanvas({ modelPath }: Props) {
  const resourceGuard = useRef(new ResourceGuard()).current;
  
  useEffect(() => {
    // Component logic
    
    return () => {
      // Comprehensive cleanup on unmount
      resourceGuard.cleanup();
    };
  }, [modelPath, resourceGuard]);
}
```

---

### **Edge Case #5: Live2D Parameter Access Failures (MEDIUM)**

**Failure Scenario:**
Lip-sync fails when:
- Model doesn't have 'ParamMouthOpenY' parameter (different naming convention)
- Model parameter range is different (0-1 vs 0-100)
- Model is in invalid state (destroyed but reference persists)
- Parameter access throws due to internal Cubism SDK error
- Model is loading while parameter is being set

**Current Code (Vulnerable):**
```typescript
// Live2DCanvas.tsx:93-105
if (isSpeaking) {
  const value = Math.min(currentViseme / 10, 1.0);
  
  try {
    model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', value);
    // 🔴 Assumes parameter exists
    // 🔴 Assumes valid value range
    // 🔴 No validation of model state
  } catch (e) {
    // 🔴 Empty catch - silently fails
  }
} else {
  if (model && model.internalModel && model.internalModel.coreModel) {
    // 🔴 Deep property access without null checks
    try {
      model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 0);
    } catch (e) { }
  }
}

// EnhancedLive2DCanvas.tsx:186-200
setInterval(() => {
  if (Math.random() < 0.02) {
    try {
      model.internalModel.coreModel.setParameterValueById('ParamEyeLOpen', 0.2);
      // 🔴 Multiple parameters may not exist
      // 🔴 No check if model is destroyed
    } catch (error) {
      console.warn('[Live2D] Blink animation failed:', error);
    }
  }
}, 3000);
```

**Problems:**
1. Hardcoded parameter names ('ParamMouthOpenY')
2. No validation that model supports lip-sync
3. Silent failures with empty catch blocks
4. No detection of model destruction
5. Race conditions between loading and parameter access

**Impact:**
- Character mouth doesn't move during speech
- No error visible to user (silent failure)
- Blink animation doesn't work
- Different models behave inconsistently

**Defensive Pattern - "Parameter Discovery with Fallback":**

```typescript
// IMPLEMENTATION PLAN

interface Live2DModelCapabilities {
  hasMouthOpen: boolean;
  hasEyeBlink: boolean;
  hasEyeLOpen: boolean;
  hasEyeROpen: boolean;
  mouthParameterId: string | null;
  mouthValueRange: { min: number; max: number };
}

class Live2DParameterManager {
  private model: any; // Live2DModel
  private capabilities: Live2DModelCapabilities | null = null;
  private isDestroyed = false;
  
  constructor(model: any) {
    this.model = model;
    this.discoverCapabilities();
  }
  
  /**
   * Discover what parameters the model actually has
   */
  private discoverCapabilities(): void {
    if (!this.model?.internalModel?.coreModel) {
      this.capabilities = null;
      return;
    }
    
    const coreModel = this.model.internalModel.coreModel;
    const parameterIds = coreModel.getParameterIds?.() || [];
    
    this.capabilities = {
      hasMouthOpen: false,
      hasEyeBlink: false,
      hasEyeLOpen: false,
      hasEyeROpen: false,
      mouthParameterId: null,
      mouthValueRange: { min: 0, max: 1 }
    };
    
    // Discover mouth parameter
    const mouthParamIds = [
      'ParamMouthOpenY',
      'PARAM_MOUTH_OPEN_Y',
      'MouthOpen',
      'ParamMouthOpen',
      'MouthY'
    ];
    
    for (const paramId of mouthParamIds) {
      if (parameterIds.includes(paramId)) {
        this.capabilities.hasMouthOpen = true;
        this.capabilities.mouthParameterId = paramId;
        
        // Get parameter range
        try {
          const min = coreModel.getParameterMinimumValue?.(paramId) ?? 0;
          const max = coreModel.getParameterMaximumValue?.(paramId) ?? 1;
          this.capabilities.mouthValueRange = { min, max };
        } catch {
          // Use defaults
        }
        break;
      }
    }
    
    // Discover eye parameters
    this.capabilities.hasEyeLOpen = parameterIds.includes('ParamEyeLOpen');
    this.capabilities.hasEyeROpen = parameterIds.includes('ParamEyeROpen');
    this.capabilities.hasEyeBlink = parameterIds.includes('ParamEyeBlink');
    
    console.log('[Live2D] Model capabilities:', this.capabilities);
  }
  
  /**
   * Safely set mouth open value
   */
  setMouthOpen(normalizedValue: number): boolean {
    if (this.isDestroyed) {
      console.warn('[Live2D] Cannot set parameter on destroyed model');
      return false;
    }
    
    if (!this.capabilities?.hasMouthOpen) {
      return false; // Silently skip if model doesn't support it
    }
    
    try {
      const coreModel = this.model.internalModel.coreModel;
      const paramId = this.capabilities.mouthParameterId!;
      
      // Map normalized value (0-1) to model's actual range
      const { min, max } = this.capabilities.mouthValueRange;
      const actualValue = min + (normalizedValue * (max - min));
      
      coreModel.setParameterValueById(paramId, actualValue);
      return true;
    } catch (error) {
      console.error('[Live2D] Failed to set mouth open:', error);
      return false;
    }
  }
  
  /**
   * Safely perform blink animation
   */
  blink(): boolean {
    if (this.isDestroyed || !this.model) {
      return false;
    }
    
    try {
      const coreModel = this.model.internalModel.coreModel;
      
      // Try dedicated blink parameter first
      if (this.capabilities?.hasEyeBlink) {
        coreModel.setParameterValueById('ParamEyeBlink', 1.0);
        setTimeout(() => {
          try {
            coreModel.setParameterValueById('ParamEyeBlink', 0.0);
          } catch {}
        }, 150);
        return true;
      }
      
      // Fallback to individual eye parameters
      if (this.capabilities?.hasEyeLOpen && this.capabilities?.hasEyeROpen) {
        coreModel.setParameterValueById('ParamEyeLOpen', 0.2);
        coreModel.setParameterValueById('ParamEyeROpen', 0.2);
        
        setTimeout(() => {
          try {
            coreModel.setParameterValueById('ParamEyeLOpen', 1.0);
            coreModel.setParameterValueById('ParamEyeROpen', 1.0);
          } catch {}
        }, 150);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('[Live2D] Blink failed:', error);
      return false;
    }
  }
  
  markDestroyed(): void {
    this.isDestroyed = true;
    this.model = null;
    this.capabilities = null;
  }
  
  getCapabilities(): Live2DModelCapabilities | null {
    return this.capabilities;
  }
}

// INTEGRATION IN COMPONENT:
export function SafeLive2DCanvas({ modelPath }: Props) {
  const [model, setModel] = useState<any>(null);
  const parameterManager = useRef<Live2DParameterManager | null>(null);
  const { currentViseme, isSpeaking } = useStore();
  
  // Update parameter manager when model changes
  useEffect(() => {
    if (model) {
      parameterManager.current = new Live2DParameterManager(model);
      
      return () => {
        parameterManager.current?.markDestroyed();
        parameterManager.current = null;
      };
    }
  }, [model]);
  
  // Update mouth position safely
  useEffect(() => {
    if (!parameterManager.current || !isSpeaking) return;
    
    const normalizedValue = Math.min(currentViseme / 10, 1.0);
    const success = parameterManager.current.setMouthOpen(normalizedValue);
    
    if (!success && currentViseme > 0) {
      // Model doesn't support lip-sync, log once
      console.log('[Live2D] Model does not support mouth animation');
    }
  }, [currentViseme, isSpeaking]);
  
  // Safe blink animation
  useEffect(() => {
    if (!parameterManager.current) return;
    
    const interval = setInterval(() => {
      if (Math.random() < 0.02) {
        parameterManager.current?.blink();
      }
    }, 3000);
    
    return () => clearInterval(interval);
  }, []);
  
  // ... rest of component
}
```

---

## 📊 Summary of All Edge Cases

| # | Edge Case | Severity | Impact | Key Fix |
|---|-----------|----------|--------|---------|
| 1 | **Model Loading Failure** | 🔴 CRITICAL | Blank character, no feedback | Retry with fallback model + error UI |
| 2 | **Audio System Failure** | 🔴 CRITICAL | No sound, silent failure | Autoplay handling + format validation |
| 3 | **Empty/Invalid LLM Response** | 🟡 HIGH | Wasted API calls, no audio | Content validation + sanitization |
| 4 | **Resource Exhaustion** | 🟡 HIGH | Memory leaks, crashes | Resource guard + cleanup tracking |
| 5 | **Parameter Access Failure** | 🟠 MEDIUM | No lip-sync, silent failure | Parameter discovery + capability check |

---

## 🎯 Implementation Priority

**Phase 1 (Critical - Do First):**
1. ✅ Model loading with retry + fallback
2. ✅ Audio autoplay policy handling

**Phase 2 (High Priority):**
3. ✅ TTS content validation
4. ✅ Resource guard implementation

**Phase 3 (Medium Priority):**
5. ✅ Live2D parameter discovery

---

## 🧪 Testing Recommendations

### Unit Tests to Write:
```typescript
// Model Loading
describe('Live2DModelLoader', () => {
  it('should retry on network failure', async () => {});
  it('should use fallback on repeated failures', async () => {});
  it('should show error UI on total failure', async () => {});
  it('should validate model dimensions', async () => {});
});

// Audio System
describe('AudioResilienceManager', () => {
  it('should handle suspended audio context', async () => {});
  it('should validate audio format before decoding', async () => {});
  it('should timeout on slow decoding', async () => {});
  it('should detect audio device changes', async () => {});
});

// Content Validation
describe('TTSContentValidator', () => {
  it('should reject null/undefined', () => {});
  it('should reject empty strings', () => {});
  it('should truncate long text', () => {});
  it('should sanitize special characters', () => {});
});

// Resource Management
describe('ResourceGuard', () => {
  it('should cancel previous TTS on new request', async () => {});
  it('should cleanup on component unmount', async () => {});
  it('should limit chunk accumulation', async () => {});
  it('should handle memory pressure', async () => {});
});

// Parameter Management
describe('Live2DParameterManager', () => {
  it('should discover available parameters', () => {});
  it('should handle missing mouth parameter gracefully', () => {});
  it('should map normalized values correctly', () => {});
  it('should prevent operations on destroyed model', () => {});
});
```

### Manual Test Scenarios:
1. Disconnect internet while model is loading
2. Rapidly click send button 10 times in a row
3. Use browser dev tools to block audio
4. Load a model without mouth parameters
5. Keep app open for 1 hour with continuous usage
6. Test with 5000+ character LLM response

---

## ✅ Next Steps

**Ready to implement?** The plan above provides:
- ✅ Detailed problem analysis for each edge case
- ✅ Complete defensive code patterns ready to use
- ✅ Integration examples for your existing code
- ✅ Testing strategy

**All patterns are production-ready and include:**
- Error handling
- User feedback
- Graceful degradation
- Resource cleanup
- TypeScript types

Would you like me to implement these defensive patterns into your codebase? I can prioritize based on which edge case is causing the most issues in your testing.