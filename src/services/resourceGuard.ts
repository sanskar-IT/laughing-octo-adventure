/**
 * Resource Guard - Production Hardened
 *
 * Manages resource cleanup to prevent memory leaks and handle concurrent operations.
 * Automatically revokes URL objects and aborts pending LLM streams when context changes.
 *
 * Features:
 * - Exclusive operation acquisition (cancels previous on new request)
 * - Object URL tracking and automatic revocation
 * - Stream abort management
 * - Animation frame and timer tracking
 * - Event listener cleanup
 * - Context-aware cleanup (character switch, new prompt)
 */

interface TrackedResources {
  abortControllers: Map<string, AbortController>;
  animationFrameIds: Set<number>;
  intervals: Set<ReturnType<typeof setInterval>>;
  timeouts: Set<ReturnType<typeof setTimeout>>;
  eventListeners: Array<{ element: EventTarget; type: string; handler: EventListener }>;
  objectURLs: Map<string, { url: string; createdAt: number; context?: string }>;
  activeStreams: Map<string, ReadableStreamDefaultReader<Uint8Array>>;
}

export interface CleanupOptions {
  /** Cleanup reason for logging */
  reason?: string;
  /** Only cleanup resources matching this context */
  context?: string;
  /** Keep object URLs (useful when switching prompts but not characters) */
  keepObjectURLs?: boolean;
}

export class ResourceGuard {
  private resources: TrackedResources = {
    abortControllers: new Map(),
    animationFrameIds: new Set(),
    intervals: new Set(),
    timeouts: new Set(),
    eventListeners: [],
    objectURLs: new Map(),
    activeStreams: new Map()
  };

  private currentOperation: { id: string; controller: AbortController } | null = null;
  private readonly MAX_CHUNK_ACCUMULATION = 100;
  private readonly MAX_OBJECT_URLS = 50;
  private readonly OBJECT_URL_CLEANUP_AGE_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Cancel any ongoing operations and acquire exclusive access
   * Use this when starting a new LLM stream or TTS request
   */
  async acquireExclusiveOperation(context?: string): Promise<AbortController | null> {
    const operationId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Cancel previous operation
    if (this.currentOperation) {
      console.log(
        `[ResourceGuard] Cancelling previous operation: ${this.currentOperation.id}` +
        (context ? ` (new context: ${context})` : '')
      );
      this.currentOperation.controller.abort();
      this.resources.abortControllers.delete(this.currentOperation.id);
    }

    // Create new abort controller
    const controller = new AbortController();
    this.currentOperation = { id: operationId, controller };
    this.resources.abortControllers.set(operationId, controller);

    console.log(`[ResourceGuard] Acquired exclusive operation: ${operationId}`);
    return controller;
  }

  /**
   * Track an AbortController for cleanup
   */
  trackAbortController(id: string, controller: AbortController): void {
    this.resources.abortControllers.set(id, controller);
  }

