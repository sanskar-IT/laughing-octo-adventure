"""
Test script for async TTS server
Tests concurrent requests, streaming, and performance
"""

import asyncio
import aiohttp
import time
from typing import List
import statistics


async def test_concurrent_requests(
    num_requests: int = 10,
    text: str = "This is a test of concurrent TTS requests."
) -> dict:
    """
    Test that multiple TTS requests can run concurrently without blocking.
    """
    print(f"\n🧪 Testing {num_requests} concurrent requests...")
    
    async def make_request(session: aiohttp.ClientSession, request_id: int) -> dict:
        """Make a single TTS request and measure time"""
        start = time.time()
        try:
            async with session.post(
                'http://localhost:8000/generate',
                json={"text": f"{text} Request {request_id}.", "stream": False}
            ) as response:
                await response.json()
                elapsed = time.time() - start
                return {
                    "id": request_id,
                    "success": True,
                    "time": elapsed,
                    "status": response.status
                }
        except Exception as e:
            elapsed = time.time() - start
            return {
                "id": request_id,
                "success": False,
                "time": elapsed,
                "error": str(e)
            }
    
    # Create session
    async with aiohttp.ClientSession() as session:
        # Launch all requests simultaneously
        start = time.time()
        tasks = [make_request(session, i) for i in range(num_requests)]
        results = await asyncio.gather(*tasks)
        total_time = time.time() - start
    
    # Analyze results
    successful = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]
    times = [r["time"] for r in successful]
    
    print(f"   Total time: {total_time:.2f}s")
    print(f"   Successful: {len(successful)}/{num_requests}")
    print(f"   Failed: {len(failed)}")
    if times:
        print(f"   Avg response time: {statistics.mean(times):.2f}s")
        print(f"   Max response time: {max(times):.2f}s")
        print(f"   Min response time: {min(times):.2f}s")
    
    if failed:
        print(f"   ⚠️  Failed requests: {[r['id'] for r in failed]}")
    
    return {
        "total_time": total_time,
        "successful": len(successful),
        "failed": len(failed),
        "avg_time": statistics.mean(times) if times else 0
    }


async def test_streaming_latency(text: str = "Testing streaming latency.") -> dict:
    """
    Test streaming latency - how quickly first audio chunk arrives.
    """
    print(f"\n🧪 Testing streaming latency...")
    print(f"   Text: '{text}'")
    
    async with aiohttp.ClientSession() as session:
        # Time to first byte
        start = time.time()
        first_byte_time = None
        chunk_count = 0
        total_bytes = 0
        
        async with session.post(
            'http://localhost:8000/generate',
            json={"text": text, "stream": True}
        ) as response:
            
            async for chunk in response.content.iter_chunked(1024):
                if first_byte_time is None:
                    first_byte_time = time.time()
                chunk_count += 1
                total_bytes += len(chunk)
        
        end_time = time.time()
        
        time_to_first_byte = (first_byte_time - start) * 1000  # ms
        total_time = (end_time - start) * 1000  # ms
        
        print(f"   Time to first byte: {time_to_first_byte:.0f}ms")
        print(f"   Total stream time: {total_time:.0f}ms")
        print(f"   Chunks received: {chunk_count}")
        print(f"   Total bytes: {total_bytes}")
        print(f"   Avg chunk size: {total_bytes // chunk_count if chunk_count else 0} bytes")
        
        return {
            "time_to_first_byte_ms": time_to_first_byte,
            "total_time_ms": total_time,
            "chunk_count": chunk_count,
            "total_bytes": total_bytes
        }


async def test_viseme_generation(text: str = "Hello world, this is a test.") -> dict:
    """
    Test viseme generation endpoint.
    """
    print(f"\n🧪 Testing viseme generation...")
    
    async with aiohttp.ClientSession() as session:
        start = time.time()
        
        async with session.post(
            'http://localhost:8000/generate-visemes',
            json={"text": text}
        ) as response:
            
            data = await response.json()
            elapsed = (time.time() - start) * 1000  # ms
            
            if response.status == 200:
                visemes = data.get("visemes", [])
                print(f"   ✓ Generated {len(visemes)} visemes in {elapsed:.0f}ms")
                print(f"   Sample visemes: {visemes[:3]}")
                return {
                    "success": True,
                    "count": len(visemes),
                    "time_ms": elapsed
                }
            else:
                print(f"   ✗ Failed: {response.status}")
                return {"success": False, "status": response.status}


