# Git Pre-Commit Hook Implementation Plan

**Objective:** Create a comprehensive pre-commit hook that runs linting and secret scanning to prevent accidental commits of API keys (especially OpenAI keys).

**Requirements from User:**
- Lint both JavaScript/TypeScript AND Python files
- Use git-secrets tool for secret scanning
- Strict enforcement (no --no-verify bypass allowed for API keys)
- Auto-install for team members
- CI/CD enforcement as backup

---

## 📋 Implementation Plan

### Phase 1: Secret Scanning with git-secrets

**Tool:** `git-secrets` (AWS Labs)
- Industry-standard tool for preventing secret commits
- Scans for AWS keys, OpenAI keys, generic API keys, private keys
- Can be extended with custom patterns

**Implementation Steps:**

1. **Install git-secrets locally** (one-time setup)
   ```bash
   # macOS
   brew install git-secrets
   
   # Windows (via Git Bash or WSL)
   git clone https://github.com/awslabs/git-secrets.git
   cd git-secrets && make install
   
   # Or npm alternative
   npm install -g git-secrets
   ```

2. **Configure git-secrets for the repository**
   ```bash
   # Register patterns to block
   git secrets --register-aws
   git secrets --add 'sk-[a-zA-Z0-9]{48}'  # OpenAI API key pattern
   git secrets --add 'sk-[a-zA-Z0-9]{20,}' # Generic secret key pattern
   git secrets --add 'api[_-]?key\s*[:=]\s*["\']?[a-zA-Z0-9_-]+["\']?'  # API key assignments
   git secrets --add 'password\s*[:=]\s*["\'][^"\']{8,}["\']'  # Password assignments
   git secrets --add 'private[_-]?key'  # Private key references
   
   # Allow specific false positives (e.g., example keys in docs)
   git secrets --add --allowed 'EXAMPLE_KEY|YOUR_API_KEY|placeholder'
   ```

3. **Create pre-commit hook** that runs git-secrets
   - Scan staged files only (fast)
   - Block commit if secrets found
   - Provide clear error message with file:line location
   - Suggest using `.env` file instead

---

### Phase 2: Linting Configuration

**JavaScript/TypeScript:** ESLint (already configured)
```bash
npm run lint
```

**Python:** Add Python linting
```bash
# Add to package.json scripts
"lint:python": "python -m flake8 backend/ tts-server.py tts-bridge/ --max-line-length=100 --extend-ignore=E203,W503"

# Or use black for formatting
"format:python": "python -m black backend/ tts-server.py tts-bridge/ --check"
```

**Install Python linter:**
```bash
pip install flake8 black
```

---

### Phase 3: The Pre-Commit Hook

**Location:** `.git/hooks/pre-commit`

**Architecture:**
```bash
#!/bin/bash
#
# AI Companion Pre-Commit Hook
# Runs: ESLint, Python linting, Secret scanning
# Blocks commits with: API keys, secrets, lint errors
#

set -e  # Exit on error

echo "🔍 Running pre-commit checks..."
echo ""

# Track if any check fails
FAILED=0

# 1. Secret Scanning with git-secrets
echo "🔐 Checking for secrets..."
if ! git secrets --scan; then
    echo "❌ SECRETS DETECTED! Commit blocked."
    echo "💡 Move API keys to .env file (which is gitignored)"
    echo ""
    FAILED=1
fi

# 2. ESLint for JS/TS files
echo "📝 Running ESLint..."
STAGED_JS_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(js|jsx|ts|tsx)$' || true)

if [ -n "$STAGED_JS_FILES" ]; then
    echo "   Checking files: $STAGED_JS_FILES"
    if ! npx eslint $STAGED_JS_FILES --max-warnings=0; then
        echo "❌ ESLint errors found"
        echo "💡 Run: npm run lint"
        echo ""
        FAILED=1
    fi
else
    echo "   No JS/TS files to check"
fi

# 3. Python linting with flake8
echo "🐍 Running Python linter..."
STAGED_PY_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.py$' || true)

if [ -n "$STAGED_PY_FILES" ]; then
    echo "   Checking files: $STAGED_PY_FILES"
    if ! python -m flake8 $STAGED_PY_FILES --max-line-length=100; then
        echo "❌ Python lint errors found"
        echo "💡 Run: pip install flake8 && flake8 <file>"
        echo ""
        FAILED=1
    fi
else
    echo "   No Python files to check"
fi

# Final result
if [ $FAILED -eq 1 ]; then
    echo ""
    echo "⛔ Commit blocked! Fix the issues above."
    echo ""
    echo "Emergency bypass (requires admin):"
    echo "   Contact: admin@company.com with justification"
    echo ""
    exit 1
else
    echo ""
    echo "✅ All checks passed!"
    echo ""
    exit 0
fi
```

