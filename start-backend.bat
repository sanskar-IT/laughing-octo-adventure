@echo off
REM Start FastAPI Backend for AI Companion
REM Requires Python 3.10+ with dependencies installed

echo ========================================
echo  AI Companion - FastAPI Backend
echo ========================================

REM Check if virtual environment exists
if exist "venv\Scripts\activate.bat" (
    echo Activating virtual environment...
    call venv\Scripts\activate.bat
) else (
    echo [WARNING] Virtual environment not found.
    echo Run: python -m venv venv
    echo Then: venv\Scripts\activate ^& pip install -r backend_fastapi\requirements.txt
)

REM Check if dependencies are installed
python -c "import fastapi" 2>nul
if errorlevel 1 (
    echo Installing FastAPI dependencies...
    pip install -r backend_fastapi\requirements.txt
)

echo.
echo Starting FastAPI backend on port 3000...
echo API Documentation: http://localhost:3000/docs
echo.

REM Start the server
python -m backend_fastapi.main
