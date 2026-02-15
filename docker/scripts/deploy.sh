#!/bin/bash
# AI Companion - Docker Deployment Script
# Deploys full stack with RTX 4050 GPU support

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$DOCKER_DIR")"

# Default values
ENVIRONMENT="development"
PULL_MODELS=true
SKIP_GPU_CHECK=false

# Print functions
print_header() {
    echo ""
    echo "========================================="
    echo -e "${BLUE}$1${NC}"
    echo "========================================="
    echo ""
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Help function
show_help() {
    cat << EOF
AI Companion - Docker Deployment Script

Usage: ./deploy.sh [OPTIONS]

Options:
    -e, --environment ENV   Set environment (development|production) [default: development]
    -p, --pull-models       Pull Ollama models on startup [default: true]
    --skip-gpu-check       Skip NVIDIA GPU check [default: false]
    -h, --help             Show this help message

Examples:
    # Deploy development environment
    ./deploy.sh

    # Deploy production environment
    ./deploy.sh --environment production

    # Deploy without pulling models (faster)
    ./deploy.sh --no-pull-models

Environments:
    development  - Hot reload, debug logging, exposed ports
    production   - Optimized builds, minimal logging, SSL ready

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -p|--pull-models)
            PULL_MODELS=true
            shift
            ;;
        --no-pull-models)
            PULL_MODELS=false
            shift
            ;;
        --skip-gpu-check)
            SKIP_GPU_CHECK=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Validate environment
if [[ "$ENVIRONMENT" != "development" && "$ENVIRONMENT" != "production" ]]; then
    print_error "Invalid environment: $ENVIRONMENT"
    print_info "Valid options: development, production"
    exit 1
fi

print_header "AI Companion Docker Deployment"
print_info "Environment: $ENVIRONMENT"
print_info "Project Root: $PROJECT_ROOT"
print_info "Docker Directory: $DOCKER_DIR"
echo ""

# ==========================================
# CHECK PREREQUISITES
# ==========================================
print_header "Step 1: Checking Prerequisites"

# Check Docker
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed"
    print_info "Install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi
print_success "Docker found: $(docker --version)"

# Check Docker Compose
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
    print_success "Docker Compose (plugin) found"
elif command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
    print_success "Docker Compose (standalone) found: $(docker-compose --version)"
else
    print_error "Docker Compose is not installed"
    print_info "Install Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

# Check NVIDIA Docker (optional but recommended)
if [[ "$SKIP_GPU_CHECK" == false ]]; then
    print_info "Checking NVIDIA GPU support..."
    
    if docker info | grep -q "nvidia"; then
        print_success "NVIDIA Container Toolkit detected"
        
        # Test GPU access
        if docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi &> /dev/null; then
            print_success "GPU access verified"
            GPU_AVAILABLE=true
        else
            print_warning "GPU test failed, but continuing..."
            GPU_AVAILABLE=false
        fi
    else
        print_warning "NVIDIA Container Toolkit not detected"
        print_info "To enable GPU acceleration, install:"
        print_info "  https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html"
        GPU_AVAILABLE=false
    fi
else
    print_info "GPU check skipped"
    GPU_AVAILABLE=false
fi

# ==========================================
# SETUP ENVIRONMENT
# ==========================================
print_header "Step 2: Setting up Environment"

cd "$DOCKER_DIR"

# Create .env if it doesn't exist
if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
        print_info "Creating .env from .env.example..."
        cp .env.example .env
        print_success ".env file created"
        print_warning "Please edit .env and set your JWT_SECRET and API keys"
    else
        print_error ".env.example not found"
        exit 1
    fi
else
    print_success ".env file exists"
fi

# Source .env for JWT_SECRET check
source .env

# Check JWT_SECRET
if [[ -z "$JWT_SECRET" || "$JWT_SECRET" == "your_64_character_hex_secret_here_change_this_in_production" ]]; then
    print_warning "JWT_SECRET is not set or is using default value"
    print_info "Generating new JWT_SECRET..."
    
    if command -v node &> /dev/null; then
        NEW_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    elif command -v openssl &> /dev/null; then
        NEW_SECRET=$(openssl rand -hex 32)
    else
        print_error "Cannot generate JWT_SECRET (node or openssl required)"
        print_info "Please manually set JWT_SECRET in .env file"
        exit 1
    fi
    
    # Update .env file
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
        # Windows
        sed -i "s/JWT_SECRET=.*/JWT_SECRET=$NEW_SECRET/" .env
    else
        # Unix
        sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$NEW_SECRET/" .env
    fi
    
    print_success "JWT_SECRET generated and saved to .env"
