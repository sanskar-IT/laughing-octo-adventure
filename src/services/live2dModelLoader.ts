/**
 * Live2D Model Loader with Defensive Patterns
 * Handles loading failures, retries, fallbacks, and provides user feedback
 */

import { Live2DModel } from 'pixi-live2d-display';
import * as PIXI from 'pixi.js';

export interface ModelLoadResult {
  success: boolean;
  model?: Live2DModel;
  error?: string;
  fallbackUsed?: boolean;
  stage?: string;
}

export class Live2DModelLoader {
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
        error: `Invalid model path: ${modelPath}. Expected format: /models/name/name.model3.json`,
        stage: 'validation_failed'
      };
    }
    
    onProgress?.('validating');
    
    // Stage 2: Pre-flight check
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
          onProgress?.(`retrying_in_${this.RETRY_DELAY * attempt}ms`);
          await this.delay(this.RETRY_DELAY * attempt);
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
        error: 'Primary model failed, using fallback',
        stage: 'fallback_success'
      };
    } catch (error) {
      return {
        success: false,
        error: `Both primary and fallback models failed: ${error}`,
        stage: 'fallback_failed'
      };
    }
  }
  
  private static isValidModelPath(path: string): boolean {
    return !!path && 
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
    return !!model && 
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
