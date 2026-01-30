/**
 * Live2D Parameter Manager
 * Discovers and safely manages Live2D model parameters for lip-sync and animations
 */

export interface ModelCapabilities {
  hasMouthOpen: boolean;
  hasEyeBlink: boolean;
  hasEyeLOpen: boolean;
  hasEyeROpen: boolean;
  mouthParameterId: string | null;
  mouthValueRange: { min: number; max: number };
  eyeLOpenRange: { min: number; max: number };
  eyeROpenRange: { min: number; max: number };
}

export class Live2DParameterManager {
  private model: any; // Live2DModel
  private capabilities: ModelCapabilities | null = null;
  private isDestroyed = false;
  private blinkTimer: NodeJS.Timeout | null = null;

  constructor(model: any) {
    this.model = model;
    this.discoverCapabilities();
    this.startBlinkAnimation();
  }

  /**
   * Auto-discover what parameters the model supports
   */
  private discoverCapabilities(): void {
    if (!this.model?.internalModel?.coreModel) {
      this.capabilities = null;
      return;
    }

    const coreModel = this.model.internalModel.coreModel;
    const parameterIds = this.getParameterIds(coreModel);

    this.capabilities = {
      hasMouthOpen: false,
      hasEyeBlink: false,
      hasEyeLOpen: false,
      hasEyeROpen: false,
      mouthParameterId: null,
      mouthValueRange: { min: 0, max: 1 },
      eyeLOpenRange: { min: 0, max: 1 },
      eyeROpenRange: { min: 0, max: 1 }
    };

    // Discover mouth parameter with multiple naming conventions
    const mouthParamIds = [
      'ParamMouthOpenY',
      'PARAM_MOUTH_OPEN_Y',
      'MouthOpen',
      'ParamMouthOpen',
      'MouthY',
      'ParamMouthA',
      'Mouth_A'
    ];

    for (const paramId of mouthParamIds) {
      if (parameterIds.includes(paramId)) {
        this.capabilities.hasMouthOpen = true;
        this.capabilities.mouthParameterId = paramId;

        // Get parameter range
        try {
          const min = this.getParameterMin(coreModel, paramId) ?? 0;
          const max = this.getParameterMax(coreModel, paramId) ?? 1;
          this.capabilities.mouthValueRange = { min, max };
        } catch {
          // Use defaults
        }
        break;
      }
    }

    // Discover eye parameters
    if (parameterIds.includes('ParamEyeLOpen')) {
      this.capabilities.hasEyeLOpen = true;
      try {
        const min = this.getParameterMin(coreModel, 'ParamEyeLOpen') ?? 0;
        const max = this.getParameterMax(coreModel, 'ParamEyeLOpen') ?? 1;
        this.capabilities.eyeLOpenRange = { min, max };
      } catch {}
    }

    if (parameterIds.includes('ParamEyeROpen')) {
      this.capabilities.hasEyeROpen = true;
      try {
        const min = this.getParameterMin(coreModel, 'ParamEyeROpen') ?? 0;
        const max = this.getParameterMax(coreModel, 'ParamEyeROpen') ?? 1;
        this.capabilities.eyeROpenRange = { min, max };
      } catch {}
    }

    if (parameterIds.includes('ParamEyeBlink')) {
      this.capabilities.hasEyeBlink = true;
    }

    console.log('[Live2D] Model capabilities:', this.capabilities);
  }

  private getParameterIds(coreModel: any): string[] {
    try {
      // Try different methods to get parameter IDs
      if (coreModel.getParameterIds) {
        return coreModel.getParameterIds();
      }
      if (coreModel._parameterIds) {
        return coreModel._parameterIds;
      }
      return [];
    } catch {
      return [];
    }
  }

  private getParameterMin(coreModel: any, paramId: string): number | null {
    try {
      if (coreModel.getParameterMinimumValue) {
        return coreModel.getParameterMinimumValue(paramId);
      }
      return null;
    } catch {
      return null;
    }
  }

