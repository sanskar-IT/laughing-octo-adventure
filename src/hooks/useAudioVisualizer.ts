/**
 * useAudioVisualizer Hook
 * 
 * Implements WebAudio AnalyserNode to calculate real-time volume (RMS)
 * and maps it to Live2D ParamMouthOpenY using linear interpolation for smooth lip-sync.
 */

import { useRef, useCallback, useEffect, useState } from 'react';

interface AudioVisualizerState {
    isPlaying: boolean;
    volume: number;
    mouthOpenY: number;
}

interface AudioVisualizerOptions {
    fftSize?: number;
    smoothingTimeConstant?: number;
    minVolume?: number;
    maxVolume?: number;
    lerpFactor?: number;
}

interface AudioVisualizerReturn {
    state: AudioVisualizerState;
    analyzeAudioElement: (audioElement: HTMLAudioElement) => void;
    analyzeAudioBuffer: (audioBuffer: ArrayBuffer) => Promise<void>;
    analyzeStream: (stream: MediaStream) => void;
    stop: () => void;
    getMouthOpenY: () => number;
}

const DEFAULT_OPTIONS: Required<AudioVisualizerOptions> = {
    fftSize: 256,
    smoothingTimeConstant: 0.8,
    minVolume: 0.01,
    maxVolume: 0.5,
    lerpFactor: 0.3, // Linear interpolation factor for smoothing
};

/**
 * Linear interpolation function for smooth transitions
 */
function lerp(current: number, target: number, factor: number): number {
    return current + (target - current) * factor;
}

/**
 * Calculate RMS (Root Mean Square) from audio data
 */
function calculateRMS(dataArray: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        // Convert from 0-255 to -1 to 1 range
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
    }
    return Math.sqrt(sum / dataArray.length);
}

/**
 * Map volume to mouth open value (0-1) with non-linear response
 */
function volumeToMouthOpen(
    volume: number,
    minVolume: number,
    maxVolume: number
): number {
    // Clamp and normalize
    const normalized = Math.max(0, Math.min(1, (volume - minVolume) / (maxVolume - minVolume)));

    // Apply slight curve for more natural look
    // Using ease-out curve: 1 - (1 - x)^2
    return 1 - Math.pow(1 - normalized, 2);
}

