import axios from 'axios';

const API_BASE = '/api';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  success: boolean;
  message?: string;
  error?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  latency?: number;
}

class APIService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE;
  }

  async checkStatus(): Promise<{ status: string; connection: any }> {
    try {
      const response = await axios.get(`${this.baseUrl}/status`);
      return response.data;
    } catch (error) {
      return {
        status: 'offline',
        connection: { connected: false, error: 'Cannot reach backend' }
      };
    }
  }

  async sendChat(messages: ChatMessage[], characterCard?: any): Promise<ChatResponse> {
    try {
      const response = await axios.post(`${this.baseUrl}/chat`, {
        messages,
        character_card: characterCard,
        systemPrompt: characterCard?.parsed?.systemPrompt || "You are a friendly AI companion. Be caring, helpful, and engaging."
      });
      return response.data;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        return {
          success: false,
          error: error.response?.data?.error || error.message
        };
      }
      return { success: false, error: 'Unknown error' };
    }
  }

  async streamChat(
    messages: ChatMessage[], 
    characterCard?: any,
    onChunk?: (chunk: string) => void,
    onComplete?: () => void,
    onError?: (error: string) => void
  ): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages,
          character_card: characterCard
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          
          const eventMatch = line.match(/^event: (.+)$/m);
          const dataMatch = line.match(/^data: (.+)$/m);
          
          if (eventMatch && dataMatch) {
            const eventType = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);
            
            switch (eventType) {
              case 'content':
                if (onChunk && data.content) {
                  onChunk(data.content);
                }
                break;
              case 'done':
                if (onComplete) {
                  onComplete();
                }
                return;
              case 'error':
                if (onError) {
                  onError(data.error || 'Unknown error');
                }
                return;
            }
          }
        }
      }

      if (onComplete) {
        onComplete();
      }
    } catch (error: any) {
      if (onError) {
        onError(error.message || 'Stream error');
      }
      throw error;
    }
  }
}

export const apiService = new APIService();
export default apiService;
