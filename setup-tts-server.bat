@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║        AI Companion - Async TTS Server Setup                 ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

REM Check Python version
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Python not found! Please install Python 3.8 or higher.
    echo    Download: https://www.python.org/downloads/
    exit /b 1
)

for /f "tokens=2" %%a in ('python --version') do set PYVER=%%a
echo ✅ Python version: %PYVER%

REM Create virtual environment if it doesn't exist
if not exist "venv" (
    echo 📦 Creating virtual environment...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo ❌ Failed to create virtual environment
        exit /b 1
    )
    echo ✅ Virtual environment created
) else (
    echo ✅ Virtual environment already exists
)

REM Activate virtual environment
echo 🔄 Activating virtual environment...
call venv\Scripts\activate.bat

REM Upgrade pip
echo ⬆️  Upgrading pip...
python -m pip install --upgrade pip

REM Install dependencies
echo 📥 Installing dependencies...
pip install -r tts-server-requirements.txt

if %errorlevel% neq 0 (
    echo ❌ Failed to install dependencies
    exit /b 1
)

echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║                 ✅ Setup Complete!                             ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.
echo 🚀 To start the TTS server, run:
echo    start-tts-server.bat
echo.
echo 🧪 To test the server:
echo    python test_tts_async.py
echo.
echo 📖 API Documentation will be available at:
echo    http://localhost:8000/docs
echo.

pause
