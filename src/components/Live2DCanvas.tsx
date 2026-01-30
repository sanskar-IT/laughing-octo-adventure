import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display';
import { useStore } from '../store/useStore';

// Expose PIXI to window for the plugin (sometimes required)
(window as any).PIXI = PIXI;

interface Live2DComponentProps {
  modelPath: string; // e.g., "/models/furina/furina.model3.json"
}

export function Live2DCanvas({ modelPath }: Live2DComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [app, setApp] = useState<PIXI.Application | null>(null);
  const [model, setModel] = useState<Live2DModel | null>(null);

  const {
    isSpeaking,
    currentViseme,
    setLive2dState
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
      pixiApp.destroy(true, { children: true });
    };
  }, []);

  // Load Model
  useEffect(() => {
    if (!app || !modelPath) return;

    let mounted = true;

    async function load() {
      try {
        console.log('Loading Live2D model from:', modelPath);
        // Ensure path is correct relative to public
        // If modelPath is "./models/...", and we served public, use "/models/..."
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
        loadedModel.position.set(app!.view.width / 2, app!.view.height / 2 + (loadedModel.height * scale * 0.1));

        // Interactions
        loadedModel.on('hit', (hitAreas) => {
          if (hitAreas.includes('Body')) {
            loadedModel.motion('TapBody');
            loadedModel.expression('smile');
          }
        });

        app!.stage.addChild(loadedModel);
        setModel(loadedModel);
        console.log('Model loaded successfully');

      } catch (error) {
        console.error('Failed to load Live2D model:', error);
      }
    }

    load();

    return () => {
      mounted = false;
      if (model) {
        app.stage.removeChild(model);
        model.destroy();
      }
    };
  }, [app, modelPath]);

  // Handle LipSync (Visemes)
  useEffect(() => {
    if (!model) return;

    // Mapping viseme (0-20 approx) to Live2D Parameters
    // Standard param: ParamMouthOpenY
    // Viseme 0 = closed, High = open.

    // Simple mapping: if speaking, open mouth based on viseme value
    // Viseme map used in backend: 0 (silence) to 16 (h).
    // Normalize 0-16 to 0-1 range for ParamMouthOpenY

    if (isSpeaking) {
      const value = Math.min(currentViseme / 10, 1.0); // Rough scaling

      // This needs to be applied every frame, or updating core param
      // pixi-live2d-display handles internal updates, but we can override parameters.
      // However, it's best done in a ticker/update loop.
      // For simplicity here, we just set it directly, but it might be overwritten by motion.

      // Better approach: use internal motion manager or directly set parameter
      try {
        const coreModel = model.internalModel.coreModel;
        // setParameterValueById is standard Cubism SDK
        // model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', value);
        // pixi-live2d-display wrapper:
        // model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', value);

        // Actually, for continuous update, we should hook into the ticker.
        // But React useEffect updates on `currentViseme` change.
        // currentViseme changes rapidly (from TTS service).

        // We need to ensure we can set the parameter.
        // Note: 'ParamMouthOpenY' is standard. Some models use different IDs.

        // Pixi-live2d-display exposes parameters via valid accessors usually?
        // model.internalModel.coreModel is the raw pointer.

        // A safer ID-agnostic way often used:
        model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', value);
      } catch (e) {
        // Ignore if model not ready or param missing
      }
    } else {
      // Close mouth
      if (model && model.internalModel && model.internalModel.coreModel) {
        try {
          model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 0);
        } catch (e) { }
      }
    }

  }, [currentViseme, isSpeaking, model]);

  // Resize handler
  useEffect(() => {
    if (!app || !model) return;
    const resize = () => {
      if (!canvasRef.current) return;
      // App resizeTo handles canvas size
      // We need to re-center model
      const scale = Math.min(
        app.renderer.width / model.width,
        app.renderer.height / model.height
      ) * 0.8;
      model.scale.set(scale);
      model.position.set(app.renderer.width / 2, app.renderer.height / 2 + (model.height * scale * 0.1));
    };

    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [app, model]);

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

export default Live2DCanvas;
