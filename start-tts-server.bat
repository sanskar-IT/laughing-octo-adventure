@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║        Starting Async TTS Server                             ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

REM Check if venv exists
if not exist "venv" (
    echo ❌ Virtual environment not found!
    echo    Please run: setup-tts-server.bat
    pause
    exit /b 1
)

REM Activate virtual environment
echo 🔄 Activating virtual environment...
call venv\Scripts\activate.bat

REM Check if dependencies are installed
python -c "import fastapi" >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Dependencies not installed!
    echo    Please run: setup-tts-server.bat
    pause
    exit /b 1
)

echo ✅ Dependencies verified
echo.
echo 🚀 Starting FastAPI TTS Server...
echo 📍 Server will run on: http://localhost:8000
echo 📖 API Documentation: http://localhost:8000/docs
echo 🔊 Streaming Audio: Enabled
echo ⚡ Concurrent Requests: Supported
echo ⏹️  Press Ctrl+C to stop
echo.
echo ═══════════════════════════════════════════════════════════════

python tts-server.py

if %errorlevel% neq 0 (
    echo.
    echo ❌ Server stopped with error
    pause
)
