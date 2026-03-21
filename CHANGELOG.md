# Changelog

All notable changes to this project will be documented in this file.

## [0.2.6] - 2026-03-21

### Added

- **`lpm uninstall` command** — Mirrors `npm uninstall` with automatic registry auth. Aliases: `lpm un`, `lpm unlink`.
- **`--pm` flag for install/uninstall** — Choose package manager: `lpm install --pm pnpm`. Supports npm (default), pnpm, yarn, bun.
- **`lpm config set packageManager`** — Set default package manager globally. Also available via `LPM_PACKAGE_MANAGER` env var.

### Changed

- `lpm install` now shows package list before install: "Found 15 LPM packages in package.json"
- Skills install now scoped to explicit packages when specified (`lpm install @lpm.dev/pkg` only fetches skills for that package)
- Skills install skips `file:`, `link:`, `workspace:` dependencies (local packages)
- `lpm doctor` registry check fixed — uses `/-/whoami` endpoint instead of non-existent `/health`
- Publish script updated with version bumping, git commit/tag/push, and `--dry-run` support

### Fixed

- pnpm/yarn/bun compatibility — no longer passes npm-specific `--userconfig` flag. Uses project `.npmrc` with backup/restore for non-npm package managers.

## [0.2.5] - 2026-03-19

### Added

- **`lpm npmrc` command** — Generates a 30-day read-only token and writes it to `.npmrc` for local development. Auto-adds `.npmrc` to `.gitignore`. Makes `npm install` work without env vars or manual token setup.
- **`lpm setup --oidc` flag** — Exchanges CI OIDC token (GitHub Actions, GitLab CI) for a short-lived read-only install token. Eliminates static `LPM_TOKEN` secrets in CI. Falls back to `${LPM_TOKEN}` placeholder if OIDC is unavailable.
- **OIDC read scope support** — Server-side OIDC token exchange now accepts `?scope=read` for install-only tokens (30 min TTL). Uses Supabase OAuth identity linking instead of trusted publisher config.

### Changed

- OIDC module refactored for reuse — `exchangeOidcInstallToken()` auto-detects CI environment and exchanges for read-only tokens
- `lpm setup` default mode now mentions `lpm npmrc` and `--oidc` in help output

## [0.2.4] - 2026-03-18

### Added

- **2FA support for publish** — CLI prompts for TOTP code before uploading when user or org has 2FA enabled. OIDC (CI/CD) tokens are exempt.
- **Lifecycle scripts quality check** — New `no-lifecycle-scripts` check (2pts) flags packages with `preinstall`, `install`, `postinstall`, `preuninstall`, `uninstall`, or `postuninstall` scripts

### Changed

- Quality scoring rebalanced: `small-deps` 4pts→3pts, `has-exports-map` 4pts→3pts to accommodate the new lifecycle scripts check (total remains 100)
- API client now passes through OTP-related 401/403 responses to callers instead of throwing generic auth errors

## [0.2.2] - 2026-03-16

### Added

- `publish.sh` script for automated linting, testing, and publishing to npm
- Local project scanning for test files during quality checks — authors no longer need to ship test files in the tarball to earn quality points
- Registry-scoped token storage — dev and production tokens no longer overwrite each other

### Changed

- Token storage is now scoped per registry URL with automatic migration from legacy un-scoped keys
- Quality check "Has test files" now scans the local project directory instead of only the tarball contents

## [0.2.1] - 2026-03-12

### Added

- **Swift & XCFramework ecosystem support** — quality checks, packaging, framework detection, and local package management for Apple platforms
- **OIDC token exchange** for secret-free publishing from CI/CD (GitHub Actions, GitLab CI)
- **Agent Skills management** — `lpm skills` commands for creating and managing `.lpm/skills/` packages
- `lpm remove` command for uninstalling packages
- `lpm install --json` output mode for programmatic usage
- `lpm search` now supports semantic queries
- Intellisense coverage and XCFramework size checks in quality scoring
- Node.js type definitions check in quality scoring
- Graceful HTTP server shutdown after login callback

### Changed

- Updated quality scoring metrics (28 checks for JS, 25 for Swift, 21 for XCFramework)
- Removed CI config references from quality checks
- Simplified `getDefaultPath` internals
- Removed `applyTemplateVariables` logic from config and commands
- Improved MCP setup command with server config resolution
- General code structure refactoring for readability

### Fixed

- Error handling for invalid JSON in `package.json`
- API request handling improvements

## [0.2.0] - 2025-02-14

### Added

- Quality scoring system with 27 checks across 4 categories
- `lpm publish --check` and `--min-score` flags for quality gating
- `lpm add` command for source code delivery
- `lpm.config.json` support for configurable source packages
- Secure credential storage (OS keychain with encrypted file fallback)
- SRI integrity verification for package tarballs
- Path traversal protection for tarball extraction
- Exponential backoff retry with rate-limit handling

### Changed

- Migrated from `node-fetch` to native `fetch` (Node 18+)
- Removed unused `figlet` and `form-data` dependencies

### Fixed

- Missing `await` on `setToken()` in token-rotate command
- URL construction for `@lpm.dev/owner.pkg` format in open command
- Inconsistent limit field names in doctor command

## [0.1.0] - 2024-12-01

### Added

- Initial CLI release
- `lpm login`, `lpm logout`, `lpm whoami` authentication commands
- `lpm publish`, `lpm install` package management
- `lpm search`, `lpm info` package discovery
- `lpm audit`, `lpm outdated` security and maintenance checks
- `lpm doctor` health checks
- `lpm config`, `lpm cache` configuration management
