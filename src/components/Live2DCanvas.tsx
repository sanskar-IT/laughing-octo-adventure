import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { useStore } from '../store/useStore';
import { Live2DModelLoader } from '../services/live2dModelLoader';
import { Live2DParameterManager } from '../services/live2dParameterManager';
import { ResourceGuard } from '../services/resourceGuard';
import './Live2DCanvas.css';

(window as any).PIXI = PIXI;

interface Live2DComponentProps {
  modelPath: string;
}

export function Live2DCanvas({ modelPath }: Live2DComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [app, setApp] = useState<PIXI.Application | null>(null);
  const [model, setModel] = useState<any>(null);
  const [parameterManager, setParameterManager] = useState<Live2DParameterManager | null>(null);
  const resourceGuard = useRef(new ResourceGuard()).current;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStage, setLoadStage] = useState<string>('idle');
  const [fallbackUsed, setFallbackUsed] = useState(false);

  const {
    isSpeaking,
    currentViseme
  } = useStore();

  // Initialize PIXI Application
  useEffect(() => {
    if (!canvasRef.current) return;

    try {
      const pixiApp = new PIXI.Application({
        view: canvasRef.current,
        autoStart: true,
        resizeTo: canvasRef.current.parentElement as HTMLElement,
        backgroundAlpha: 0,
      });

      setApp(pixiApp);
      setLoadStage('app_initialized');

      return () => {
        try {
          pixiApp.destroy(true, { children: true });
        } catch (error) {
          console.warn('[Live2D] Error destroying PIXI app:', error);
        }
      };
    } catch (error) {
      console.error('[Live2D] Failed to initialize PIXI:', error);
      setLoadError('Failed to initialize graphics engine');
      setLoadStage('app_init_failed');
    }
  }, []);

  // Load Live2D Model with defensive patterns
  useEffect(() => {
    if (!app || !modelPath) return;

    let mounted = true;
    setLoadError(null);
    setLoadStage('starting');
    setFallbackUsed(false);

    const load = async () => {
      try {
        console.log('[Live2D] Starting model load:', modelPath);
        
        const result = await Live2DModelLoader.loadWithRetry(
          modelPath, 
          app,
          (stage) => {
            if (mounted) {
              setLoadStage(stage);
              console.log('[Live2D] Loading stage:', stage);
            }
          }
        );

        if (!mounted) return;

        if (result.success && result.model) {
          const loadedModel = result.model;
          
          // Calculate scale safely
          let scale = 0.5; // Default fallback
          if (loadedModel.width > 0 && loadedModel.height > 0) {
            scale = Math.min(
              app.view.width / loadedModel.width,
              app.view.height / loadedModel.height
            ) * 0.8;
          }

          loadedModel.scale.set(scale);
          loadedModel.anchor.set(0.5, 0.5);
          loadedModel.position.set(
            app.view.width / 2, 
            app.view.height / 2 + (loadedModel.height * scale * 0.1)
          );

          // Setup interactions
          loadedModel.on('hit', (hitAreas: any) => {
            if (hitAreas.includes('Body')) {
              loadedModel.motion('TapBody');
              loadedModel.expression('smile');
            }
          });

          app.stage.addChild(loadedModel);
          setModel(loadedModel);
          
          // Initialize parameter manager for safe lip-sync
          const paramManager = new Live2DParameterManager(loadedModel);
          setParameterManager(paramManager);
          
          // Track resources
          resourceGuard.trackEventListener(loadedModel, 'hit', (hitAreas: any) => {
            if (hitAreas.includes('Body')) {
              loadedModel.motion('TapBody');
              loadedModel.expression('smile');
            }
          });
          
          setFallbackUsed(result.fallbackUsed || false);
          setLoadStage('complete');
          
          if (result.fallbackUsed) {
            console.warn('[Live2D] Using fallback model');
          } else {
            console.log('[Live2D] Model loaded successfully');
          }
        } else {
          setLoadError(result.error || 'Unknown loading error');
          setLoadStage('failed');
        }
      } catch (error) {
        console.error('[Live2D] Unexpected error during load:', error);
        if (mounted) {
          setLoadError('Unexpected error loading character');
          setLoadStage('error');
        }
      }
    };

    load();

    return () => {
      mounted = false;
      
      // Cleanup parameter manager
      if (parameterManager) {
        parameterManager.markDestroyed();
      }
      
      // Cleanup all tracked resources
      resourceGuard.cleanup();
      
      if (model) {
        try {
          app.stage.removeChild(model);
          model.destroy();
        } catch (error) {
          console.warn('[Live2D] Error cleaning up model:', error);
        }
      }
    };
  }, [app, modelPath, parameterManager, resourceGuard]);

  // Handle lip-sync with parameter manager
  useEffect(() => {
    if (!parameterManager) return;

    if (isSpeaking) {
      const value = Math.min(currentViseme / 10, 1.0);
      const success = parameterManager.setMouthOpen(value);
      
      if (!success && currentViseme > 0) {
        // Model doesn't support mouth animation - log once
        console.log('[Live2D] Model does not support mouth animation');
      }
    } else {
      // Close mouth when not speaking
      parameterManager.setMouthOpen(0);
    }
  }, [currentViseme, isSpeaking, parameterManager]);

  // Handle resize
  useEffect(() => {
    if (!app || !model) return;
    
    const resize = () => {
      if (!canvasRef.current || model.width <= 0 || model.height <= 0) return;
      
      try {
        const scale = Math.min(
          app.renderer.width / model.width,
          app.renderer.height / model.height
        ) * 0.8;
        
        model.scale.set(scale);
        model.position.set(
          app.renderer.width / 2, 
          app.renderer.height / 2 + (model.height * scale * 0.1)
        );
      } catch (error) {
        console.warn('[Live2D] Resize error:', error);
      }
    };

    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [app, model]);

  // Render error state
  if (loadError) {
    return (
      <div className="live2d-error-container">
        <div className="live2d-error-content">
          <h3>Character Loading Failed</h3>
          <p className="error-message">{loadError}</p>
          <p className="error-stage">Stage: {loadStage}</p>
          <button 
            className="retry-button"
            onClick={() => window.location.reload()}
          >
            🔄 Retry Loading
          </button>
          <p className="error-hint">
            If the problem persists, check that the model files exist at:<br/>
            <code>{modelPath}</code>
          </p>
        </div>
      </div>
    );
  }

  // Render loading state
  if (!model) {
    return (
      <div className="live2d-loading-container">
        <div className="live2d-loading-content">
          <div className="spinner"></div>
          <p className="loading-text">Loading Character...</p>
          <p className="loading-stage">{getStageDisplayText(loadStage)}</p>
          {loadStage.includes('retry') && (
            <p className="loading-retry">Retrying...</p>
          )}
        </div>
      </div>
    );
  }

  // Render success state (with fallback warning if needed)
  return (
    <div className="live2d-container">
      {fallbackUsed && (
        <div className="fallback-warning">
          ⚠️ Using placeholder character
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="live2d-canvas"
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
}

// Helper function to get user-friendly stage text
function getStageDisplayText(stage: string): string {
  const stageMap: Record<string, string> = {
    'idle': 'Initializing...',
    'starting': 'Preparing...',
    'validating': 'Validating path...',
    'loading_attempt_1': 'Loading model (1/3)...',
    'loading_attempt_2': 'Loading model (2/3)...',
    'loading_attempt_3': 'Loading model (3/3)...',
    'retrying_in_1000ms': 'Retrying...',
    'retrying_in_2000ms': 'Retrying...',
    'retrying_in_3000ms': 'Retrying...',
    'loading_fallback': 'Loading fallback model...',
    'success': 'Finalizing...',
    'complete': 'Ready!',
    'failed': 'Failed to load',
    'error': 'Error occurred'
  };
  
  return stageMap[stage] || stage;
}

export default Live2DCanvas;
