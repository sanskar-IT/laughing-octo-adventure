# Pre-Commit Hook System

This repository uses git pre-commit hooks to automatically check for secrets and lint errors before allowing commits.

## What It Does

- 🔐 **Secret Scanning**: Detects API keys, passwords, JWT tokens, AWS keys, and other secrets
- 📝 **ESLint**: Auto-fixes JavaScript/TypeScript linting issues
- 🐍 **Flake8**: Checks Python code style (if flake8 is installed)

## Installation

### For You (First Time Setup)

1. Install git-secrets (required for secret scanning):
   ```bash
   # macOS
   brew install git-secrets

   # Windows (Git Bash or WSL)
   git clone https://github.com/awslabs/git-secrets.git
   cd git-secrets && make install

   # Linux
   sudo apt-get install git-secrets
   ```

2. Install Python linter (optional, for Python files):
   ```bash
   pip install flake8
   ```

3. Run the setup script:
   ```bash
   npm run setup:secrets
   ```

This configures git-secrets with patterns to detect:
- OpenAI API keys (`sk-...`)
- Generic secret keys
- AWS access keys
- JWT tokens
- Password assignments
- Private key references

## How It Works

When you run `git commit`, the pre-commit hook automatically:

1. Scans staged files for secrets using git-secrets
2. Runs ESLint on staged JS/TS/JSX/TSX files (with auto-fix)
3. Runs Flake8 on staged Python files (if available)

If any check fails, the commit is **blocked** with a clear error message.

## Usage

### Normal Commit

```bash
git add .
git commit -m "your commit message"
```

The hook runs automatically. If checks pass, your commit succeeds.

### If Checks Fail

Fix the issues and try again:
```bash
# For lint errors (ESLint auto-fixes some)
npm run lint

# For secrets
# Move API keys to .env file instead of hardcoding

# Try committing again
git add .
git commit -m "your commit message"
```

## Safe Commit Wrapper (Optional)

Use the safe commit wrapper that always runs checks:

```bash
bash scripts/commit.sh -m "your commit message"
```

## Emergency Bypass

**Warning**: Bypassing pre-commit hooks is **strictly prohibited** for API key commits.

If you have a legitimate emergency:
1. Contact: admin@company.com
2. Provide justification
3. Admin will review and commit on your behalf if approved

## CI/CD Enforcement

The same checks run in GitHub Actions on every push and pull request. Even if you bypass local hooks, the CI/CD will block:

- Merging PRs with secrets
- Merging PRs with lint errors

## Troubleshooting

### "git-secrets not found"
Install git-secrets:
```bash
# macOS
brew install git-secrets

# Windows/Linux
# See: https://github.com/awslabs/git-secrets
```

### "flake8 not found" (Python linting)
Install flake8:
```bash
pip install flake8
```
This is optional - the hook will skip Python linting if flake8 is not available.

### "ESLint errors found"
Run ESLint with auto-fix:
```bash
npm run lint
```
Or manually fix the errors shown in the commit output.

## Testing

Test the hook by creating a test file with a fake secret:

```bash
echo 'const key = "sk-1234567890abcdefghijklmnopqrstuvwxyz1234";' > test-secret.js
git add test-secret.js
git commit -m "test: should block this"
```

Expected: Commit blocked with "SECRETS DETECTED" error.

Clean up:
```bash
git checkout -- test-secret.js
rm test-secret.js
```

## Patterns Blocked

The following patterns are blocked:

- `sk-[a-zA-Z0-9]{48}` - OpenAI API keys
- `sk-[a-zA-Z0-9]{20,}` - Generic secret keys
- `AKIA[0-9A-Z]{16}` - AWS access keys
- `eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+` - JWT tokens
- `api[_-]?key\s*[:=]\s*["\']?[a-zA-Z0-9_-]{20,}["\']?` - API key assignments
- `password\s*[:=]\s*["\'][^"\']{8,}["\']` - Password assignments
- `private[_-]?key` - Private key references

## Allowed Patterns

These false positives are allowed:
- `EXAMPLE_KEY`
- `YOUR_API_KEY`
- `YOUR_SECRET`
- `placeholder`
- `test_key`
- `demo_key`
- `xxxxxxxx`

Use these in documentation/examples.
