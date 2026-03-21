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
BUMP=""
for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=true ;;
		patch|minor|major) BUMP="$arg" ;;
		--help|-h)
			echo "Usage: ./publish.sh [patch|minor|major] [--dry-run]"
			echo ""
			echo "Lint, test, bump version, commit, push, and publish @lpm-registry/cli to npm."
			echo ""
			echo "  patch       Bump patch version (1.0.0 → 1.0.1)"
			echo "  minor       Bump minor version (1.0.0 → 1.1.0)"
			echo "  major       Bump major version (1.0.0 → 2.0.0)"
			echo "  --dry-run   Run lint + test but skip bump, commit, push, and publish"
			echo ""
			echo "If no bump type is given, publishes the current version in package.json."
			exit 0
			;;
		*) fail "Unknown argument: $arg" ;;
	esac
done

# Check for clean git state
if [ -n "$(git status --porcelain)" ]; then
	fail "Working directory is not clean. Commit or stash changes first."
fi

NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")

# Bump version if requested
if [ -n "$BUMP" ]; then
	info "Bumping $BUMP version..."
	npm version "$BUMP" --no-git-tag-version --silent
	VERSION=$(node -p "require('./package.json').version")
	ok "Version bumped to $VERSION"
fi

info "$NAME@$VERSION"
echo ""

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

if [ "$DRY_RUN" = true ]; then
	warn "Dry run — skipping commit, push, and publish"
	npm publish --access public --dry-run
	exit 0
fi

# Commit + tag + push (only if we bumped)
if [ -n "$BUMP" ]; then
	info "Committing version bump..."
	git add package.json
	git commit -m "$VERSION"
	git tag "v$VERSION"
	git push origin main --tags
	ok "Pushed v$VERSION to GitHub"
fi

# Publish
info "Publishing $NAME@$VERSION..."
npm publish --access public
ok "Published $NAME@$VERSION"
