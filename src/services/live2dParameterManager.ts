/**
 * Live2D Parameter Manager - Production Hardened
 *
 * Discovers and safely manages Live2D model parameters for lip-sync and animations.
 * Performs Parameter Discovery at model load time to support various model formats.
 *
 * Features:
 * - Automatic parameter discovery at load time
 * - Fallback parameter names for different model conventions
 * - Safe parameter value mapping with clamping
 * - Automatic blink animation
 * - Expression support
 */

export interface ModelCapabilities {
  hasMouthOpen: boolean;
  hasEyeBlink: boolean;
  hasEyeLOpen: boolean;
  hasEyeROpen: boolean;
  hasBodyAngle: boolean;
  hasBreath: boolean;
  mouthParameterId: string | null;
  eyeLOpenParameterId: string | null;
  eyeROpenParameterId: string | null;
  eyeBlinkParameterId: string | null;
  bodyAngleParameterId: string | null;
  breathParameterId: string | null;
  mouthValueRange: { min: number; max: number };
  eyeLOpenRange: { min: number; max: number };
  eyeROpenRange: { min: number; max: number };
  allParameterIds: string[];
}

// Common parameter name variants across different Live2D models
const MOUTH_PARAM_VARIANTS = [
  'ParamMouthOpenY',
  'PARAM_MOUTH_OPEN_Y',
  'MouthOpen',
  'ParamMouthOpen',
  'MouthY',
  'ParamMouthA',
  'Mouth_A',
  'f0_mouth_open',      // Fallback for custom models
  'mouth_open',
  'param_mouth',
  'ParamMouthForm',
  'PARAM_MOUTH_FORM'
];

const EYE_L_OPEN_VARIANTS = [
  'ParamEyeLOpen',
  'PARAM_EYE_L_OPEN',
  'EyeLOpen',
  'EyeL',
  'eye_l_open',
  'f0_eye_l_open'
];

const EYE_R_OPEN_VARIANTS = [
  'ParamEyeROpen',
  'PARAM_EYE_R_OPEN',
  'EyeROpen',
  'EyeR',
  'eye_r_open',
  'f0_eye_r_open'
];

const EYE_BLINK_VARIANTS = [
  'ParamEyeBlink',
  'PARAM_EYE_BLINK',
  'EyeBlink',
  'eye_blink',
  'f0_eye_blink',
  'Blink'
];

const BODY_ANGLE_VARIANTS = [
  'ParamBodyAngleX',
  'PARAM_BODY_ANGLE_X',
  'BodyAngleX',
  'body_angle_x',
  'ParamBodyAngleY',
  'ParamBodyAngleZ'
];

const BREATH_VARIANTS = [
  'ParamBreath',
  'PARAM_BREATH',
  'Breath',
  'breath'
];

export class Live2DParameterManager {
  private model: unknown; // Live2DModel
  private capabilities: ModelCapabilities | null = null;
  private isDestroyed = false;
  private blinkTimer: ReturnType<typeof setTimeout> | null = null;
  private breathTimer: ReturnType<typeof setInterval> | null = null;
  private breathPhase = 0;

  constructor(model: unknown) {
    this.model = model;
    this.discoverCapabilities();
    this.startBlinkAnimation();
    this.startBreathAnimation();
  }

