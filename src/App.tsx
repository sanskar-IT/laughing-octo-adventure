import { useEffect, useCallback, useRef, useState } from 'react';
import { useStore } from './store/useStore';
import { ChatOverlay } from './components/ChatOverlay';
import { EnhancedLive2DCanvas } from './components/EnhancedLive2DCanvas';
import { CharacterManager } from './components/CharacterManager';
import { apiService } from './services/api';
import EnhancedTTSService from './services/enhancedTts';

const enhancedTTSService = new EnhancedTTSService();

interface VisemeData {
  value: number;
}

function App() {
  const {
    addMessage,
    setLoading,
    setSpeaking,
    setViseme,
    setConnectionStatus,
    initializeConversation
  } = useStore();

  const [currentModelPath, setCurrentModelPath] = useState<string>('./models/furina/furina.model3.json');
  const [currentCharacter, setCurrentCharacter] = useState<any>(null);
  const [audioInitialized, setAudioInitialized] = useState(false);
  const [showStartPrompt, setShowStartPrompt] = useState(true);

  const audioRef = useRef<HTMLAudioElement>(null);
  const isFirstRender = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize audio on user interaction (required by browser autoplay policies)
  const handleUserInteraction = useCallback(async () => {
    if (audioInitialized) return;

    try {
      // Create and resume AudioContext on user interaction
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContext();

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Initialize TTS service
      await enhancedTTSService.initialize();

      setAudioInitialized(true);
      setShowStartPrompt(false);
      console.log('[App] Audio system initialized via user interaction');
    } catch (error) {
      console.error('[App] Audio initialization failed:', error);
    }
  }, [audioInitialized]);

  // Start button handler
  const handleStart = useCallback(() => {
    handleUserInteraction();
  }, [handleUserInteraction]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      initializeConversation();
    }

    const checkConnection = async () => {
      setConnectionStatus('connecting');
      try {
        const status = await apiService.checkStatus();
        setConnectionStatus(status.status === 'online' ? 'connected' : 'disconnected');
      } catch (error) {
        setConnectionStatus('disconnected');
      }
    };

    checkConnection();
    const interval = setInterval(checkConnection, 10000);

    // Cleanup function - abort pending requests and clear resources
    return () => {
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      enhancedTTSService.stop();
    };
  }, [initializeConversation, setConnectionStatus]);

  useEffect(() => {
    const savedCharacter = localStorage.getItem('selected_character');
    if (savedCharacter) {
      try {
        const character = JSON.parse(savedCharacter);
        setCurrentCharacter(character);
        if (character.live2dModelPath) {
          setCurrentModelPath(character.live2dModelPath);
        }
      } catch (e) {
        console.error('Error loading saved character:', e);
      }
    }
  }, []);

  // Cleanup when switching characters
  useEffect(() => {
    return () => {
      // Revoke any object URLs when component unmounts or character changes
      if (audioRef.current?.src?.startsWith('blob:')) {
        URL.revokeObjectURL(audioRef.current.src);
      }
    };
  }, [currentModelPath]);

  const handleSendMessage = useCallback(async (message: string) => {
    // Initialize audio on first message if not done
    if (!audioInitialized) {
      await handleUserInteraction();
    }

    if (audioRef.current?.src) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    // Cancel any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    addMessage('user', message);
    setLoading(true);

    try {
      const response = await apiService.sendChat([
        { role: 'user', content: message }
      ], currentCharacter);

      if (response.success && response.message) {
        addMessage('assistant', response.message);

        setSpeaking(true);

        await enhancedTTSService.speak(response.message, (viseme: VisemeData) => {
          setViseme(viseme.value || 0);
        });

        setSpeaking(false);
        setViseme(0);
      } else {
        addMessage('assistant', `Error: ${response.error || 'Unknown error occurred'}`);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error(error);
        addMessage('assistant', 'Sorry, something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [addMessage, setLoading, setSpeaking, setViseme, currentCharacter, audioInitialized, handleUserInteraction]);

  return (
    <div className="app-container" onClick={handleUserInteraction}>
      {/* Start prompt overlay - required for browser autoplay policies */}
      {showStartPrompt && (
        <div className="start-prompt-overlay">
          <div className="start-prompt-card">
            <h2>🎭 AI Companion</h2>
            <p>Click to enable audio and start chatting</p>
            <button className="start-button" onClick={handleStart}>
              ▶ Start
            </button>
          </div>
          <style>{`
            .start-prompt-overlay {
              position: fixed;
              inset: 0;
              background: rgba(0, 0, 0, 0.8);
              display: flex;
              justify-content: center;
              align-items: center;
              z-index: 1000;
              backdrop-filter: blur(8px);
            }
            .start-prompt-card {
              background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
              padding: 3rem;
              border-radius: 24px;
              text-align: center;
              border: 1px solid rgba(255, 255, 255, 0.1);
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            }
            .start-prompt-card h2 {
              font-size: 2rem;
              margin-bottom: 1rem;
              color: #fff;
            }
            .start-prompt-card p {
              color: #a0a0a0;
              margin-bottom: 2rem;
            }
            .start-button {
              padding: 1rem 3rem;
              font-size: 1.2rem;
              background: linear-gradient(135deg, #4ecdc4 0%, #44a08d 100%);
              border: none;
              border-radius: 12px;
              color: white;
              cursor: pointer;
              font-weight: 600;
              transition: transform 0.2s, box-shadow 0.2s;
            }
            .start-button:hover {
              transform: scale(1.05);
              box-shadow: 0 4px 20px rgba(78, 205, 196, 0.4);
            }
          `}</style>
        </div>
      )}

      <div className="live2d-container">
        <div className="character-stage">
          <EnhancedLive2DCanvas
            modelPath={currentModelPath}
            audioElement={audioRef.current || undefined}
          />
        </div>
      </div>

      <ChatOverlay
        onSendMessage={handleSendMessage}
        connectionStatus={useStore.getState().connectionStatus}
      />

      <audio
        ref={audioRef}
        style={{ display: 'none' }}
        preload="auto"
      />

      <CharacterManager />
    </div>
  );
}

export default App;
