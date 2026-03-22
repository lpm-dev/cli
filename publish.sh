#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓ $1${NC}"; }
info() { echo -e "${BOLD}$1${NC}"; }
warn() { echo -e "${YELLOW}$1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

BUMP="${1:-}"

case "$BUMP" in
	patch|minor|major) ;;
	--help|-h)
		echo "Usage: ./publish.sh <patch|minor|major>"
		echo ""
		echo "Lint, test, bump version, commit, tag, push — GitHub Actions publishes to npm."
		echo ""
		echo "  patch   1.0.0 → 1.0.1"
		echo "  minor   1.0.0 → 1.1.0"
		echo "  major   1.0.0 → 2.0.0"
		exit 0
		;;
	"") fail "Usage: ./publish.sh <patch|minor|major>" ;;
	*) fail "Unknown argument: $BUMP. Use patch, minor, or major." ;;
esac

# Check for clean git state
if [ -n "$(git status --porcelain)" ]; then
	fail "Working directory is not clean. Commit or stash changes first."
fi

NAME=$(node -p "require('./package.json').name")

# Lint
info "Linting..."
npm run lint || fail "Lint failed"
ok "Lint passed"

# Test
info "Testing..."
npm test || fail "Tests failed"
ok "Tests passed"

# Bump version
info "Bumping $BUMP version..."
npm version "$BUMP" --no-git-tag-version --silent
VERSION=$(node -p "require('./package.json').version")
ok "Version bumped to $VERSION"

# Commit + tag + push
info "Committing and pushing..."
git add package.json package-lock.json
git commit -m "$VERSION"
git tag "v$VERSION"
git push origin main --tags
ok "Pushed v$VERSION — GitHub Actions will publish to npm"

echo ""
info "$NAME@$VERSION"
echo -e "  Track: ${BOLD}https://github.com/lpm-dev/cli/actions${NC}"