---

### Phase 4: Auto-Installation

**Method 1: Husky (Recommended for JS projects)**
Husky manages git hooks via npm and auto-installs for all team members.

**Installation:**
```bash
npm install --save-dev husky lint-staged
npx husky init
```

**Configuration (.husky/pre-commit):**
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run lint-staged (defined in package.json)
npx lint-staged

# Run secret scanner
echo "🔐 Scanning for secrets..."
git secrets --scan || {
    echo "❌ Secrets detected! Move API keys to .env file."
    exit 1
}
```

**package.json additions:**
```json
{
  "lint-staged": {
    "*.{js,jsx,ts,tsx}": [
      "eslint --fix",
      "git add"
    ],
    "*.py": [
      "flake8 --max-line-length=100"
    ]
  },
  "scripts": {
    "prepare": "husky install && npm run setup:secrets",
    "setup:secrets": "git secrets --register-aws && git secrets --add 'sk-[a-zA-Z0-9]{48}'"
  }
}
```

**Method 2: Custom Setup Script** (Alternative)
Create `scripts/setup-hooks.sh`:
```bash
#!/bin/bash
# Setup script for git hooks

HOOKS_DIR=".git/hooks"
SOURCE_DIR="scripts/hooks"

echo "Setting up git hooks..."

# Ensure hooks directory exists
mkdir -p "$HOOKS_DIR"

# Copy pre-commit hook
cp "$SOURCE_DIR/pre-commit" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"

# Install git-secrets if not present
if ! command -v git-secrets &> /dev/null; then
    echo "Installing git-secrets..."
    # Platform-specific installation
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install git-secrets
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        echo "Please install git-secrets manually on Windows:"
        echo "  https://github.com/awslabs/git-secrets#installing-git-secrets"
    else
        # Linux
        git clone https://github.com/awslabs/git-secrets.git /tmp/git-secrets
        cd /tmp/git-secrets && sudo make install
    fi
fi

# Configure git-secrets for this repo
git secrets --install
git secrets --register-aws
git secrets --add 'sk-[a-zA-Z0-9]{48}'

echo "✅ Git hooks configured!"
echo "   Pre-commit will run: linting + secret scanning"
```

Add to package.json:
```json
{
  "scripts": {
    "postinstall": "bash scripts/setup-hooks.sh"
  }
}
```

---

### Phase 5: CI/CD Enforcement (Backup)

**GitHub Actions workflow** (`.github/workflows/pre-commit.yml`):
```yaml
name: Pre-Commit Checks

on: [push, pull_request]

jobs:
  pre-commit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'
      
      - name: Install git-secrets
        run: |
          git clone https://github.com/awslabs/git-secrets.git
          cd git-secrets && sudo make install
      
      - name: Configure git-secrets
        run: |
          git secrets --install
          git secrets --register-aws
          git secrets --add 'sk-[a-zA-Z0-9]{48}'
      
      - name: Install dependencies
        run: |
          npm ci
          pip install flake8
      
      - name: Run secret scanner
        run: git secrets --scan || exit 1
      
      - name: Run ESLint
        run: npm run lint
      
      - name: Run Python linter
        run: python -m flake8 backend/ tts-server.py tts-bridge/ --max-line-length=100
```

---

### Phase 6: Prevent Bypass (--no-verify)

**Challenge:** `git commit --no-verify` skips all hooks

**Solutions:**

**Option A: Server-Side Pre-Receive Hook (GitHub/GitLab)**
- Block pushes with secrets at server level
- Users can't bypass server hooks
- Requires admin access to git server

**Option B: CI/CD as Gate**
- Make CI checks required for merging
- Block PR merge if secrets detected
- Cannot bypass without admin override

**Option C: Custom Wrapper Script**
Create `scripts/commit.sh`:
```bash
#!/bin/bash
# Safe commit wrapper

# Always run checks first
echo "🔍 Running pre-commit checks..."

if ! .git/hooks/pre-commit; then
    echo ""
    echo "❌ Checks failed. Fix issues or contact admin to override."
    exit 1
fi

# Only then commit
git commit "$@"
```

Add to package.json:
```json
{
  "scripts": {
    "commit": "bash scripts/commit.sh",
    "commit:admin": "git commit --no-verify"  # Admin only
  }
}
```

Document in CONTRIBUTING.md:
```markdown
## Bypass Policy

Pre-commit hooks **CANNOT** be bypassed for API key commits.

If you have a legitimate emergency:
1. Contact: admin@company.com
2. Provide justification
3. Admin will review and commit on your behalf if approved

