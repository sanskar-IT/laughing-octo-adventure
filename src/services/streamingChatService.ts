

export interface StreamingCallbacks {
  onMessage?: (content: string) => void;
  onError?: (error: any) => void;
  onDone?: (data: any) => void;
  onProviderChange?: (info: any) => void;
  onProviderConnected?: (info: any) => void;
}

export interface StreamingMessage {
  content: string;
  provider: string;
  model: string;
  timestamp: number;
  chunk_index?: number;
}

export interface StreamingError {
  provider: string;
  error: string;
  timestamp: number;
  fatal?: boolean;
}

export interface StreamingDone {
  provider: string;
  model: string;
  usage?: any;
  full_content: string;
  chunk_count: number;
  latency?: number;
  character?: string;
  conversation_id?: string;
  timestamp: string;
}

export interface ProviderInfo {
  provider: string;
  model: string;
  status: string;
  character?: string;
  timestamp: string;
}

/**
 * Streaming Chat Service for real-time LLM responses
 * Handles Server-Sent Events (SSE) and manages connection lifecycle
 */
export class StreamingChatService {
  private eventSource: EventSource | null = null;
  private callbacks: StreamingCallbacks = {};
  private isStreaming = false;

  constructor(private endpoint: string = '/api/chat/stream') {
    this.callbacks = {};
  }

  /**
   * Start streaming chat with SSE
   * @param {string} message - User message
   * @param {Object} characterCard - Character card data
   * @param {string} model - Model to use
   * @param {StreamingCallbacks} callbacks - Event callbacks
   */
  async streamChat(
    message: string,
    characterCard?: any,
    model?: string,
    callbacks: StreamingCallbacks = {}
  ): Promise<void> {
    if (this.isStreaming) {
      console.warn('[StreamingChatService] Already streaming, stopping previous connection');
      this.stopStream();
    }

    this.callbacks = callbacks;
    this.isStreaming = true;

    try {
      console.log(`[StreamingChatService] Starting stream with model: ${model}`);
      
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: message }],
          character_card: characterCard,
          model: model || 'ollama/llama3.2'
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
            
            this.handleSSEEvent(eventType, data);
          }
        }
      }
    } catch (error) {
      console.error('[StreamingChatService] Stream error:', error);
      if (this.callbacks.onError) {
        this.callbacks.onError({ 
          error: (error as Error).message, 
          fatal: true 
        });
      }
    } finally {
      this.isStreaming = false;
    }
  }

  /**
   * Handle SSE events
   */
  private handleSSEEvent(eventType: string, data: any): void {
    try {
      switch (eventType) {
        case 'content':
          if (this.callbacks.onMessage) {
            this.callbacks.onMessage(data.content);
          }
          break;

        case 'provider_switch':
          console.log('[StreamingChatService] Provider switched:', data);
          if (this.callbacks.onProviderChange) {
            this.callbacks.onProviderChange(data);
          }
          break;

        case 'provider_connected':
          console.log('[StreamingChatService] Provider connected:', data);
          if (this.callbacks.onProviderConnected) {
            this.callbacks.onProviderConnected(data);
          }
          break;

        case 'error':
          console.error('[StreamingChatService] Stream error:', data);
          if (this.callbacks.onError) {
            if (data.status === 'offline' && data.provider === 'local') {
              // Special handling for local provider offline
              this.callbacks.onError({
                ...data,
                isLocalOffline: true,
                requiresUserAction: true
              });
            } else {
              this.callbacks.onError(data);
            }
          }
          break;

        case 'fatal_error':
          console.error('[StreamingChatService] Fatal error:', data);
          if (this.callbacks.onError) {
            this.callbacks.onError({
              ...data,
              fatal: true
            });
          }
          break;

        case 'done':
          console.log('[StreamingChatService] Stream completed:', data);
          if (this.callbacks.onDone) {
            this.callbacks.onDone(data);
          }
          break;

        default:
          console.log('[StreamingChatService] Unknown SSE event:', eventType, data);
          break;
      }
    } catch (error) {
      console.error('[StreamingChatService] Error handling SSE event:', error);
    }
  }

  /**
   * Stop active streaming connection
   */
  stopStream(): void {
    console.log('[StreamingChatService] Stopping stream');
    
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    
    this.isStreaming = false;
  }

  /**
   * Check if currently streaming
   * @returns {boolean} Streaming status
   */
  isActive(): boolean {
    return this.isStreaming;
  }

  /**
   * Get current streaming status
   * @returns {Object} Current status
   */
  getStatus(): {
    isStreaming: boolean;
    endpoint: string;
  } {
    return {
      isStreaming: this.isStreaming,
      endpoint: this.endpoint
    };
  }

  /**
   * Update callbacks
   * @param {StreamingCallbacks} newCallbacks - New callbacks
   */
  updateCallbacks(newCallbacks: StreamingCallbacks): void {
    this.callbacks = { ...this.callbacks, ...newCallbacks };
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stopStream();
    this.callbacks = {};
  }
}

export default StreamingChatService;
