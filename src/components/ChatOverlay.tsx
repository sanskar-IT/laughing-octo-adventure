import { useState, useCallback, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';

interface ChatOverlayProps {
  onSendMessage: (message: string) => void;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
}

export function ChatOverlay({ onSendMessage, connectionStatus }: ChatOverlayProps) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { messages, isLoading } = useStore();

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim() && !isLoading) {
      onSendMessage(inputValue.trim());
      setInputValue('');
    }
  }, [inputValue, isLoading, onSendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  }, [handleSubmit]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return '#4ade80';
      case 'connecting': return '#facc15';
      case 'disconnected': return '#f87171';
    }
  };

  return (
    <div className="chat-overlay">
      <div className="chat-header">
        <div className="status-indicator">
          <span 
            className="status-dot" 
            style={{ backgroundColor: getStatusColor() }}
          />
          <span className="status-text">
            {connectionStatus === 'connected' ? 'Online' : 
             connectionStatus === 'connecting' ? 'Connecting...' : 'Offline'}
          </span>
        </div>
      </div>

      <div className="chat-messages">
        {messages.map((message) => (
          <div 
            key={message.id}
            className={`message ${message.role}`}
          >
            <div className="message-content">
              {message.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="message assistant">
            <div className="message-content loading">
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-container" onSubmit={handleSubmit}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Speak to me..."
          disabled={isLoading}
          className="chat-input"
        />
        <button 
          type="submit" 
          disabled={!inputValue.trim() || isLoading}
          className="send-button"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" />
          </svg>
        </button>
      </form>
    </div>
  );
}

export default ChatOverlay;