fi

# Create required directories
print_info "Creating required directories..."
mkdir -p logs data characters models
print_success "Directories created"

# ==========================================
# BUILD AND START SERVICES
# ==========================================
print_header "Step 3: Building and Starting Services"

# Set compose files
COMPOSE_FILES="-f docker-compose.yml"
if [[ "$ENVIRONMENT" == "production" ]]; then
    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.prod.yml"
    print_info "Using production configuration"
else
    print_info "Using development configuration"
fi

# Pull latest images
print_info "Pulling latest base images..."
$COMPOSE_CMD $COMPOSE_FILES pull

# Build images
print_info "Building Docker images..."
$COMPOSE_CMD $COMPOSE_FILES build --no-cache

# Start services
print_info "Starting services..."
$COMPOSE_CMD $COMPOSE_FILES up -d

# ==========================================
# HEALTH CHECKS
# ==========================================
print_header "Step 4: Health Checks"

print_info "Waiting for services to be ready..."
sleep 5

# Check each service
SERVICES=("ollama" "tts" "backend" "nginx")
for service in "${SERVICES[@]}"; do
    print_info "Checking $service..."
    
    # Wait for service to be healthy
    for i in {1..30}; do
        if $COMPOSE_CMD $COMPOSE_FILES ps | grep -q "$service.*healthy"; then
            print_success "$service is healthy"
            break
        fi
        
        if [[ $i -eq 30 ]]; then
            print_warning "$service health check timeout"
            print_info "Check logs with: $COMPOSE_CMD $COMPOSE_FILES logs $service"
        fi
        
        sleep 2
    done
done

# ==========================================
# PULL OLLAMA MODELS (Optional)
# ==========================================
if [[ "$PULL_MODELS" == true && "$GPU_AVAILABLE" == true ]]; then
    print_header "Step 5: Pulling Ollama Models"
    print_info "This may take a few minutes..."
    
    # Wait for Ollama to be fully ready
    sleep 10
    
    # Pull models using the init script
    $COMPOSE_CMD $COMPOSE_FILES exec ollama /tmp/init-ollama.sh || {
        print_warning "Model initialization had issues, but continuing..."
    }
fi

# ==========================================
# DEPLOYMENT SUMMARY
# ==========================================
print_header "🎉 Deployment Complete!"

echo ""
echo "📋 Service URLs:"
echo "  • Main Application: http://localhost:${NGINX_PORT:-8080}"
echo "  • Backend API:      http://localhost:${BACKEND_PORT:-3000}"
echo "  • TTS Service:      http://localhost:${TTS_PORT:-4000}"
echo "  • Ollama API:       http://localhost:${OLLAMA_PORT:-5000}"
if [[ "$ENVIRONMENT" == "development" ]]; then
    echo "  • Frontend Dev:     http://localhost:${FRONTEND_PORT:-6000}"
fi

echo ""
echo "📊 Useful Commands:"
echo "  View logs:        $COMPOSE_CMD $COMPOSE_FILES logs -f"
echo "  Stop services:    $COMPOSE_CMD $COMPOSE_FILES down"
echo "  Restart:          $COMPOSE_CMD $COMPOSE_FILES restart"
echo "  Update:           ./scripts/update.sh"

echo ""
echo "🔧 Configuration:"
echo "  Edit .env file:   $DOCKER_DIR/.env"
echo "  View config:      cat $DOCKER_DIR/.env"

echo ""
if [[ "$GPU_AVAILABLE" == true ]]; then
    print_success "GPU acceleration enabled - RTX 4050 ready!"
else
    print_warning "GPU not available - using CPU mode (slower)"
fi

echo ""
echo "🚀 AI Companion is ready to use!"
echo "   Open http://localhost:${NGINX_PORT:-8080} in your browser"
echo ""