  /**
   * Auto-discover what parameters the model supports
   * This runs at model load time and scans for common parameter name variants
   */
  private discoverCapabilities(): void {
    const coreModel = this.getCoreModel();
    if (!coreModel) {
      console.warn('[Live2D] Could not access core model for parameter discovery');
      this.capabilities = null;
      return;
    }

    const parameterIds = this.getParameterIds(coreModel);
    console.log(`[Live2D] Discovered ${parameterIds.length} parameters:`, parameterIds.slice(0, 20));

    this.capabilities = {
      hasMouthOpen: false,
      hasEyeBlink: false,
      hasEyeLOpen: false,
      hasEyeROpen: false,
      hasBodyAngle: false,
      hasBreath: false,
      mouthParameterId: null,
      eyeLOpenParameterId: null,
      eyeROpenParameterId: null,
      eyeBlinkParameterId: null,
      bodyAngleParameterId: null,
      breathParameterId: null,
      mouthValueRange: { min: 0, max: 1 },
      eyeLOpenRange: { min: 0, max: 1 },
      eyeROpenRange: { min: 0, max: 1 },
      allParameterIds: parameterIds
    };

    // Discover mouth parameter with fallbacks
    this.capabilities.mouthParameterId = this.findParameter(parameterIds, MOUTH_PARAM_VARIANTS);
    if (this.capabilities.mouthParameterId) {
      this.capabilities.hasMouthOpen = true;
      this.capabilities.mouthValueRange = this.getParameterRange(
        coreModel,
        this.capabilities.mouthParameterId
      );
      console.log(`[Live2D] Found mouth parameter: ${this.capabilities.mouthParameterId}`);
    } else {
      console.warn('[Live2D] No mouth parameter found, lip-sync disabled');
    }

    // Discover eye L open parameter
    this.capabilities.eyeLOpenParameterId = this.findParameter(parameterIds, EYE_L_OPEN_VARIANTS);
    if (this.capabilities.eyeLOpenParameterId) {
      this.capabilities.hasEyeLOpen = true;
      this.capabilities.eyeLOpenRange = this.getParameterRange(
        coreModel,
        this.capabilities.eyeLOpenParameterId
      );
    }

    // Discover eye R open parameter
    this.capabilities.eyeROpenParameterId = this.findParameter(parameterIds, EYE_R_OPEN_VARIANTS);
    if (this.capabilities.eyeROpenParameterId) {
      this.capabilities.hasEyeROpen = true;
      this.capabilities.eyeROpenRange = this.getParameterRange(
        coreModel,
        this.capabilities.eyeROpenParameterId
      );
    }

    // Discover eye blink parameter
    this.capabilities.eyeBlinkParameterId = this.findParameter(parameterIds, EYE_BLINK_VARIANTS);
    if (this.capabilities.eyeBlinkParameterId) {
      this.capabilities.hasEyeBlink = true;
    }

    // Discover body angle parameter
    this.capabilities.bodyAngleParameterId = this.findParameter(parameterIds, BODY_ANGLE_VARIANTS);
    if (this.capabilities.bodyAngleParameterId) {
      this.capabilities.hasBodyAngle = true;
    }

    // Discover breath parameter
    this.capabilities.breathParameterId = this.findParameter(parameterIds, BREATH_VARIANTS);
    if (this.capabilities.breathParameterId) {
      this.capabilities.hasBreath = true;
    }

    console.log('[Live2D] Model capabilities:', {
      mouth: this.capabilities.mouthParameterId,
      eyeL: this.capabilities.eyeLOpenParameterId,
      eyeR: this.capabilities.eyeROpenParameterId,
      blink: this.capabilities.eyeBlinkParameterId,
      breath: this.capabilities.breathParameterId
    });
  }

  /**
   * Find a parameter by checking multiple variant names
   */
  private findParameter(availableIds: string[], variants: string[]): string | null {
    // First try exact match
    for (const variant of variants) {
      if (availableIds.includes(variant)) {
        return variant;
      }
    }

    // Then try case-insensitive match
    const lowerIds = availableIds.map(id => ({ original: id, lower: id.toLowerCase() }));
    for (const variant of variants) {
      const lowerVariant = variant.toLowerCase();
      const found = lowerIds.find(id => id.lower === lowerVariant);
      if (found) {
        return found.original;
      }
    }

    // Try partial match (for custom models)
    for (const variant of variants) {
      const lowerVariant = variant.toLowerCase();
      for (const { original, lower } of lowerIds) {
        if (lower.includes(lowerVariant) || lowerVariant.includes(lower)) {
          return original;
        }
      }
    }

    return null;
  }

