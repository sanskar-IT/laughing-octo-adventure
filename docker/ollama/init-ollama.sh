#!/bin/bash
# AI Companion - Ollama Initialization Script
# Downloads small models suitable for RTX 4050

set -e

echo "========================================="
echo "🚀 AI Companion - Ollama Initialization"
echo "========================================="
echo ""

# Start Ollama server in background
echo "📡 Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

# Wait for server to be ready
echo "⏳ Waiting for Ollama server..."
for i in {1..30}; do
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo "✅ Ollama server is ready!"
        break
    fi
    echo "   Attempt $i/30..."
    sleep 2
done

# Check if server is running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "❌ Failed to start Ollama server"
    exit 1
fi

echo ""
echo "📦 Checking available models..."

# Function to pull model if not exists
pull_model() {
    local model=$1
    local size=$2
    
    if curl -s http://localhost:11434/api/tags | grep -q "\"name\":\"$model\""; then
        echo "✅ Model '$model' already exists ($size)"
    else
        echo "⬇️  Downloading model: $model ($size)..."
        echo "   This may take a few minutes..."
        
        # Pull model
        if ollama pull "$model"; then
            echo "✅ Successfully downloaded: $model"
            
            # Test the model
            echo "🧪 Testing model inference..."
            if echo "Hello" | ollama run "$model" --silent > /dev/null 2>&1; then
                echo "✅ Model test passed!"
            else
                echo "⚠️  Model test failed, but download succeeded"
            fi
        else
            echo "❌ Failed to download model: $model"
            echo "   Continuing anyway..."
        fi
    fi
    echo ""
}

# Pull recommended models for RTX 4050
# These are small (3B parameters) and efficient

echo "🎯 Downloading models optimized for RTX 4050..."
echo ""

# Primary recommendation: Qwen2.5-3B
# - 3B parameters
# - ~1.8GB download
# - Good quality, fast inference
pull_model "qwen2.5:3b" "~1.8GB"

# Alternative: Llama3.2-3B
# - 3.2B parameters
# - ~2.0GB download
# - Meta's efficient small model
pull_model "llama3.2:3b" "~2.0GB"

# Optional: Phi-4-mini (if available)
# - 3.8B parameters
# - Microsoft's efficient model
pull_model "phi4-mini" "~2.2GB" || echo "⚠️  phi4-mini not available, skipping"

echo ""
echo "📊 Installed models:"
curl -s http://localhost:11434/api/tags | grep '"name"' | sed 's/.*"name":"\([^"]*\)".*/  - \1/'

echo ""
echo "========================================="
echo "✅ Initialization complete!"
echo "========================================="
echo ""
echo "📋 Quick test commands:"
echo "  curl http://localhost:11434/api/tags"
echo "  ollama run qwen2.5:3b"
echo ""
echo "🎮 AI Companion is ready to use!"
echo ""

# Keep Ollama running in foreground
wait $OLLAMA_PID
