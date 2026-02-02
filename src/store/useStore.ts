import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface AppState {
  messages: Message[];
  isLoading: boolean;
  isSpeaking: boolean;
  currentViseme: number;
  live2dState: 'idle' | 'talking' | 'listening' | 'thinking';
  currentConversationId: string | null;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';

  addMessage: (role: 'user' | 'assistant', content: string) => void;
  setLoading: (loading: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
  setViseme: (viseme: number) => void;
  setLive2dState: (state: 'idle' | 'talking' | 'listening' | 'thinking') => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'connecting') => void;
  setConversationId: (id: string | null) => void;
  clearMessages: () => void;
  initializeConversation: () => void;
}

export const useStore = create<AppState>((set) => ({
  messages: [],
  isLoading: false,
  isSpeaking: false,
  currentViseme: 0,
  live2dState: 'idle',
  currentConversationId: null,
  connectionStatus: 'disconnected',

  addMessage: (role, content) => {
    const newMessage: Message = {
      id: uuidv4(),
      role,
      content,
      timestamp: Date.now()
    };
    set((state) => ({
      messages: [...state.messages, newMessage]
    }));
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setSpeaking: (speaking) => set({ isSpeaking: speaking }),
  setViseme: (viseme) => set({ currentViseme: viseme }),
  setLive2dState: (state) => set({ live2dState: state }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setConversationId: (id) => set({ currentConversationId: id }),

  clearMessages: () => set({ messages: [] }),

  initializeConversation: () => {
    const newId = uuidv4();
    set({ currentConversationId: newId, messages: [] });
  }
}));

export const selectMessages = (state: AppState) => state.messages;
export const selectIsLoading = (state: AppState) => state.isLoading;
export const selectIsSpeaking = (state: AppState) => state.isSpeaking;
export const selectCurrentViseme = (state: AppState) => state.currentViseme;
export const selectLive2dState = (state: AppState) => state.live2dState;
