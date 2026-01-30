import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display';
import { useStore } from '../store/useStore';
import AudioReactiveLipSyncFixed from '../services/audioReactiveLipSyncFixed';

// Expose PIXI to window for the plugin
(window as any).PIXI = PIXI;

interface EnhancedLive2DComponentProps {
  modelPath: string; // e.g., "/models/furina/furina.model3.json"
  audioElement?: HTMLAudioElement;
}

export function EnhancedLive2DCanvas({ modelPath, audioElement }: EnhancedLive2DComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [app, setApp] = useState<PIXI.Application | null>(null);
  const [model, setModel] = useState<Live2DModel | null>(null);
  const [audioSync, setAudioSync] = useState<AudioReactiveLipSyncFixed | null>(null);

  const {
    messages,
    isLoading
  } = useStore();

  // Initialize PIXI App
  useEffect(() => {
    if (!canvasRef.current) return;

    const pixiApp = new PIXI.Application({
      view: canvasRef.current,
      autoStart: true,
      resizeTo: canvasRef.current.parentElement as HTMLElement,
      backgroundAlpha: 0,
    });

    setApp(pixiApp);

    return () => {
      if (pixiApp) {
        pixiApp.destroy(true, { children: true });
      }
    };
  }, []);

  // Load Model
  useEffect(() => {
    if (!app || !modelPath) return;

    let mounted = true;

    const load = async () => {
      try {
        console.log('Loading Live2D model from:', modelPath);
        const cleanPath = modelPath.replace('./', '/');

        const loadedModel = await Live2DModel.from(cleanPath);

        if (!mounted) return;

        // Auto fitting
        const scale = Math.min(
          app!.view.width / loadedModel.width,
          app!.view.height / loadedModel.height
        ) * 0.8;

        loadedModel.scale.set(scale);
        loadedModel.anchor.set(0.5, 0.5);
        loadedModel.position.set(
          app!.view.width / 2, 
          app!.view.height / 2 + (loadedModel.height * scale * 0.1)
        );

        // Enhanced interactions
        loadedModel.on('hit', (hitAreas: any) => {
          console.log('[Live2D] Hit area:', hitAreas);
          if (hitAreas.includes('Body')) {
            loadedModel.motion('TapBody');
            loadedModel.expression('smile');
          }
          if (hitAreas.includes('Head') || hitAreas.includes('Face')) {
            loadedModel.motion('TapHead');
            loadedModel.expression('surprised');
          }
          if (hitAreas.includes('EyeR')) {
            loadedModel.motion('WinkRight');
          }
          if (hitAreas.includes('EyeL')) {
            loadedModel.motion('WinkLeft');
          }
        });

        // Motion groups based on chat state
        loadedModel.on('click', () => {
          if (isLoading) {
            loadedModel.motion('Thinking');
          } else {
            loadedModel.motion('Idle');
          }
        });

        app!.stage.addChild(loadedModel);
        setModel(loadedModel);
        console.log('[Live2D] Model loaded successfully');

      } catch (error) {
        console.error('[Live2D] Failed to load Live2D model:', error);
      }
    };

    load();

    return () => {
      mounted = false;
      if (model) {
        try {
          app!.stage.removeChild(model);
          model.destroy();
        } catch (error) {
          console.warn('[Live2D] Error unloading model:', error);
        }
      }
    };
  }, [app, modelPath]);

  // Initialize Audio-Reactive Lip Sync when model and audio are ready
  useEffect(() => {
    if (model && audioElement) {
      const syncService = new AudioReactiveLipSyncFixed();
      
      syncService.initialize(audioElement, model).then(() => {
        console.log('[Live2D] Audio sync initialized');
        setAudioSync(syncService);
        
        // Start real-time sync
        syncService.startRealTimeSync();
        
        // Adjust settings for real-time audio
        syncService.adjustSensitivity(0.015);
        syncService.adjustSmoothing(0.3);
        syncService.adjustThresholds({
          min: 5,
          max: 100,
          eyeBlink: 25
        });
      }).catch((error) => {
        console.error('[Live2D] Failed to initialize audio sync:', error);
      });
    }

    return () => {
      if (audioSync) {
        audioSync.stopRealTimeSync();
        audioSync.cleanup();
        setAudioSync(null);
      }
    };
  }, [model, audioElement]);

  // Update model based on chat state
  useEffect(() => {
    if (!model) return;

    // Enhanced reactions based on conversation state
    const lastMessage = messages[messages.length - 1];
    if (lastMessage) {
      if (lastMessage.role === 'user') {
        // Show thinking/processing state
        setTimeout(() => {
          if (isLoading) {
            model.motion('Thinking');
            model.expression('thinking');
          }
        }, 100);
      } else if (lastMessage.role === 'assistant') {
        // Return to normal after response
        setTimeout(() => {
          model.motion('Idle');
          model.expression('neutral');
        }, 500);
      }
    }

    // Blinking animation for realism
    if (model) {
      const blinkInterval = setInterval(() => {
        if (Math.random() < 0.02) { // 2% chance to blink
          try {
            model.internalModel.coreModel.setParameterValueById('ParamEyeLOpen', 0.2);
            model.internalModel.coreModel.setParameterValueById('ParamEyeROpen', 0.2);
            
            setTimeout(() => {
              model.internalModel.coreModel.setParameterValueById('ParamEyeLOpen', 1.0);
              model.internalModel.coreModel.setParameterValueById('ParamEyeROpen', 1.0);
            }, 150); // Close after 150ms
          } catch (error) {
            console.warn('[Live2D] Blink animation failed:', error);
          }
        }
      }, 3000 + Math.random() * 1000); // Every 3-4 seconds with variation

      return () => clearInterval(blinkInterval);
    }
  }, [messages, isLoading, model]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioSync) {
        audioSync.stopRealTimeSync();
        audioSync.cleanup();
      }
    };
  }, [audioSync]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
      }}
    />
  );
}

export default EnhancedLive2DCanvas;