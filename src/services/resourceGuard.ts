/**
 * Resource Guard
 * Manages resource cleanup to prevent memory leaks and handle concurrent operations
 */

interface TrackedResources {
  abortControllers: Set<AbortController>;
  animationFrameIds: Set<number>;
  intervals: Set<NodeJS.Timeout>;
  timeouts: Set<NodeJS.Timeout>;
  eventListeners: Array<{ element: EventTarget; type: string; handler: EventListener }>;
}

export class ResourceGuard {
  private resources: TrackedResources = {
    abortControllers: new Set(),
    animationFrameIds: new Set(),
    intervals: new Set(),
    timeouts: new Set(),
    eventListeners: []
  };

  private currentRequest: AbortController | null = null;
  private readonly MAX_CHUNK_ACCUMULATION = 100;

  /**
   * Cancel any ongoing operations and acquire exclusive access
   */
  async acquireExclusiveOperation(context?: string): Promise<AbortController | null> {
    // Cancel previous request
    if (this.currentRequest) {
      console.log(`[ResourceGuard] Cancelling previous operation${context ? ` (${context})` : ''}`);
      this.currentRequest.abort();
      this.resources.abortControllers.delete(this.currentRequest);
      this.currentRequest = null;
    }

    // Create new abort controller
    const controller = new AbortController();
    this.currentRequest = controller;
    this.resources.abortControllers.add(controller);

    return controller;
  }

  /**
   * Track an AbortController for cleanup
   */
  trackAbortController(controller: AbortController): void {
    this.resources.abortControllers.add(controller);
  }

  /**
   * Track an animation frame ID
   */
  trackAnimationFrame(id: number): void {
    this.resources.animationFrameIds.add(id);
  }

  /**
   * Track an interval ID
   */
  trackInterval(id: NodeJS.Timeout): void {
    this.resources.intervals.add(id);
  }

  /**
   * Track a timeout ID
   */
  trackTimeout(id: NodeJS.Timeout): void {
    this.resources.timeouts.add(id);
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
   * Release a specific abort controller
   */
  releaseAbortController(controller: AbortController): void {
    controller.abort();
    this.resources.abortControllers.delete(controller);
    if (this.currentRequest === controller) {
      this.currentRequest = null;
    }
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
   * Clear a specific interval
   */
  clearInterval(id: NodeJS.Timeout): void {
    if (this.resources.intervals.has(id)) {
      window.clearInterval(id);
      this.resources.intervals.delete(id);
    }
  }

  /**
   * Clear a specific timeout
   */
  clearTimeout(id: NodeJS.Timeout): void {
    if (this.resources.timeouts.has(id)) {
      window.clearTimeout(id);
      this.resources.timeouts.delete(id);
    }
  }

  /**
   * Check if we've accumulated too many chunks
   */
  shouldLimitAccumulation(currentCount: number): boolean {
    return currentCount >= this.MAX_CHUNK_ACCUMULATION;
  }

  /**
   * Cleanup all tracked resources
   */
  cleanup(): void {
    console.log('[ResourceGuard] Cleaning up all resources...');

    // Abort all controllers
    this.resources.abortControllers.forEach(controller => {
      try {
        controller.abort();
      } catch {
        // Ignore errors during cleanup
      }
    });
    this.resources.abortControllers.clear();
    this.currentRequest = null;

    // Cancel animation frames
    this.resources.animationFrameIds.forEach(id => {
      try {
        window.cancelAnimationFrame(id);
      } catch {
        // Ignore
      }
    });
    this.resources.animationFrameIds.clear();

    // Clear intervals
    this.resources.intervals.forEach(id => {
      try {
        window.clearInterval(id);
      } catch {
        // Ignore
      }
    });
    this.resources.intervals.clear();

    // Clear timeouts
    this.resources.timeouts.forEach(id => {
      try {
        window.clearTimeout(id);
      } catch {
        // Ignore
      }
    });
    this.resources.timeouts.clear();

    // Remove event listeners
    this.resources.eventListeners.forEach(({ element, type, handler }) => {
      try {
        element.removeEventListener(type, handler);
      } catch {
        // Ignore
      }
    });
    this.resources.eventListeners = [];

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
  } {
    return {
      abortControllers: this.resources.abortControllers.size,
      animationFrames: this.resources.animationFrameIds.size,
      intervals: this.resources.intervals.size,
      timeouts: this.resources.timeouts.size,
      eventListeners: this.resources.eventListeners.length
    };
  }
}
