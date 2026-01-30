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
  const audioRef = useRef<HTMLAudioElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      initializeConversation();
      enhancedTTSService.initialize();
    }

    const checkConnection = async () => {
      setConnectionStatus('connecting');
      const status = await apiService.checkStatus();
      setConnectionStatus(status.status === 'online' ? 'connected' : 'disconnected');
    };

    checkConnection();
    const interval = setInterval(checkConnection, 10000);

    return () => clearInterval(interval);
  }, [initializeConversation, setConnectionStatus]);

  // Load selected character from localStorage on mount
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

  const handleSendMessage = useCallback(async (message: string) => {
    if (audioRef.current?.src) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

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
    } catch (error) {
      console.error(error);
      addMessage('assistant', 'Sorry, something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [addMessage, setLoading, setSpeaking, setViseme, currentCharacter]);

  return (
    <div className="app-container">
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
