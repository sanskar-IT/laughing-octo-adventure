"""
TTS Bridge Client - Async Implementation
Async client for connecting to the FastAPI TTS server
"""

import asyncio
import aiohttp
import json
import logging
from typing import Callable, Optional, AsyncGenerator, Any
from dataclasses import dataclass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class VisemeData:
    """Viseme data for lip-sync"""
    time: float
    value: int
    duration: float


@dataclass
class TTSResult:
    """Result from TTS generation"""
    audio_data: Optional[bytes]
    visemes: list[VisemeData]
    success: bool
    error: Optional[str] = None


class AsyncTTSClient:
    """
    Async client for TTS server.
    Supports streaming audio and real-time viseme updates.
    """
    
    def __init__(self, host: str = "localhost", port: int = 8000):
        self.base_url = f"http://{host}:{port}"
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        """Async context manager entry"""
        await self.connect()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        await self.close()
    
    async def connect(self):
        """Initialize HTTP session"""
        if not self.session:
            self.session = aiohttp.ClientSession()
            logger.info(f"Connected to TTS server at {self.base_url}")
    
    async def close(self):
        """Close HTTP session"""
        if self.session:
            await self.session.close()
            self.session = None
            logger.info("Disconnected from TTS server")
    
    async def health_check(self) -> bool:
        """Check if TTS server is healthy"""
        if not self.session:
            await self.connect()
        
        try:
            async with self.session.get(f"{self.base_url}/health") as response:
                if response.status == 200:
                    data = await response.json()
                    return data.get("status") == "healthy"
                return False
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return False
    
    async def generate_visemes(self, text: str) -> list[VisemeData]:
        """
        Generate only viseme data (no audio).
        Fast operation for lip-sync preview.
        """
        if not self.session:
            await self.connect()
        
        try:
            async with self.session.post(
                f"{self.base_url}/generate-visemes",
                json={"text": text}
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    visemes = [
                        VisemeData(
                            time=v["time"],
                            value=v["value"],
                            duration=v["duration"]
                        )
                        for v in data.get("visemes", [])
                    ]
                    return visemes
                else:
                    logger.error(f"Viseme generation failed: {response.status}")
                    return []
        except Exception as e:
            logger.error(f"Viseme generation error: {e}")
            return []
    
    async def generate_tts(
        self, 
        text: str, 
        stream: bool = True,
        voice: str = "en-US-AriaNeural"
    ) -> TTSResult:
        """
        Generate TTS with optional streaming.
        
        Args:
            text: Text to synthesize
            stream: If True, returns audio_data=None (use stream_audio() instead)
                   If False, returns complete audio in memory
            voice: Voice ID to use
        
        Returns:
            TTSResult with audio and visemes
        """
        if not self.session:
            await self.connect()
        
        try:
            if stream:
                # For streaming, we get visemes first, then stream audio separately
                visemes = await self.generate_visemes(text)
                return TTSResult(
                    audio_data=None,  # Use stream_audio() for streaming
                    visemes=visemes,
                    success=True
                )
            else:
                # Non-streaming: get complete audio
                async with self.session.post(
                    f"{self.base_url}/generate",
                    json={
                        "text": text,
                        "stream": False,
                        "voice": voice
                    }
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        audio_bytes = None
                        if data.get("audio"):
                            import base64
                            audio_bytes = base64.b64decode(data["audio"])
                        
                        visemes = [
                            VisemeData(
                                time=v["time"],
                                value=v["value"],
                                duration=v["duration"]
                            )
                            for v in data.get("visemes", [])
                        ]
                        
                        return TTSResult(
                            audio_data=audio_bytes,
                            visemes=visemes,
                            success=True
                        )
                    else:
                        error_text = await response.text()
                        return TTSResult(
                            audio_data=None,
                            visemes=[],
                            success=False,
                            error=f"HTTP {response.status}: {error_text}"
                        )
        
        except Exception as e:
            logger.error(f"TTS generation error: {e}")
            return TTSResult(
                audio_data=None,
                visemes=[],
                success=False,
                error=str(e)
            )
    
    async def stream_audio(
        self, 
        text: str,
        voice: str = "en-US-AriaNeural",
        on_chunk: Optional[Callable[[bytes], None]] = None
    ) -> AsyncGenerator[bytes, None]:
        """
        Stream audio chunks in real-time.
        
        Args:
            text: Text to synthesize
            voice: Voice ID
            on_chunk: Optional callback for each chunk
        
        Yields:
            Audio data chunks as bytes
        
        Example:
            async for chunk in client.stream_audio("Hello"):
                # Play chunk immediately
                play_audio(chunk)
        """
        if not self.session:
            await self.connect()
        
        try:
            async with self.session.post(
                f"{self.base_url}/generate",
                json={
                    "text": text,
                    "stream": True,
                    "voice": voice
                }
            ) as response:
                if response.status == 200:
                    chunk_count = 0
                    async for chunk in response.content.iter_chunked(4096):
                        chunk_count += 1
                        if on_chunk:
                            on_chunk(chunk)
                        yield chunk
                    
                    logger.info(f"Streamed {chunk_count} audio chunks")
                else:
                    error_text = await response.text()
                    logger.error(f"Streaming failed: {response.status} - {error_text}")
        
        except Exception as e:
            logger.error(f"Audio streaming error: {e}")
            raise
    
    async def stream_audio_with_visemes(
        self,
        text: str,
        voice: str = "en-US-AriaNeural",
        on_viseme: Optional[Callable[[int], None]] = None
    ) -> AsyncGenerator[tuple[bytes, int], None]:
        """
        Stream audio with integrated viseme indices.
        
        Each yield returns: (audio_chunk, viseme_index)
        
        Args:
            text: Text to synthesize
            voice: Voice ID
            on_viseme: Optional callback when viseme changes
        
        Yields:
            Tuples of (audio_data, viseme_index)
        """
        if not self.session:
            await self.connect()
        
        try:
            async with self.session.post(
                f"{self.base_url}/generate-stream",
                json={
                    "text": text,
                    "stream": True,
                    "voice": voice
                }
            ) as response:
                if response.status == 200:
                    async for raw_chunk in response.content.iter_chunked(4096):
                        # Parse format: [4 bytes viseme index][audio data]
                        if len(raw_chunk) < 4:
                            continue
                        
                        viseme_idx = int.from_bytes(raw_chunk[:4], byteorder='little')
                        audio_data = raw_chunk[4:]
                        
                        if on_viseme:
                            on_viseme(viseme_idx)
                        
                        yield (audio_data, viseme_idx)
                else:
                    error_text = await response.text()
                    logger.error(f"Viseme streaming failed: {response.status}")
        
        except Exception as e:
            logger.error(f"Viseme streaming error: {e}")
            raise


async def test_async_client():
    """Test the async TTS client"""
    print("🧪 Testing Async TTS Client")
    print("-" * 60)
    
    async with AsyncTTSClient() as client:
        # Test 1: Health check
        print("\n1. Health Check:")
        healthy = await client.health_check()
        print(f"   Server healthy: {healthy}")
        
        # Test 2: Generate visemes
        print("\n2. Generate Visemes:")
        text = "Hello, I am your AI companion!"
        visemes = await client.generate_visemes(text)
        print(f"   Text: '{text}'")
        print(f"   Generated {len(visemes)} visemes")
        print(f"   First 3: {visemes[:3]}")
        
        # Test 3: Non-streaming TTS
        print("\n3. Non-streaming TTS:")
        result = await client.generate_tts(text, stream=False)
        if result.success:
            print(f"   Success! Audio: {len(result.audio_data)} bytes")
            print(f"   Visemes: {len(result.visemes)}")
        else:
            print(f"   Failed: {result.error}")
        
        # Test 4: Streaming audio
        print("\n4. Streaming Audio:")
        chunk_count = 0
        total_bytes = 0
        start_time = asyncio.get_event_loop().time()
        
        async for chunk in client.stream_audio("This is a streaming test."):
            chunk_count += 1
            total_bytes += len(chunk)
        
        elapsed = asyncio.get_event_loop().time() - start_time
        print(f"   Streamed {chunk_count} chunks ({total_bytes} bytes)")
        print(f"   Time: {elapsed:.2f}s")
        
        # Test 5: Concurrent requests
        print("\n5. Concurrent Requests (3 simultaneous):")
        texts = [
            "First concurrent message",
            "Second concurrent message", 
            "Third concurrent message"
        ]
        
        async def generate_one(text):
            result = await client.generate_visemes(text)
            return len(result)
        
        start = asyncio.get_event_loop().time()
        results = await asyncio.gather(*[generate_one(t) for t in texts])
        elapsed = asyncio.get_event_loop().time() - start
        
        print(f"   All 3 completed in {elapsed:.2f}s")
        print(f"   Visemes generated: {results}")
    
    print("\n✅ All tests completed!")
    print("-" * 60)


if __name__ == "__main__":
    # Run tests
    asyncio.run(test_async_client())