  /**
   * Get the core model from the Live2D model wrapper
   */
  private getCoreModel(): unknown {
    try {
      const m = this.model as { internalModel?: { coreModel?: unknown } };
      return m?.internalModel?.coreModel ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get all parameter IDs from the model
   */
  private getParameterIds(coreModel: unknown): string[] {
    try {
      const cm = coreModel as {
        getParameterIds?: () => string[];
        _parameterIds?: string[];
        getParameterCount?: () => number;
        getParameterId?: (index: number) => string;
      };

      // Try direct method
      if (cm.getParameterIds) {
        return cm.getParameterIds();
      }

      // Try private property
      if (cm._parameterIds) {
        return cm._parameterIds;
      }

      // Try index-based access
      if (cm.getParameterCount && cm.getParameterId) {
        const count = cm.getParameterCount();
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
          ids.push(cm.getParameterId(i));
        }
        return ids;
      }

      return [];
    } catch {
      return [];
    }
  }

  /**
   * Get parameter value range
   */
  private getParameterRange(
    coreModel: unknown,
    paramId: string
  ): { min: number; max: number } {
    try {
      const cm = coreModel as {
        getParameterMinimumValue?: (id: string) => number;
        getParameterMaximumValue?: (id: string) => number;
      };

      const min = cm.getParameterMinimumValue?.(paramId) ?? 0;
      const max = cm.getParameterMaximumValue?.(paramId) ?? 1;

      return { min, max };
    } catch {
      return { min: 0, max: 1 };
    }
  }

  /**
   * Set a parameter value safely
   */
  private setParameterValue(paramId: string, value: number): boolean {
    if (this.isDestroyed) return false;

    const coreModel = this.getCoreModel();
    if (!coreModel) return false;

    try {
      const cm = coreModel as {
        setParameterValueById?: (id: string, value: number) => void;
        setParameterValue?: (id: string, value: number) => void;
      };

      if (cm.setParameterValueById) {
        cm.setParameterValueById(paramId, value);
        return true;
      } else if (cm.setParameterValue) {
        cm.setParameterValue(paramId, value);
        return true;
      }

      return false;
    } catch (error) {
      console.warn(`[Live2D] Failed to set parameter ${paramId}:`, error);
      return false;
    }
  }

  /**
   * Set mouth open value (0.0 to 1.0 normalized)
   */
  setMouthOpen(normalizedValue: number): boolean {
    if (!this.capabilities?.hasMouthOpen || !this.capabilities.mouthParameterId) {
      return false;
    }

    // Clamp and map to model's range
    const clamped = Math.max(0, Math.min(1, normalizedValue));
    const { min, max } = this.capabilities.mouthValueRange;
    const actualValue = min + clamped * (max - min);

    return this.setParameterValue(this.capabilities.mouthParameterId, actualValue);
  }

  /**
   * Set left eye openness (0.0 = closed, 1.0 = open)
   */
  setEyeLOpen(normalizedValue: number): boolean {
    if (!this.capabilities?.hasEyeLOpen || !this.capabilities.eyeLOpenParameterId) {
      return false;
    }

    const clamped = Math.max(0, Math.min(1, normalizedValue));
    const { min, max } = this.capabilities.eyeLOpenRange;
    const actualValue = min + clamped * (max - min);

    return this.setParameterValue(this.capabilities.eyeLOpenParameterId, actualValue);
  }

  /**
   * Set right eye openness (0.0 = closed, 1.0 = open)
   */
  setEyeROpen(normalizedValue: number): boolean {
    if (!this.capabilities?.hasEyeROpen || !this.capabilities.eyeROpenParameterId) {
      return false;
    }

    const clamped = Math.max(0, Math.min(1, normalizedValue));
    const { min, max } = this.capabilities.eyeROpenRange;
    const actualValue = min + clamped * (max - min);

    return this.setParameterValue(this.capabilities.eyeROpenParameterId, actualValue);
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
      if (this.capabilities?.hasEyeBlink && this.capabilities.eyeBlinkParameterId) {
        this.setParameterValue(this.capabilities.eyeBlinkParameterId, 1.0);

        setTimeout(() => {
          if (!this.isDestroyed && this.capabilities?.eyeBlinkParameterId) {
            this.setParameterValue(this.capabilities.eyeBlinkParameterId, 0.0);
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
    this.stopBlinkAnimation();

    // Blink every 3-5 seconds randomly
    const scheduleNextBlink = () => {
      const delay = 3000 + Math.random() * 2000;
      this.blinkTimer = setTimeout(() => {
        if (!this.isDestroyed && Math.random() < 0.7) {
          // 70% chance to blink
          this.blink();
        }
        if (!this.isDestroyed) {
          scheduleNextBlink();
        }
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

  /**
   * Start breathing animation
   */
  startBreathAnimation(): void {
    if (!this.capabilities?.hasBreath || !this.capabilities.breathParameterId) {
      return;
    }

    this.stopBreathAnimation();
    this.breathPhase = 0;

    this.breathTimer = setInterval(() => {
      if (this.isDestroyed || !this.capabilities?.breathParameterId) {
        return;
      }

      // Sine wave breathing pattern
      this.breathPhase += 0.05;
      const breathValue = (Math.sin(this.breathPhase) + 1) / 2; // 0 to 1

      this.setParameterValue(this.capabilities.breathParameterId, breathValue);
    }, 50);
  }

  /**
   * Stop breathing animation
   */
  stopBreathAnimation(): void {
    if (this.breathTimer) {
      clearInterval(this.breathTimer);
      this.breathTimer = null;
    }
  }

  /**
   * Search for a parameter by partial name match
   */
  findParameterByPartialName(searchTerm: string): string | null {
    if (!this.capabilities?.allParameterIds) return null;

    const lowerSearch = searchTerm.toLowerCase();
    return (
      this.capabilities.allParameterIds.find(id => id.toLowerCase().includes(lowerSearch)) || null
    );
  }

  /**
   * Get a raw parameter value
   */
  getParameterValue(paramId: string): number | null {
    const coreModel = this.getCoreModel();
    if (!coreModel) return null;

    try {
      const cm = coreModel as {
        getParameterValueById?: (id: string) => number;
      };

      if (cm.getParameterValueById) {
        return cm.getParameterValueById(paramId);
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Mark model as destroyed (prevents further operations)
   */
  markDestroyed(): void {
    this.isDestroyed = true;
    this.stopBlinkAnimation();
    this.stopBreathAnimation();
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
   * Check if parameter discovery found the key parameters
   */
  isFullyConfigured(): boolean {
    return !!(
      this.capabilities?.hasMouthOpen &&
      (this.capabilities?.hasEyeBlink ||
        (this.capabilities?.hasEyeLOpen && this.capabilities?.hasEyeROpen))
    );
  }

  /**
   * Get discovered capabilities
   */
  getCapabilities(): ModelCapabilities | null {
    return this.capabilities;
  }

  /**
   * Check if destroyed
   */
  getIsDestroyed(): boolean {
    return this.isDestroyed;
  }
}
