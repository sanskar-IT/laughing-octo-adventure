import { create } from 'zustand'

type Message = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

type TtsState = {
  visemes: Array<{ time: number; value: number; duration: number }>
  audioBase64?: string
}

type AppState = {
  messages: Message[]
  status: 'idle' | 'connecting' | 'streaming' | 'error'
  systemPrompt: string
  setSystemPrompt: (prompt: string) => void
  addMessage: (msg: Message) => void
  setMessages: (msgs: Message[]) => void
  setStatus: (status: AppState['status']) => void
  tts: TtsState
  setTts: (tts: TtsState) => void
}

export const useAppStore = create<AppState>((set) => ({
  messages: [],
  status: 'idle',
  systemPrompt: '',
  tts: { visemes: [] },
  setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  setMessages: (msgs) => set({ messages: msgs }),
  setStatus: (status) => set({ status }),
  setTts: (tts) => set({ tts })
}))
