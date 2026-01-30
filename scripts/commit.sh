#!/bin/bash
# Safe commit wrapper - always runs pre-commit checks first

echo "🔍 Running pre-commit checks..."

# Run the pre-commit hook directly
if bash .husky/pre-commit; then
    echo ""
    echo "✅ Checks passed! Creating commit..."
    echo ""
    # Run the actual commit
    git commit "$@"
else
    echo ""
    echo "❌ Checks failed. Fix issues or contact admin to override."
    exit 1
fi