  /**
   * Abort a specific controller by ID
   */
  abortController(id: string): boolean {
    const controller = this.resources.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.resources.abortControllers.delete(id);
      return true;
    }
    return false;
  }

  /**
   * Abort all tracked controllers
   */
  abortAllControllers(): void {
    this.resources.abortControllers.forEach((controller) => {
      try {
        controller.abort();
      } catch {
        // Ignore errors during cleanup
      }
    });
    this.resources.abortControllers.clear();
    this.currentOperation = null;
    console.log('[ResourceGuard] All abort controllers cancelled');
  }

  /**
   * Track an active stream reader for cleanup
   */
  trackStream(id: string, reader: ReadableStreamDefaultReader<Uint8Array>): void {
    this.resources.activeStreams.set(id, reader);
  }

  /**
   * Cancel and cleanup a specific stream
   */
  async cancelStream(id: string): Promise<void> {
    const reader = this.resources.activeStreams.get(id);
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // Stream may already be closed
      }
      this.resources.activeStreams.delete(id);
    }
  }

  /**
   * Cancel all active streams
   */
  async cancelAllStreams(): Promise<void> {
    const cancelPromises = Array.from(this.resources.activeStreams.entries()).map(
      async ([_id, reader]) => {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancellation errors
        }
      }
    );

    await Promise.all(cancelPromises);
    this.resources.activeStreams.clear();
    console.log('[ResourceGuard] All streams cancelled');
  }

  /**
   * Create and track an object URL
   */
  createObjectURL(blob: Blob, context?: string): string {
    // Cleanup old URLs if we're at the limit
    if (this.resources.objectURLs.size >= this.MAX_OBJECT_URLS) {
      this.cleanupOldObjectURLs();
    }

    const url = URL.createObjectURL(blob);
    const id = `url_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.resources.objectURLs.set(id, {
      url,
      createdAt: Date.now(),
      context
    });

    return url;
  }

  /**
   * Revoke a specific object URL by its URL value
   */
  revokeObjectURLByValue(urlValue: string): boolean {
    for (const [id, { url }] of this.resources.objectURLs) {
      if (url === urlValue) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore errors
        }
        this.resources.objectURLs.delete(id);
        return true;
      }
    }
    return false;
  }

  /**
   * Revoke all object URLs for a specific context
   */
  revokeObjectURLsForContext(context: string): number {
    let revokedCount = 0;

    for (const [id, data] of this.resources.objectURLs) {
      if (data.context === context) {
        try {
          URL.revokeObjectURL(data.url);
        } catch {
          // Ignore errors
        }
        this.resources.objectURLs.delete(id);
        revokedCount++;
      }
    }

    if (revokedCount > 0) {
      console.log(`[ResourceGuard] Revoked ${revokedCount} object URLs for context: ${context}`);
    }

    return revokedCount;
  }

  /**
   * Revoke all tracked object URLs
   */
  revokeAllObjectURLs(): void {
    this.resources.objectURLs.forEach(({ url }) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore errors
      }
    });
    this.resources.objectURLs.clear();
    console.log('[ResourceGuard] All object URLs revoked');
  }

  /**
   * Cleanup old object URLs based on age
   */
  private cleanupOldObjectURLs(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [id, data] of this.resources.objectURLs) {
      if (now - data.createdAt > this.OBJECT_URL_CLEANUP_AGE_MS) {
        try {
          URL.revokeObjectURL(data.url);
        } catch {
          // Ignore errors
        }
        this.resources.objectURLs.delete(id);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[ResourceGuard] Cleaned up ${cleanedCount} old object URLs`);
    }
  }

  /**
   * Track an animation frame ID
   */
  trackAnimationFrame(id: number): void {
    this.resources.animationFrameIds.add(id);
  }

  /**
   * Cancel a specific animation frame
   */
  cancelAnimationFrame(id: number): void {
    if (this.resources.animationFrameIds.has(id)) {
      window.cancelAnimationFrame(id);
      this.resources.animationFrameIds.delete(id);
    }
  }

  /**
   * Cancel all animation frames
   */
  cancelAllAnimationFrames(): void {
    this.resources.animationFrameIds.forEach(id => {
      try {
        window.cancelAnimationFrame(id);
      } catch {
        // Ignore errors
      }
    });
    this.resources.animationFrameIds.clear();
  }

  /**
   * Track an interval ID
   */
  trackInterval(id: ReturnType<typeof setInterval>): void {
    this.resources.intervals.add(id);
  }

  /**
   * Clear a specific interval
   */
  clearInterval(id: ReturnType<typeof setInterval>): void {
    if (this.resources.intervals.has(id)) {
      window.clearInterval(id);
      this.resources.intervals.delete(id);
    }
  }

  /**
   * Clear all intervals
   */
  clearAllIntervals(): void {
    this.resources.intervals.forEach(id => {
      try {
        window.clearInterval(id);
      } catch {
        // Ignore errors
      }
    });
    this.resources.intervals.clear();
  }

  /**
   * Track a timeout ID
   */
  trackTimeout(id: ReturnType<typeof setTimeout>): void {
    this.resources.timeouts.add(id);
  }

  /**
   * Clear a specific timeout
   */
  clearTimeout(id: ReturnType<typeof setTimeout>): void {
    if (this.resources.timeouts.has(id)) {
      window.clearTimeout(id);
      this.resources.timeouts.delete(id);
    }
  }

  /**
   * Clear all timeouts
   */
  clearAllTimeouts(): void {
    this.resources.timeouts.forEach(id => {
      try {
        window.clearTimeout(id);
      } catch {
        // Ignore errors
      }
    });
    this.resources.timeouts.clear();
  }

  /**
   * Track an event listener for cleanup
   */
  trackEventListener(
    element: EventTarget,
    type: string,
    handler: EventListener
  ): void {
    this.resources.eventListeners.push({ element, type, handler });
  }

  /**
   * Remove all tracked event listeners
   */
  removeAllEventListeners(): void {
    this.resources.eventListeners.forEach(({ element, type, handler }) => {
      try {
        element.removeEventListener(type, handler);
      } catch {
        // Ignore errors
      }
    });
    this.resources.eventListeners = [];
  }

  /**
   * Check if we've accumulated too many chunks
   */
  shouldLimitAccumulation(currentCount: number): boolean {
    return currentCount >= this.MAX_CHUNK_ACCUMULATION;
  }

  /**
   * Called when user switches characters - full cleanup
   */
  async onCharacterSwitch(newCharacterId?: string): Promise<void> {
    console.log(`[ResourceGuard] Character switch${newCharacterId ? `: ${newCharacterId}` : ''}`);

    // Abort all pending operations
    this.abortAllControllers();

    // Cancel all streams
    await this.cancelAllStreams();

    // Revoke all object URLs
    this.revokeAllObjectURLs();

    // Cancel animations
    this.cancelAllAnimationFrames();

    // Clear timers
    this.clearAllIntervals();
    this.clearAllTimeouts();

    console.log('[ResourceGuard] Character switch cleanup complete');
  }

  /**
   * Called when user starts a new prompt - cancel current operations
   */
  async onNewPrompt(): Promise<void> {
    console.log('[ResourceGuard] New prompt, cancelling current operations');

    // Abort current operation (LLM stream)
    if (this.currentOperation) {
      this.currentOperation.controller.abort();
      this.resources.abortControllers.delete(this.currentOperation.id);
      this.currentOperation = null;
    }

    // Cancel active streams
    await this.cancelAllStreams();

    // Keep object URLs for now (may be audio still playing)
  }

  /**
   * Full cleanup of all tracked resources
   */
  async cleanup(options: CleanupOptions = {}): Promise<void> {
    const { reason, context, keepObjectURLs } = options;
    console.log(`[ResourceGuard] Cleanup${reason ? `: ${reason}` : ''}...`);

    // Abort all controllers
    if (context) {
      // TODO: Add context filtering for abort controllers
      this.abortAllControllers();
    } else {
      this.abortAllControllers();
    }

    // Cancel all streams
    await this.cancelAllStreams();

    // Cancel animation frames
    this.cancelAllAnimationFrames();

    // Clear intervals
    this.clearAllIntervals();

    // Clear timeouts
    this.clearAllTimeouts();

    // Remove event listeners
    this.removeAllEventListeners();

    // Handle object URLs
    if (!keepObjectURLs) {
      if (context) {
        this.revokeObjectURLsForContext(context);
      } else {
        this.revokeAllObjectURLs();
      }
    }

    console.log('[ResourceGuard] Cleanup complete');
  }

  /**
   * Get current resource counts for debugging
   */
  getResourceCounts(): {
    abortControllers: number;
    animationFrames: number;
    intervals: number;
    timeouts: number;
    eventListeners: number;
    objectURLs: number;
    activeStreams: number;
  } {
    return {
      abortControllers: this.resources.abortControllers.size,
      animationFrames: this.resources.animationFrameIds.size,
      intervals: this.resources.intervals.size,
      timeouts: this.resources.timeouts.size,
      eventListeners: this.resources.eventListeners.length,
      objectURLs: this.resources.objectURLs.size,
      activeStreams: this.resources.activeStreams.size
    };
  }

  /**
   * Check if there are any active resources
   */
  hasActiveResources(): boolean {
    const counts = this.getResourceCounts();
    return Object.values(counts).some(count => count > 0);
  }
}

// Singleton instance for global use
let _resourceGuard: ResourceGuard | null = null;

export function getResourceGuard(): ResourceGuard {
  if (!_resourceGuard) {
    _resourceGuard = new ResourceGuard();
  }
  return _resourceGuard;
}