  private getParameterMax(coreModel: any, paramId: string): number | null {
    try {
      if (coreModel.getParameterMaximumValue) {
        return coreModel.getParameterMaximumValue(paramId);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Set mouth open value (0.0 to 1.0 normalized)
   */
  setMouthOpen(normalizedValue: number): boolean {
    if (this.isDestroyed) {
      return false;
    }

    if (!this.capabilities?.hasMouthOpen) {
      return false; // Model doesn't support mouth animation
    }

    try {
      const coreModel = this.model.internalModel.coreModel;
      const paramId = this.capabilities.mouthParameterId!;

      // Clamp and map to model's range
      const clamped = Math.max(0, Math.min(1, normalizedValue));
      const { min, max } = this.capabilities.mouthValueRange;
      const actualValue = min + (clamped * (max - min));

      this.setParameterValue(coreModel, paramId, actualValue);
      return true;
    } catch (error) {
      console.warn('[Live2D] Failed to set mouth open:', error);
      return false;
    }
  }

  /**
   * Set left eye openness (0.0 = closed, 1.0 = open)
   */
  setEyeLOpen(normalizedValue: number): boolean {
    if (this.isDestroyed || !this.capabilities?.hasEyeLOpen) {
      return false;
    }

    try {
      const coreModel = this.model.internalModel.coreModel;
      const clamped = Math.max(0, Math.min(1, normalizedValue));
      const { min, max } = this.capabilities.eyeLOpenRange;
      const actualValue = min + (clamped * (max - min));

      this.setParameterValue(coreModel, 'ParamEyeLOpen', actualValue);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Set right eye openness (0.0 = closed, 1.0 = open)
   */
  setEyeROpen(normalizedValue: number): boolean {
    if (this.isDestroyed || !this.capabilities?.hasEyeROpen) {
      return false;
    }

    try {
      const coreModel = this.model.internalModel.coreModel;
      const clamped = Math.max(0, Math.min(1, normalizedValue));
      const { min, max } = this.capabilities.eyeROpenRange;
      const actualValue = min + (clamped * (max - min));

      this.setParameterValue(coreModel, 'ParamEyeROpen', actualValue);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Perform a blink animation
   */
  blink(): boolean {
    if (this.isDestroyed) {
      return false;
    }

    try {
      // Use dedicated blink parameter if available
      if (this.capabilities?.hasEyeBlink) {
        this.setParameterValue(
          this.model.internalModel.coreModel,
          'ParamEyeBlink',
          1.0
        );

        setTimeout(() => {
          if (!this.isDestroyed) {
            try {
              this.setParameterValue(
                this.model.internalModel.coreModel,
                'ParamEyeBlink',
                0.0
              );
            } catch {}
          }
        }, 150);
        return true;
      }

      // Fallback to individual eye parameters
      if (this.capabilities?.hasEyeLOpen && this.capabilities?.hasEyeROpen) {
        this.setEyeLOpen(0.2);
        this.setEyeROpen(0.2);

        setTimeout(() => {
          if (!this.isDestroyed) {
            this.setEyeLOpen(1.0);
            this.setEyeROpen(1.0);
          }
        }, 150);
        return true;
      }

      return false;
    } catch (error) {
      console.warn('[Live2D] Blink animation failed:', error);
      return false;
    }
  }

  /**
   * Start automatic blink animation
   */
  startBlinkAnimation(): void {
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer);
    }

    // Blink every 3-5 seconds randomly
    const scheduleNextBlink = () => {
      const delay = 3000 + Math.random() * 2000;
      this.blinkTimer = setTimeout(() => {
        if (!this.isDestroyed && Math.random() < 0.7) { // 70% chance to blink
          this.blink();
        }
        scheduleNextBlink();
      }, delay);
    };

    scheduleNextBlink();
  }

  /**
   * Stop automatic blink animation
   */
  stopBlinkAnimation(): void {
    if (this.blinkTimer) {
      clearTimeout(this.blinkTimer);
      this.blinkTimer = null;
    }
  }

  private setParameterValue(coreModel: any, paramId: string, value: number): void {
    if (coreModel.setParameterValueById) {
      coreModel.setParameterValueById(paramId, value);
    } else if (coreModel.setParameterValue) {
      coreModel.setParameterValue(paramId, value);
    }
  }

  /**
   * Mark model as destroyed (prevents further operations)
   */
  markDestroyed(): void {
    this.isDestroyed = true;
    this.stopBlinkAnimation();
    this.model = null;
    this.capabilities = null;
  }

  /**
   * Check if model supports mouth animation
   */
  supportsMouthAnimation(): boolean {
    return !!this.capabilities?.hasMouthOpen;
  }

  /**
   * Get discovered capabilities
   */
  getCapabilities(): ModelCapabilities | null {
    return this.capabilities;
  }
}