export function useAudioVisualizer(
    options: AudioVisualizerOptions = {}
): AudioVisualizerReturn {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | MediaElementAudioSourceNode | AudioBufferSourceNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataArrayRef = useRef<any>(null);
    const currentMouthOpenRef = useRef<number>(0);


    const [state, setState] = useState<AudioVisualizerState>({
        isPlaying: false,
        volume: 0,
        mouthOpenY: 0,
    });

    /**
     * Initialize or get AudioContext and AnalyserNode
     */
    const getAudioContext = useCallback(() => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }

        if (!analyserRef.current) {
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = opts.fftSize;
            analyserRef.current.smoothingTimeConstant = opts.smoothingTimeConstant;
            dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
        }

        return {
            context: audioContextRef.current,
            analyser: analyserRef.current,
        };
    }, [opts.fftSize, opts.smoothingTimeConstant]);

    /**
     * Animation loop for continuous volume analysis
     */
    const startAnalysis = useCallback(() => {
        const analyser = analyserRef.current;
        const dataArray = dataArrayRef.current;

        if (!analyser || !dataArray) return;

        const analyze = () => {
            // Use type assertion to fix ArrayBuffer vs ArrayBufferLike compatibility
            analyser.getByteTimeDomainData(dataArray as Uint8Array);

            // Calculate RMS volume
            const rms = calculateRMS(dataArray as Uint8Array);


            // Map to mouth open value
            const targetMouthOpen = volumeToMouthOpen(rms, opts.minVolume, opts.maxVolume);

            // Apply linear interpolation for smooth transitions
            currentMouthOpenRef.current = lerp(
                currentMouthOpenRef.current,
                targetMouthOpen,
                opts.lerpFactor
            );

            setState(prev => ({
                ...prev,
                volume: rms,
                mouthOpenY: currentMouthOpenRef.current,
            }));

            animationFrameRef.current = requestAnimationFrame(analyze);
        };

        analyze();
    }, [opts.minVolume, opts.maxVolume, opts.lerpFactor]);

    /**
     * Stop analysis and cleanup
     */
    const stop = useCallback(() => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        if (sourceRef.current) {
            try {
                sourceRef.current.disconnect();
            } catch (e) {
                // Ignore disconnect errors
            }
            sourceRef.current = null;
        }

        // Smoothly close mouth
        const closeMouth = () => {
            currentMouthOpenRef.current = lerp(currentMouthOpenRef.current, 0, 0.1);

            setState(prev => ({
                ...prev,
                isPlaying: false,
                mouthOpenY: currentMouthOpenRef.current,
            }));

            if (currentMouthOpenRef.current > 0.01) {
                requestAnimationFrame(closeMouth);
            } else {
                currentMouthOpenRef.current = 0;
                setState(prev => ({ ...prev, volume: 0, mouthOpenY: 0 }));
            }
        };

        closeMouth();
    }, []);

    /**
     * Analyze audio from an HTMLAudioElement
     */
    const analyzeAudioElement = useCallback((audioElement: HTMLAudioElement) => {
        const { context, analyser } = getAudioContext();

        // Resume context if suspended (browser autoplay policy)
        if (context.state === 'suspended') {
            context.resume();
        }

        // Create source from audio element
        try {
            const source = context.createMediaElementSource(audioElement);
            source.connect(analyser);
            analyser.connect(context.destination);
            sourceRef.current = source;
        } catch (e) {
            // Element may already be connected
            console.warn('Audio element already connected:', e);
        }

        setState(prev => ({ ...prev, isPlaying: true }));
        startAnalysis();

        // Stop when audio ends
        audioElement.addEventListener('ended', stop, { once: true });
        audioElement.addEventListener('pause', stop, { once: true });
    }, [getAudioContext, startAnalysis, stop]);

    /**
     * Analyze audio from an ArrayBuffer
     */
    const analyzeAudioBuffer = useCallback(async (audioBuffer: ArrayBuffer) => {
        const { context, analyser } = getAudioContext();

        if (context.state === 'suspended') {
            await context.resume();
        }

        // Decode audio data
        const decodedAudio = await context.decodeAudioData(audioBuffer.slice(0));

        // Create buffer source
        const source = context.createBufferSource();
        source.buffer = decodedAudio;
        source.connect(analyser);
        analyser.connect(context.destination);
        sourceRef.current = source;

        // Start playback and analysis
        source.start();
        setState(prev => ({ ...prev, isPlaying: true }));
        startAnalysis();

        // Stop when audio ends
        source.onended = stop;
    }, [getAudioContext, startAnalysis, stop]);

    /**
     * Analyze audio from a MediaStream
     */
    const analyzeStream = useCallback((stream: MediaStream) => {
        const { context, analyser } = getAudioContext();

        if (context.state === 'suspended') {
            context.resume();
        }

        // Create source from stream
        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        // Note: Don't connect to destination to avoid feedback
        sourceRef.current = source;

        setState(prev => ({ ...prev, isPlaying: true }));
        startAnalysis();
    }, [getAudioContext, startAnalysis]);

    /**
     * Get current mouth open value for Live2D
     */
    const getMouthOpenY = useCallback(() => {
        return currentMouthOpenRef.current;
    }, []);

    /**
     * Cleanup on unmount
     */
    useEffect(() => {
        return () => {
            stop();

            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
        };
    }, [stop]);

    return {
        state,
        analyzeAudioElement,
        analyzeAudioBuffer,
        analyzeStream,
        stop,
        getMouthOpenY,
    };
}

export default useAudioVisualizer;
