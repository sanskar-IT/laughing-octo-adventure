#!/bin/bash
# AI Companion - Update Script
# Updates Docker images and restarts services

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(dirname "$SCRIPT_DIR")"

print_header() {
    echo ""
    echo "========================================="
    echo -e "${BLUE}$1${NC}"
    echo "========================================="
    echo ""
}

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }

show_help() {
    cat << EOF
AI Companion - Update Script

Usage: ./update.sh [OPTIONS]

Options:
    -e, --environment ENV   Set environment (development|production) [default: current]
    --full                 Full rebuild (clear caches) [default: false]
    -h, --help             Show this help message

EOF
}

# Parse arguments
ENVIRONMENT=""
FULL_REBUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --full)
            FULL_REBUILD=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

cd "$DOCKER_DIR"

# Detect current environment
if [[ -z "$ENVIRONMENT" ]]; then
    if docker compose ps | grep -q "ai-companion"; then
        print_info "Detected running environment"
        # Check if production
        if docker compose -f docker-compose.yml -f docker-compose.prod.yml ps | grep -q "ai-companion"; then
            ENVIRONMENT="production"
        else
            ENVIRONMENT="development"
        fi
    else
        ENVIRONMENT="development"
    fi
fi

print_header "AI Companion Update"
print_info "Environment: $ENVIRONMENT"
print_info "Full rebuild: $FULL_REBUILD"

# Set compose command
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

COMPOSE_FILES="-f docker-compose.yml"
if [[ "$ENVIRONMENT" == "production" ]]; then
    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.prod.yml"
fi

# Backup data
print_header "Step 1: Backup"
if [[ -d data ]]; then
    BACKUP_DIR="backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    cp -r data/* "$BACKUP_DIR/" 2>/dev/null || true
    print_success "Data backed up to $BACKUP_DIR"
fi

# Pull latest images
print_header "Step 2: Pull Updates"
$COMPOSE_CMD $COMPOSE_FILES pull

# Stop services
print_header "Step 3: Stop Services"
$COMPOSE_CMD $COMPOSE_FILES down

# Rebuild if requested
if [[ "$FULL_REBUILD" == true ]]; then
    print_header "Step 4: Full Rebuild"
    $COMPOSE_CMD $COMPOSE_FILES build --no-cache
else
    print_header "Step 4: Rebuild"
    $COMPOSE_CMD $COMPOSE_FILES build
fi

# Start services
print_header "Step 5: Start Services"
$COMPOSE_CMD $COMPOSE_FILES up -d

# Health check
print_header "Step 6: Health Check"
sleep 5

SERVICES=("ollama" "tts" "backend" "nginx")
for service in "${SERVICES[@]}"; do
    if $COMPOSE_CMD $COMPOSE_FILES ps | grep -q "$service.*healthy"; then
        print_success "$service is healthy"
    else
        print_warning "$service may still be starting..."
    fi
done

print_header "✅ Update Complete!"
print_info "Services are running at http://localhost:8080"
