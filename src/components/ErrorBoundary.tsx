import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
    isOllamaOffline: boolean;
}

/**
 * Global Error Boundary with Ollama offline detection.
 * 
 * Catches React render errors and provides:
 * - Graceful degradation UI
 * - Ollama offline detection with config guidance
 * - Error recovery option
 */
class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
            isOllamaOffline: false
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        // Check if error is related to Ollama connection
        const isOllamaOffline =
            error.message.includes('fetch') ||
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('Failed to fetch') ||
            error.message.includes('NetworkError') ||
            error.message.includes('ollama');

        return {
            hasError: true,
            error,
            isOllamaOffline
        };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('ErrorBoundary caught:', error, errorInfo);
        this.setState({ errorInfo });
    }

    handleRetry = () => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
            isOllamaOffline: false
        });
    };

    render() {
        if (this.state.hasError) {
            // Ollama Offline UI
            if (this.state.isOllamaOffline) {
                return (
                    <div className="error-boundary-container ollama-offline">
                        <div className="error-card">
                            <div className="error-icon">🔌</div>
                            <h2>Ollama is Offline</h2>
                            <p className="error-description">
                                The local AI model server (Ollama) is not running or unreachable.
                            </p>

                            <div className="config-section">
                                <h3>Quick Fix</h3>
                                <ol>
                                    <li>Open a terminal and run: <code>ollama serve</code></li>
                                    <li>Ensure Ollama is running on <code>http://localhost:11434</code></li>
                                    <li>Pull a model: <code>ollama pull llama3.2</code></li>
                                </ol>
                            </div>

                            <div className="config-section">
                                <h3>Alternative: Use LM Studio</h3>
                                <ol>
                                    <li>Download <a href="https://lmstudio.ai" target="_blank" rel="noopener noreferrer">LM Studio</a></li>
                                    <li>Start the local server on port 1234</li>
                                    <li>Update <code>ACTIVE_PROVIDER</code> in your <code>.env</code> file</li>
                                </ol>
                            </div>

                            <button className="retry-button" onClick={this.handleRetry}>
                                🔄 Retry Connection
                            </button>
                        </div>

                        <style>{`
              .error-boundary-container {
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                padding: 2rem;
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                color: #e0e0e0;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
              }
              
              .error-card {
                background: rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                padding: 2.5rem;
                max-width: 500px;
                width: 100%;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
              }
              
              .error-icon {
                font-size: 3rem;
                margin-bottom: 1rem;
              }
              
              .error-card h2 {
                color: #ff6b6b;
                margin-bottom: 0.5rem;
                font-size: 1.5rem;
              }
              
              .error-description {
                color: #a0a0a0;
                margin-bottom: 1.5rem;
              }
              
              .config-section {
                background: rgba(0, 0, 0, 0.2);
                border-radius: 8px;
                padding: 1rem;
                margin-bottom: 1rem;
              }
              
              .config-section h3 {
                font-size: 1rem;
                color: #4ecdc4;
                margin-bottom: 0.5rem;
              }
              
              .config-section ol {
                margin: 0;
                padding-left: 1.5rem;
              }
              
              .config-section li {
                margin-bottom: 0.5rem;
                color: #c0c0c0;
              }
              
              .config-section code {
                background: rgba(78, 205, 196, 0.2);
                padding: 0.2rem 0.5rem;
                border-radius: 4px;
                font-family: 'Fira Code', monospace;
                color: #4ecdc4;
              }
              
              .config-section a {
                color: #4ecdc4;
                text-decoration: none;
              }
              
              .config-section a:hover {
                text-decoration: underline;
              }
              
              .retry-button {
                width: 100%;
                padding: 1rem;
                background: linear-gradient(135deg, #4ecdc4 0%, #44a08d 100%);
                border: none;
                border-radius: 8px;
                color: white;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
              }
              
              .retry-button:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(78, 205, 196, 0.3);
              }
            `}</style>
                    </div>
                );
            }

            // Generic Error UI
            return (
                <div className="error-boundary-container generic-error">
                    <div className="error-card">
                        <div className="error-icon">⚠️</div>
                        <h2>Something went wrong</h2>
                        <p className="error-description">
                            {this.state.error?.message || 'An unexpected error occurred'}
                        </p>

                        {this.state.errorInfo && (
                            <details className="error-details">
                                <summary>Technical Details</summary>
                                <pre>{this.state.errorInfo.componentStack}</pre>
                            </details>
                        )}

                        <button className="retry-button" onClick={this.handleRetry}>
                            🔄 Try Again
                        </button>
                    </div>

                    <style>{`
            .error-boundary-container {
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              padding: 2rem;
              background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
              color: #e0e0e0;
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            }
            
            .error-card {
              background: rgba(255, 255, 255, 0.05);
              backdrop-filter: blur(10px);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 16px;
              padding: 2.5rem;
              max-width: 500px;
              width: 100%;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            }
            
            .error-icon {
              font-size: 3rem;
              margin-bottom: 1rem;
            }
            
            .error-card h2 {
              color: #ff6b6b;
              margin-bottom: 0.5rem;
            }
            
            .error-description {
              color: #a0a0a0;
              margin-bottom: 1.5rem;
            }
            
            .error-details {
              background: rgba(0, 0, 0, 0.3);
              border-radius: 8px;
              padding: 1rem;
              margin-bottom: 1rem;
            }
            
            .error-details summary {
              cursor: pointer;
              color: #888;
            }
            
            .error-details pre {
              font-size: 0.75rem;
              overflow: auto;
              max-height: 200px;
              color: #ff6b6b;
              margin-top: 0.5rem;
            }
            
            .retry-button {
              width: 100%;
              padding: 1rem;
              background: linear-gradient(135deg, #4ecdc4 0%, #44a08d 100%);
              border: none;
              border-radius: 8px;
              color: white;
              font-size: 1rem;
              font-weight: 600;
              cursor: pointer;
              transition: transform 0.2s, box-shadow 0.2s;
            }
            
            .retry-button:hover {
              transform: translateY(-2px);
              box-shadow: 0 4px 12px rgba(78, 205, 196, 0.3);
            }
          `}</style>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
