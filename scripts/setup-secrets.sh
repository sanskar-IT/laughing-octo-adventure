#!/bin/bash
# Setup script for git-secrets configuration

echo "🔐 Setting up git-secrets for the repository..."

# Check if git-secrets is installed
if ! command -v git-secrets &> /dev/null; then
    echo "⚠️  git-secrets is not installed."
    echo ""
    echo "Installation instructions:"
    echo "  macOS:   brew install git-secrets"
    echo "  Windows: Download from https://github.com/awslabs/git-secrets/releases"
    echo "  Linux:   git clone https://github.com/awslabs/git-secrets.git && cd git-secrets && sudo make install"
    echo ""
    echo "Skipping git-secrets setup for now..."
    exit 0
fi

# Install git-secrets hooks for this repository
echo "   Installing git-secrets hooks..."
git secrets --install

# Register AWS secrets patterns
echo "   Registering AWS secret patterns..."
git secrets --register-aws

# Add OpenAI API key pattern
echo "   Adding OpenAI API key pattern..."
git secrets --add 'sk-[a-zA-Z0-9]{48}'

# Add generic secret key patterns
echo "   Adding generic secret key patterns..."
git secrets --add 'sk-[a-zA-Z0-9]{20,}'
git secrets --add 'sk-proj-[a-zA-Z0-9_-]{48}'

# Add API key assignment patterns
echo "   Adding API key assignment patterns..."
git secrets --add 'api[_-]?key\s*[:=]\s*["\']?[a-zA-Z0-9_-]{20,}["\']?'
git secrets --add 'OPENAI_API_KEY\s*[:=]\s*["\']sk-'

# Add password patterns
echo "   Adding password patterns..."
git secrets --add 'password\s*[:=]\s*["\'][^"\']{8,}["\']'

# Add private key references
echo "   Adding private key patterns..."
git secrets --add 'private[_-]?key'

# Add JWT patterns
echo "   Adding JWT token patterns..."
git secrets --add 'eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+'

# Add AWS access key patterns
echo "   Adding AWS access key patterns..."
git secrets --add 'AKIA[0-9A-Z]{16}'

# Add allowed patterns (false positives)
echo "   Adding allowed patterns..."
git secrets --add --allowed 'EXAMPLE_KEY|YOUR_API_KEY|YOUR_SECRET|placeholder|test_key|demo_key|xxxxxxxx'

# Create baseline file if it doesn't exist
if [ ! -f .secrets.baseline ]; then
    echo "   Creating secrets baseline..."
    git secrets --scan > .secrets.baseline 2>/dev/null || true
fi

echo ""
echo "✅ git-secrets configured successfully!"
echo "   The pre-commit hook will scan for secrets automatically."
