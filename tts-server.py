<<<<<<< HEAD
import http.server
import socketserver
import json
import logging
import base64
import random
import os
import urllib.parse
import re
from datetime import datetime, timedelta

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PORT = 8000
HOST = "localhost"

# Security settings
ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000']
MAX_TEXT_LENGTH = 1000
RATE_LIMIT_REQUESTS = 100
RATE_LIMIT_WINDOW = 60  # seconds

# Rate limiting storage
rate_limit_storage = {}

def validate_origin(origin):
    """Validate CORS origin"""
    if not origin:
        return False
    return origin in ALLOWED_ORIGINS

def validate_text(text):
    """Validate input text"""
    if not text or not isinstance(text, str):
        return False, "Text is required and must be a string"
    
    if len(text) > MAX_TEXT_LENGTH:
        return False, f"Text too long (max {MAX_TEXT_LENGTH} characters)"
    
    # Remove potentially dangerous characters
    cleaned = re.sub(r'[<>"\']', '', text)
    if len(cleaned) != len(text):
        return False, "Text contains invalid characters"
    
    return True, cleaned

def check_rate_limit(client_ip):
    """Check rate limiting"""
    now = datetime.now()
    window_start = now - timedelta(seconds=RATE_LIMIT_WINDOW)
    
    if client_ip not in rate_limit_storage:
        rate_limit_storage[client_ip] = []
    
    # Remove old requests
    rate_limit_storage[client_ip] = [
        req_time for req_time in rate_limit_storage[client_ip] 
        if req_time > window_start
    ]
    
    if len(rate_limit_storage[client_ip]) >= RATE_LIMIT_REQUESTS:
        return False, "Rate limit exceeded"
    
    rate_limit_storage[client_ip].append(now)
    return True, None

# Viseme mapping (approximate for simplistic lip sync)
VISEME_MAP = {
    'a': 1, 'e': 2, 'i': 3, 'o': 4, 'u': 5,
    'b': 6, 'm': 6, 'p': 6, 'f': 7, 'v': 7, 'w': 8,
    'r': 8, 'l': 9, 'd': 10, 'n': 10, 't': 10, 's': 11,
    'z': 11, 'j': 12, 'ch': 12, 'sh': 13, 'k': 14,
    'g': 14, 'x': 14, 'y': 15, 'h': 16
}

def generate_visemes(text):
    """
    Generate a list of visemes based on text characters.
    This is a very basic heuristic. Real lip sync requires phoneme extraction.
    """
    visemes = []
    text = text.lower()
    time_step = 0.05 # 50ms per character approx
    
    for i, char in enumerate(text):
        if char in VISEME_MAP:
            value = VISEME_MAP[char]
            duration = 0.1
        elif char.isspace():
            value = 0
            duration = 0.05
        else:
            value = 0
            duration = 0.05
            
        visemes.append({
            "time": i * time_step,
            "value": value,
            "duration": duration
        })
    return visemes

def generate_audio(text):
    """
    Generate audio for the given text.
    In a real scenario, this would call GPT-SoVITS or Coqui TTS.
    For now, return dummy WAV data (silence) to satisfy the protocol,
    or try to use pyttsx3 if available.
    """
    try:
        import pyttsx3
        engine = pyttsx3.init()
        # Save to a temporary file
        filename = "temp_output.wav"
        engine.save_to_file(text, filename)
        engine.runAndWait()
        
        with open(filename, "rb") as f:
            audio_data = f.read()
        return base64.b64encode(audio_data).decode('utf-8')
    except ImportError:
        logger.warning("pyttsx3 not found, returning silent dummy audio.")
        # Return 1 second of silence (WAV header + null bytes)
        # Minimal PCM WAV header
        header = b'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00'
        return base64.b64encode(header).decode('utf-8')
    except Exception as e:
        logger.error(f"TTS generation error: {e}")
        return ""

class TTSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        """Override to prevent information disclosure"""
        logger.info(f"{self.address_string()} - {format % args}")

    def do_POST(self):
        if self.path == '/generate':
            # Get client IP for rate limiting
            client_ip = self.client_address[0]
            
            # Check rate limit
            allowed, error_msg = check_rate_limit(client_ip)
            if not allowed:
                self.send_error(429, error_msg)
                return
            
            # Check CORS origin
            origin = self.headers.get('Origin')
            if not validate_origin(origin):
                self.send_error(403, "CORS policy violation")
                return
            
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 10000:  # Max 10KB
                self.send_error(413, "Request entity too large")
                return
            
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                text = data.get('text', '')
                
                # Validate input
                is_valid, result = validate_text(text)
                if not is_valid:
                    self.send_error(400, result)
                    return
                
                text = result  # Use cleaned text
                logger.info(f"Processing TTS request: {len(text)} characters")
                
                visemes = generate_visemes(text)
                audio_b64 = generate_audio(text)
                
                response = {
                    "success": True,
                    "audio": audio_b64,
                    "visemes": visemes,
                    "timestamp": datetime.now().isoformat()
                }
                
                response_json = json.dumps(response)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Content-Length', str(len(response_json)))
                self.send_header('Access-Control-Allow-Origin', origin or '*')
                self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                self.end_headers()
                self.wfile.write(response_json.encode('utf-8'))
                
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
            except Exception as e:
                logger.error(f"Error processing request: {e}")
                self.send_error(500, "Internal server error")
        else:
            self.send_error(404, "Not found")

    def do_OPTIONS(self):
        origin = self.headers.get('Origin')
        if not validate_origin(origin):
            self.send_error(403, "CORS policy violation")
            return
            
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', origin if origin else '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

if __name__ == "__main__":
    print(f"Starting TTS Server on {HOST}:{PORT}")
    with socketserver.TCPServer((HOST, PORT), TTSRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
=======
import http.server
import socketserver
import json
import logging
import base64
import random
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PORT = 8000
HOST = "localhost"

# Viseme mapping (approximate for simplistic lip sync)
VISEME_MAP = {
    'a': 1, 'e': 2, 'i': 3, 'o': 4, 'u': 5,
    'b': 6, 'm': 6, 'p': 6, 'f': 7, 'v': 7, 'w': 8,
    'r': 8, 'l': 9, 'd': 10, 'n': 10, 't': 10, 's': 11,
    'z': 11, 'j': 12, 'ch': 12, 'sh': 13, 'k': 14,
    'g': 14, 'x': 14, 'y': 15, 'h': 16
}

def generate_visemes(text):
    """
    Generate a list of visemes based on text characters.
    This is a very basic heuristic. Real lip sync requires phoneme extraction.
    """
    visemes = []
    text = text.lower()
    time_step = 0.05 # 50ms per character approx
    
    for i, char in enumerate(text):
        if char in VISEME_MAP:
            value = VISEME_MAP[char]
            duration = 0.1
        elif char.isspace():
            value = 0
            duration = 0.05
        else:
            value = 0
            duration = 0.05
            
        visemes.append({
            "time": i * time_step,
            "value": value,
            "duration": duration
        })
    return visemes

def generate_audio(text):
    """
    Generate audio for the given text.
    In a real scenario, this would call GPT-SoVITS or Coqui TTS.
    For now, return dummy WAV data (silence) to satisfy the protocol,
    or try to use pyttsx3 if available.
    """
    try:
        import pyttsx3
        engine = pyttsx3.init()
        # Save to a temporary file
        filename = "temp_output.wav"
        engine.save_to_file(text, filename)
        engine.runAndWait()
        
        with open(filename, "rb") as f:
            audio_data = f.read()
        return base64.b64encode(audio_data).decode('utf-8')
    except ImportError:
        logger.warning("pyttsx3 not found, returning silent dummy audio.")
        # Return 1 second of silence (WAV header + null bytes)
        # Minimal PCM WAV header
        header = b'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00'
        return base64.b64encode(header).decode('utf-8')
    except Exception as e:
        logger.error(f"TTS generation error: {e}")
        return ""

class TTSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/generate':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                text = data.get('text', '')
                
                logger.info(f"Received TTS request for: {text[:50]}...")
                
                visemes = generate_visemes(text)
                audio_b64 = generate_audio(text)
                
                response = {
                    "success": True,
                    "audio": audio_b64,
                    "visemes": visemes
                }
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*') # CORS
                self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                self.end_headers()
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                logger.error(f"Error processing request: {e}")
                self.send_response(500)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

if __name__ == "__main__":
    print(f"Starting TTS Server on {HOST}:{PORT}")
    with socketserver.TCPServer((HOST, PORT), TTSRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
>>>>>>> ff6ad8ba64ecdfc7321d5982b49d420195c10bd4
