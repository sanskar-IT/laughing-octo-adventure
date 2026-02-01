"""
LiteLLM Service - Unified LLM Provider Gateway.
Handles both local (Ollama, LM Studio) and cloud (OpenAI, Anthropic) providers.
"""

import asyncio
import re
from typing import Any, AsyncGenerator

import httpx
from litellm import acompletion, completion

from backend_fastapi.core.config import get_settings
from backend_fastapi.core.security import sanitize_llm_output
from backend_fastapi.utils.logger import get_logger

logger = get_logger("litellm_service")
settings = get_settings()


class LiteLLMService:
    """
    Unified LLM provider gateway using LiteLLM.
    Supports streaming, health checks, and automatic fallback.
    """
    
    def __init__(self):
        self.active_model = settings.llm.active_provider
        self._http_client = httpx.AsyncClient(timeout=30.0)
    
    def _extract_provider_info(self, model: str) -> dict[str, Any]:
        """Extract provider information from model string."""
        parts = model.split("/")
        provider = parts[0] if len(parts) > 1 else "openai"
        model_name = parts[1] if len(parts) > 1 else model
        
        return {
            "provider": provider,
            "model_name": model_name,
            "is_local": provider in ("ollama", "lmstudio")
        }
    
    def _get_litellm_config(self, model: str) -> dict[str, Any]:
        """Get LiteLLM configuration for the given model."""
        info = self._extract_provider_info(model)
        
        if info["is_local"]:
            if info["provider"] == "ollama":
                return {
                    "api_base": settings.llm.ollama_base_url,
                    "api_key": "not-needed"
                }
            elif info["provider"] == "lmstudio":
                return {
                    "api_base": settings.llm.lm_studio_url + "/v1",
                    "api_key": "not-needed"
                }
        else:
            # Cloud providers use environment variables or config
            if info["provider"] == "openai":
                return {"api_key": settings.llm.openai_api_key}
            elif info["provider"] == "anthropic":
                return {"api_key": settings.llm.anthropic_api_key}
        
        return {}
    
    async def check_connection(self, model: str | None = None) -> dict[str, Any]:
        """
        Check provider connection status.
        
        Args:
            model: Model to check (uses active model if not specified)
            
        Returns:
            Connection status dictionary
        """
        model = model or self.active_model
        info = self._extract_provider_info(model)
        
        try:
            if info["is_local"]:
                if info["provider"] == "ollama":
                    response = await self._http_client.get(
                        f"{settings.llm.ollama_base_url}/api/tags"
                    )
                    return {
                        "connected": response.status_code == 200,
                        "provider": model,
                        "type": "local",
                        "details": {
                            "models": len(response.json().get("models", [])),
                            "base_url": settings.llm.ollama_base_url
                        }
                    }
                elif info["provider"] == "lmstudio":
                    response = await self._http_client.get(
                        f"{settings.llm.lm_studio_url}/v1/models"
                    )
                    return {
                        "connected": response.status_code == 200,
                        "provider": model,
                        "type": "local",
                        "details": {
                            "models": len(response.json().get("data", [])),
                            "base_url": settings.llm.lm_studio_url
                        }
                    }
            else:
                # Quick health check for cloud providers
                config = self._get_litellm_config(model)
                await acompletion(
                    model=model,
                    messages=[{"role": "user", "content": "test"}],
                    max_tokens=1,
                    **config
                )
                return {
                    "connected": True,
                    "provider": model,
                    "type": "cloud",
                    "details": {"provider": info["provider"]}
                }
        except Exception as e:
            logger.error(f"Connection check failed for {model}: {e}")
            return {
                "connected": False,
                "provider": model,
                "type": "local" if info["is_local"] else "cloud",
                "error": str(e)
            }
    
    async def generate_stream(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        system_prompt: str | None = None,
        sanitize_output: bool = True
    ) -> AsyncGenerator[dict[str, Any], None]:
        """
        Generate streaming response from LLM.
        
        Args:
            messages: List of chat messages
            model: Model to use (uses active model if not specified)
            system_prompt: Optional system prompt to prepend
            sanitize_output: Whether to sanitize output (default True)
            
        Yields:
            Stream chunks with content, done, or error events
        """
        model = model or self.active_model
        config = self._get_litellm_config(model)
        
        # Prepend system prompt if provided
        if system_prompt:
            messages = [{"role": "system", "content": system_prompt}] + messages
        
        try:
            logger.info(f"Starting stream with model: {model}")
            
            stream = await acompletion(
                model=model,
                messages=messages,
                stream=True,
                timeout=settings.llm.timeout / 1000,  # Convert to seconds
                max_tokens=settings.llm.max_tokens,
                temperature=settings.llm.temperature,
                **config
            )
            
            full_response = ""
            chunk_count = 0
            
            async for chunk in stream:
                chunk_count += 1
                content = chunk.choices[0].delta.content if chunk.choices else None
                
                if content:
                    if sanitize_output:
                        content = sanitize_llm_output(content)
                    full_response += content
                    
                    yield {
                        "type": "content",
                        "content": content,
                        "provider": model,
                        "chunk_index": chunk_count
                    }
                
                if chunk.choices and chunk.choices[0].finish_reason:
                    yield {
                        "type": "done",
                        "provider": model,
                        "full_content": full_response,
                        "chunk_count": chunk_count,
                        "usage": getattr(chunk, "usage", None)
                    }
                    break
                    
        except Exception as e:
            logger.error(f"Stream error for {model}: {e}")
            yield {
                "type": "error",
                "provider": model,
                "error": str(e)
            }
    
    async def generate_stream_with_sentence_chunking(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        system_prompt: str | None = None,
        on_sentence: callable = None
    ) -> AsyncGenerator[dict[str, Any], None]:
        """
        Generate streaming response with sentence-level chunking for TTS.
        Triggers callback when a complete sentence/clause is detected.
        
        Args:
            messages: List of chat messages
            model: Model to use
            system_prompt: Optional system prompt
            on_sentence: Async callback for completed sentences
            
        Yields:
            Stream chunks with sentence_complete events
        """
        model = model or self.active_model
        
        # Sentence-ending patterns
        sentence_pattern = re.compile(r'[.!?;:,](?:\s|$)')
        
        sentence_buffer = ""
        
        async for chunk in self.generate_stream(messages, model, system_prompt):
            if chunk["type"] == "content":
                sentence_buffer += chunk["content"]
                
                # Check for sentence boundaries
                match = sentence_pattern.search(sentence_buffer)
                if match:
                    # Extract completed sentence
                    end_pos = match.end()
                    completed_sentence = sentence_buffer[:end_pos].strip()
                    sentence_buffer = sentence_buffer[end_pos:]
                    
                    if completed_sentence:
                        # Trigger TTS for this sentence
                        if on_sentence:
                            asyncio.create_task(on_sentence(completed_sentence))
                        
                        yield {
                            **chunk,
                            "sentence_complete": True,
                            "sentence": completed_sentence
                        }
                        continue
                
                yield chunk
            
            elif chunk["type"] == "done":
                # Flush remaining buffer
                if sentence_buffer.strip():
                    if on_sentence:
                        asyncio.create_task(on_sentence(sentence_buffer.strip()))
                    
                    yield {
                        "type": "content",
                        "content": "",
                        "sentence_complete": True,
                        "sentence": sentence_buffer.strip(),
                        "provider": model
                    }
                
                yield chunk
            
            else:
                yield chunk
    
    async def get_available_models(self) -> list[dict[str, Any]]:
        """Get list of available models from all configured providers."""
        models = []
        
        # Check Ollama
        try:
            response = await self._http_client.get(
                f"{settings.llm.ollama_base_url}/api/tags"
            )
            if response.status_code == 200:
                for model in response.json().get("models", []):
                    models.append({
                        "name": f"ollama/{model['name']}",
                        "provider": "ollama",
                        "size": model.get("size"),
                        "type": "local"
                    })
        except Exception as e:
            logger.debug(f"Ollama not available: {e}")
        
        # Check LM Studio
        try:
            response = await self._http_client.get(
                f"{settings.llm.lm_studio_url}/v1/models"
            )
            if response.status_code == 200:
                for model in response.json().get("data", []):
                    models.append({
                        "name": f"lmstudio/{model['id']}",
                        "provider": "lmstudio",
                        "type": "local"
                    })
        except Exception as e:
            logger.debug(f"LM Studio not available: {e}")
        
        # Add cloud models if API keys are configured
        if settings.llm.openai_api_key:
            models.extend([
                {"name": "openai/gpt-4o", "provider": "openai", "type": "cloud"},
                {"name": "openai/gpt-4o-mini", "provider": "openai", "type": "cloud"},
            ])
        
        if settings.llm.anthropic_api_key:
            models.extend([
                {"name": "anthropic/claude-3-5-sonnet-20241022", "provider": "anthropic", "type": "cloud"},
                {"name": "anthropic/claude-3-5-haiku-20241022", "provider": "anthropic", "type": "cloud"},
            ])
        
        return models
    
    def switch_model(self, new_model: str) -> bool:
        """Switch to a different model."""
        info = self._extract_provider_info(new_model)
        if info["provider"] in ("ollama", "lmstudio", "openai", "anthropic"):
            self.active_model = new_model
            logger.info(f"Switched to model: {new_model}")
            return True
        return False
    
    async def close(self):
        """Close HTTP client."""
        await self._http_client.aclose()


# Singleton instance
_litellm_service: LiteLLMService | None = None


def get_litellm_service() -> LiteLLMService:
    """Get or create LiteLLM service instance."""
    global _litellm_service
    if _litellm_service is None:
        _litellm_service = LiteLLMService()
    return _litellm_service