Attempting to bypass with --no-verify will be detected in CI/CD.
```

---

## 📁 File Structure

```
ai-companion/
├── .git/
│   └── hooks/
│       └── pre-commit (auto-generated by husky)
├── .husky/ (if using husky)
│   └── pre-commit
├── .github/
│   └── workflows/
│       └── pre-commit.yml
├── scripts/
│   ├── setup-hooks.sh (installation script)
│   └── commit.sh (safe commit wrapper)
├── package.json (updated with husky, lint-staged)
├── .secrets.baseline (git-secrets baseline file)
└── CONTRIBUTING.md (bypass policy documentation)
```

---

## 🔧 Pattern Detection Examples

**What will be blocked:**
```javascript
// ❌ BLOCKED - Hardcoded API key
const apiKey = "sk-abcdefghijklmnopqrstuvwxyz123456789ABCDEF";
const OPENAI_API_KEY = "sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

// ❌ BLOCKED - In config files
{
  "api_key": "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "password": "SuperSecret123!"
}

// ❌ BLOCKED - URL with credentials
const url = "https://api.openai.com/v1?api_key=sk-xxxxx";

// ✅ ALLOWED - Environment variable
const apiKey = process.env.OPENAI_API_KEY;

// ✅ ALLOWED - Placeholder in docs
const API_KEY = "YOUR_API_KEY_HERE";
```

**Python examples:**
```python
# ❌ BLOCKED
API_KEY = "sk-abcdefghijklmnopqrstuvwxyz123456789ABCDEF"

# ✅ ALLOWED
API_KEY = os.getenv("OPENAI_API_KEY")
```

---

## 🚀 Installation Steps

### For You (Now):
```bash
# 1. Install husky and lint-staged
npm install --save-dev husky lint-staged

# 2. Initialize husky
npx husky init

# 3. Install git-secrets
# macOS:
brew install git-secrets

# Windows:
# Download from https://github.com/awslabs/git-secrets/releases

# 4. Configure git-secrets
git secrets --install
git secrets --register-aws
git secrets --add 'sk-[a-zA-Z0-9]{48}'
git secrets --add 'OPENAI_API_KEY\s*=\s*["\']sk-'

# 5. Install Python linter
pip install flake8

# 6. Test the hook
# Make a test commit (will run checks)
git add .
git commit -m "test: pre-commit hook"
```

### For Team Members:
```bash
# Just run npm install - hooks auto-install via postinstall
npm install
```

---

## 📊 Testing the Hook

### Test 1: Secret Detection
```bash
# Create test file with fake API key
echo 'const key = "sk-1234567890abcdefghijklmnopqrstuvwxyz1234";' > test-secret.js
git add test-secret.js
git commit -m "test: should block this"
# EXPECTED: Commit blocked, error shown
git checkout -- test-secret.js  # Clean up
```

### Test 2: Linting
```bash
# Create file with lint error
echo 'const x = "unused"' > test-lint.ts
git add test-lint.ts
git commit -m "test: should block lint errors"
# EXPECTED: ESLint errors shown, commit blocked
git checkout -- test-lint.ts  # Clean up
```

### Test 3: Valid Commit
```bash
# Normal valid changes
git add src/some-file.ts
git commit -m "feat: valid change"
# EXPECTED: All checks pass, commit succeeds
```

---

## 🛡️ Security Considerations

### What This Prevents:
- ✅ Accidental commits of API keys
- ✅ Commits of `.env` files
- ✅ Private keys in code
- ✅ Passwords in comments
- ✅ AWS/Azure/GCP credentials

### What It Doesn't Prevent:
- ❌ Intentional malicious commits (can bypass with effort)
- ❌ Secrets in binary files (images, PDFs)
- ❌ Secrets in committed history (already there)

### Additional Protections:
1. **GitHub Secret Scanning** (enable in repo settings)
2. **AWS/Azure credential scanning** in CI
3. **Rotate leaked keys immediately** if bypassed
4. **.env file in .gitignore** (already done)

---

## 📋 Implementation Checklist

- [ ] Install husky + lint-staged
- [ ] Create pre-commit hook script
- [ ] Configure git-secrets with patterns
- [ ] Add Python linting to hook
- [ ] Create CI/CD workflow
- [ ] Test secret detection
- [ ] Test linting integration
- [ ] Document bypass policy
- [ ] Add setup instructions to README
- [ ] Train team on usage

---

## ❓ Questions for You

Before I implement this, please confirm:

1. **Which installation method do you prefer?**
   - A) Husky (npm-based, auto-installs for team)
   - B) Custom setup script (more control, manual install)

2. **Should I include the CI/CD workflow now, or just local hooks?**

3. **Any specific secret patterns beyond OpenAI keys?**
   - AWS keys, Google API keys, JWT tokens, etc.?

4. **Emergency contact for bypass requests?**
   - What email should be shown in error messages?

Once you confirm, I'll execute the implementation plan! 🚀
