"""
Configuration module using Pydantic Settings.
Loads from .env and config.json with proper validation and no hardcoded secrets.
"""

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class LLMSettings(BaseSettings):
    """LLM Provider Configuration"""
    active_provider: str = Field(default="ollama/llama3.2", description="Active LLM provider")
    openai_api_key: Optional[str] = Field(default=None, description="OpenAI API Key")
    anthropic_api_key: Optional[str] = Field(default=None, description="Anthropic API Key")
    ollama_base_url: str = Field(default="http://localhost:11434", description="Ollama base URL")
    lm_studio_url: str = Field(default="http://localhost:1234", description="LM Studio URL")
    max_tokens: int = Field(default=2048, ge=1, le=32768)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    timeout: int = Field(default=30000, ge=1000, le=300000)
    
    model_config = SettingsConfigDict(
        env_prefix="",
        extra="ignore"
    )


class TTSSettings(BaseSettings):
    """TTS Server Configuration"""
    host: str = Field(default="localhost")
    port: int = Field(default=8000, ge=1, le=65535)
    voice_id: str = Field(default="en-US-AriaNeural")
    sample_rate: int = Field(default=44100)
    
    model_config = SettingsConfigDict(
        env_prefix="TTS_",
        extra="ignore"
    )


class Live2DSettings(BaseSettings):
    """Live2D Configuration"""
    model_path: str = Field(default="./models/")
    default_model: str = Field(default="furina")
    scale: float = Field(default=1.0, ge=0.1, le=5.0)
    lip_sync_enabled: bool = Field(default=True)


class MemorySettings(BaseSettings):
    """Memory/Database Configuration"""
    type: str = Field(default="sqlite")
    max_context_window: int = Field(default=4096, ge=512, le=128000)
    retrieval_limit: int = Field(default=5, ge=1, le=50)
    importance_threshold: float = Field(default=0.5, ge=0.0, le=1.0)


class SecuritySettings(BaseSettings):
    """Security Configuration"""
    jwt_secret: str = Field(default="", description="JWT Secret - must be set in production")
    allowed_origins: list[str] = Field(
        default=["http://localhost:5173", "http://127.0.0.1:5173"]
    )
    enforce_localhost: bool = Field(default=True)
    block_telemetry: bool = Field(default=True)
    rate_limit_requests: int = Field(default=100, ge=1, le=10000)
    rate_limit_window: int = Field(default=60, ge=1, le=3600)
    
    model_config = SettingsConfigDict(
        env_prefix="",
        extra="ignore"
    )
    
    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_origins(cls, v):
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v
    
    @field_validator("jwt_secret", mode="after")
    @classmethod
    def validate_jwt_secret(cls, v):
        if not v or v == "your_secure_64_char_hex_string_here":
            import secrets
            return secrets.token_hex(32)
        return v


class AppSettings(BaseSettings):
    """Application Configuration"""
    name: str = Field(default="AI Companion")
    version: str = Field(default="2.0.0")
    port: int = Field(default=3000, ge=1, le=65535)
    environment: str = Field(default="development")
    debug: bool = Field(default=False)
    log_level: str = Field(default="INFO")
    
    model_config = SettingsConfigDict(
        env_prefix="APP_",
        extra="ignore"
    )


class Settings(BaseSettings):
    """Main application settings combining all sub-settings"""
    
    app: AppSettings = Field(default_factory=AppSettings)
    llm: LLMSettings = Field(default_factory=LLMSettings)
    tts: TTSSettings = Field(default_factory=TTSSettings)
    live2d: Live2DSettings = Field(default_factory=Live2DSettings)
    memory: MemorySettings = Field(default_factory=MemorySettings)
    security: SecuritySettings = Field(default_factory=SecuritySettings)
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False
    )
    
    @classmethod
    def load_from_config_json(cls, config_path: Path | None = None) -> "Settings":
        """Load settings from config.json and merge with environment variables"""
        if config_path is None:
            config_path = Path(__file__).parent.parent.parent / "config.json"
        
        config_data = {}
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                config_data = json.load(f)
        
        # Build settings from config.json
        app_config = config_data.get("app", {})
        llm_config = config_data.get("lmStudio", {})
        tts_config = config_data.get("tts", {})
        live2d_config = config_data.get("live2d", {})
        memory_config = config_data.get("memory", {})
        privacy_config = config_data.get("privacy", {})
        
        return cls(
            app=AppSettings(
                name=app_config.get("name", "AI Companion"),
                version=app_config.get("version", "2.0.0"),
                port=app_config.get("port", 3000),
                environment=app_config.get("environment", "development"),
                log_level=privacy_config.get("logLevel", "INFO").upper()
            ),
            llm=LLMSettings(
                active_provider=os.getenv("ACTIVE_PROVIDER", "ollama/llama3.2"),
                max_tokens=llm_config.get("maxTokens", 2048),
                temperature=llm_config.get("temperature", 0.7),
                timeout=llm_config.get("timeout", 30000),
                openai_api_key=os.getenv("OPENAI_API_KEY"),
                anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
                ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
                lm_studio_url=os.getenv("LM_STUDIO_URL", "http://localhost:1234")
            ),
            tts=TTSSettings(
                host=tts_config.get("host", "localhost"),
                port=tts_config.get("port", 8000),
                voice_id=tts_config.get("voiceId", "en-US-AriaNeural"),
                sample_rate=tts_config.get("sampleRate", 44100)
            ),
            live2d=Live2DSettings(
                model_path=live2d_config.get("modelPath", "./models/"),
                default_model=live2d_config.get("defaultModel", "furina"),
                scale=live2d_config.get("scale", 1.0),
                lip_sync_enabled=live2d_config.get("lipSyncEnabled", True)
            ),
            memory=MemorySettings(
                type=memory_config.get("type", "sqlite"),
                max_context_window=memory_config.get("maxContextWindow", 4096),
                retrieval_limit=memory_config.get("retrievalLimit", 5),
                importance_threshold=memory_config.get("importanceThreshold", 0.5)
            ),
            security=SecuritySettings(
                jwt_secret=os.getenv("JWT_SECRET", ""),
                allowed_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
                enforce_localhost=privacy_config.get("enforceLocalhost", True),
                block_telemetry=privacy_config.get("blockTelemetry", True)
            )
        )


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings.load_from_config_json()


# Export settings instance
settings = get_settings()
