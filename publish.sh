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

DRY_RUN=false
for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=true ;;
		--help|-h)
			echo "Usage: ./publish.sh [--dry-run]"
			echo ""
			echo "Lint, test, and publish @lpm-registry/cli to npm."
			echo "  --dry-run   Run everything but skip the actual npm publish"
			exit 0
			;;
		*) fail "Unknown flag: $arg" ;;
	esac
done

NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")

info "$NAME@$VERSION"

# Check npm auth
info "Checking npm auth..."
if ! npm whoami &>/dev/null; then
	fail "Not logged in to npm. Run 'npm login' first."
fi
ok "Logged in as $(npm whoami)"

# Lint
info "Linting..."
npm run lint || fail "Lint failed"
ok "Lint passed"

# Test
info "Testing..."
npm test || fail "Tests failed"
ok "Tests passed"

# Publish
if [ "$DRY_RUN" = true ]; then
	warn "Dry run — skipping publish"
	npm publish --access public --dry-run
else
	info "Publishing $NAME@$VERSION..."
	npm publish --access public
	ok "Published $NAME@$VERSION"
fi