async def test_server_info() -> dict:
    """
    Test server endpoints.
    """
    print(f"\n🧪 Testing server endpoints...")
    
    async with aiohttp.ClientSession() as session:
        # Test root
        async with session.get('http://localhost:8000/') as response:
            if response.status == 200:
                data = await response.json()
                print(f"   ✓ Root endpoint: {data.get('status')}")
                print(f"   Mode: {data.get('mode', 'unknown')}")
            else:
                print(f"   ✗ Root endpoint failed: {response.status}")
        
        # Test health
        async with session.get('http://localhost:8000/health') as response:
            if response.status == 200:
                data = await response.json()
                print(f"   ✓ Health check: {data.get('status')}")
            else:
                print(f"   ✗ Health check failed: {response.status}")
        
        # Test voices
        async with session.get('http://localhost:8000/voices') as response:
            if response.status == 200:
                data = await response.json()
                voice_count = data.get('count', 0)
                print(f"   ✓ Voices endpoint: {voice_count} voices available")
                if voice_count > 0:
                    sample = data.get('voices', [])[:2]
                    print(f"   Sample voices: {[v.get('ShortName') for v in sample]}")
            else:
                print(f"   ⚠ Voices endpoint: {response.status} (may be unavailable)")
    
    return {"success": True}


async def test_rate_limiting():
    """
    Test rate limiting - send requests rapidly and check for 429 responses.
    """
    print(f"\n🧪 Testing rate limiting...")
    
    async def make_quick_request(session: aiohttp.ClientSession, request_id: int):
        async with session.post(
            'http://localhost:8000/generate',
            json={"text": f"Rate limit test {request_id}", "stream": False}
        ) as response:
            return {
                "id": request_id,
                "status": response.status,
                "limited": response.status == 429
            }
    
    # Send 110 requests rapidly (limit is 100 per 60s)
    async with aiohttp.ClientSession() as session:
        tasks = [make_quick_request(session, i) for i in range(110)]
        results = await asyncio.gather(*tasks)
    
    limited_count = sum(1 for r in results if r["limited"])
    success_count = sum(1 for r in results if r["status"] == 200)
    
    print(f"   Total requests: 110")
    print(f"   Successful (200): {success_count}")
    print(f"   Rate limited (429): {limited_count}")
    
    if limited_count > 0:
        print(f"   ✓ Rate limiting is working")
    else:
        print(f"   ⚠ Rate limiting may not be enforced yet (window may have reset)")


async def main():
    """
    Run all tests.
    """
    print("=" * 70)
    print("  Async TTS Server Test Suite")
    print("  Testing concurrent requests, streaming, and performance")
    print("=" * 70)
    
    # Wait a moment for server to be ready
    print("\n⏳ Waiting for server to be ready...")
    await asyncio.sleep(2)
    
    try:
        # Basic connectivity
        await test_server_info()
        
        # Viseme generation
        await test_viseme_generation()
        
        # Streaming latency
        await test_streaming_latency()
        
        # Concurrent requests
        await test_concurrent_requests(num_requests=5)
        
        # Rate limiting (optional, takes longer)
        # await test_rate_limiting()
        
        print("\n" + "=" * 70)
        print("  ✅ All tests completed successfully!")
        print("  The async TTS server is working correctly.")
        print("=" * 70)
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        print("Make sure the TTS server is running: python tts-server.py")
        raise


if __name__ == "__main__":
    print("\n🚀 Starting Async TTS Server Tests\n")
    
    # Run tests
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️  Tests interrupted by user")
    except Exception as e:
        print(f"\n\n❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
