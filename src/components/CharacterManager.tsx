import { useState, useCallback, useEffect } from 'react';
import { useStore } from '../store/useStore';
import './CharacterManager.css';

interface Character {
  id: string;
  name: string;
  description: string;
  personality: string;
  live2dModelId: string | null;
  live2dModelPath: string | null;
  createdAt: string;
}

interface Model {
  id: string;
  name: string;
  path: string;
  capabilities: any;
}

export function CharacterManager() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'characters' | 'models'>('characters');
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string>('');

  // Load characters and models
  const loadData = useCallback(async () => {
    try {
      // Get auth token from localStorage or prompt
      const token = localStorage.getItem('auth_token') || authToken;
      
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const [charRes, modelRes] = await Promise.all([
        fetch('/api/characters/characters', { headers }),
        fetch('/api/models/models', { headers })
      ]);

      if (charRes.ok) {
        const charData = await charRes.json();
        if (charData.success) {
          setCharacters(charData.data);
        }
      }

      if (modelRes.ok) {
        const modelData = await modelRes.json();
        if (modelData.success) {
          setModels(modelData.data);
        }
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Failed to load characters and models');
    }
  }, [authToken]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  // Handle character card upload
  const handleCharacterUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('character', file);

    // If a Live2D model is selected, associate it
    if (selectedCharacter?.live2dModelId) {
      formData.append('live2dModelId', selectedCharacter.live2dModelId);
    }

    try {
      setUploadProgress(0);
      setError(null);

      const token = localStorage.getItem('auth_token') || authToken;
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/characters/upload', {
        method: 'POST',
        headers,
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          await loadData();
          setUploadProgress(100);
          setTimeout(() => setUploadProgress(0), 2000);
        } else {
          setError(data.error || 'Upload failed');
        }
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Upload failed');
      }
    } catch (err) {
      setError('Network error during upload');
    }
  };

  // Handle Live2D model upload
  const handleModelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('model', file);

    try {
      setUploadProgress(0);
      setError(null);

      const token = localStorage.getItem('auth_token') || authToken;
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/models/upload', {
        method: 'POST',
        headers,
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          await loadData();
          setUploadProgress(100);
          setTimeout(() => setUploadProgress(0), 2000);
        } else {
          setError(data.error || 'Upload failed');
        }
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Upload failed');
      }
    } catch (err) {
      setError('Network error during upload');
    }
  };

  // Associate character with Live2D model
  const associateModel = async (characterId: string, modelId: string, modelPath: string) => {
    try {
      const token = localStorage.getItem('auth_token') || authToken;
      const headers: HeadersInit = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`/api/characters/characters/${characterId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          live2dModelId: modelId,
          live2dModelPath: modelPath
        })
      });

      if (response.ok) {
        await loadData();
      } else {
        setError('Failed to associate model');
      }
    } catch (err) {
      setError('Network error');
    }
  };

  // Delete character
  const deleteCharacter = async (characterId: string) => {
    if (!confirm('Are you sure you want to delete this character?')) return;

    try {
      const token = localStorage.getItem('auth_token') || authToken;
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`/api/characters/characters/${characterId}`, {
        method: 'DELETE',
        headers
      });

      if (response.ok) {
        await loadData();
      } else {
        setError('Failed to delete character');
      }
    } catch (err) {
      setError('Network error');
    }
  };

  // Delete model
  const deleteModel = async (modelId: string) => {
    if (!confirm('Are you sure you want to delete this model?')) return;

    try {
      const token = localStorage.getItem('auth_token') || authToken;
      const headers: HeadersInit = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`/api/models/models/${modelId}`, {
        method: 'DELETE',
        headers
      });

      if (response.ok) {
        await loadData();
      } else {
        setError('Failed to delete model');
      }
    } catch (err) {
      setError('Network error');
    }
  };

  if (!isOpen) {
    return (
      <button 
        className="character-manager-toggle"
        onClick={() => setIsOpen(true)}
        title="Manage Characters & Models"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="character-manager-overlay">
      <div className="character-manager-modal">
        <div className="character-manager-header">
          <h2>Character & Model Manager</h2>
          <button className="close-btn" onClick={() => setIsOpen(false)}>×</button>
        </div>

        {error && (
          <div className="error-message">
            {error}
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {/* Auth Token Input */}
        <div className="auth-section">
          <input
            type="password"
            placeholder="Enter auth token (if required)"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            className="auth-input"
          />
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button 
            className={activeTab === 'characters' ? 'active' : ''}
            onClick={() => setActiveTab('characters')}
          >
            Characters ({characters.length})
          </button>
          <button 
            className={activeTab === 'models' ? 'active' : ''}
            onClick={() => setActiveTab('models')}
          >
            Live2D Models ({models.length})
          </button>
        </div>

        {/* Upload Progress */}
        {uploadProgress > 0 && (
          <div className="upload-progress">
            <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}

        {/* Characters Tab */}
        {activeTab === 'characters' && (
          <div className="tab-content">
            <div className="upload-section">
              <label className="upload-btn">
                <input
                  type="file"
                  accept=".json,.png"
                  onChange={handleCharacterUpload}
                  style={{ display: 'none' }}
                />
                Upload Character Card (JSON or PNG)
              </label>
            </div>

            <div className="items-list">
              {characters.map((character) => (
                <div key={character.id} className="item-card">
                  <div className="item-info">
                    <h3>{character.name}</h3>
                    <p className="description">{character.description}</p>
                    <p className="personality">
                      <strong>Personality:</strong> {character.personality}
                    </p>
                    {character.live2dModelId && (
                      <p className="associated-model">
                        <strong>Live2D Model:</strong> Associated
                      </p>
                    )}
                  </div>
                  <div className="item-actions">
                    <select
                      value={character.live2dModelId || ''}
                      onChange={(e) => {
                        const model = models.find(m => m.id === e.target.value);
                        if (model) {
                          associateModel(character.id, model.id, model.path);
                        }
                      }}
                      className="model-select"
                    >
                      <option value="">Associate Live2D Model...</option>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </select>
                    <button 
                      className="delete-btn"
                      onClick={() => deleteCharacter(character.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {characters.length === 0 && (
                <p className="empty-state">No characters uploaded yet.</p>
              )}
            </div>
          </div>
        )}

        {/* Models Tab */}
        {activeTab === 'models' && (
          <div className="tab-content">
            <div className="upload-section">
              <label className="upload-btn">
                <input
                  type="file"
                  accept=".zip"
                  onChange={handleModelUpload}
                  style={{ display: 'none' }}
                />
                Upload Live2D Model (ZIP)
              </label>
            </div>

            <div className="items-list">
              {models.map((model) => (
                <div key={model.id} className="item-card">
                  <div className="item-info">
                    <h3>{model.name}</h3>
                    <p className="path">{model.path}</p>
                    {model.capabilities && (
                      <div className="capabilities">
                        {model.capabilities.hasLipSync && (
                          <span className="capability">Lip Sync</span>
                        )}
                        {model.capabilities.hasEyeBlink && (
                          <span className="capability">Eye Blink</span>
                        )}
                        {model.capabilities.hasExpressions && (
                          <span className="capability">Expressions</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="item-actions">
                    <button 
                      className="delete-btn"
                      onClick={() => deleteModel(model.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {models.length === 0 && (
                <p className="empty-state">No Live2D models uploaded yet.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CharacterManager;
