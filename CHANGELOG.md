# Changelog

All notable changes to this project will be documented in this file.

## [0.6.0] - 2026-04-01

### Added

- **Platform optionalDependencies (esbuild pattern)** — Native Rust binary now delivered via platform-specific npm packages (`@lpm-registry/cli-darwin-arm64`, etc.) instead of postinstall download. npm automatically installs only the matching platform package.
- **Hard-link optimization** — Postinstall hard-links the native binary over `bin/lpm.js`, so `lpm` on PATH executes the Rust binary directly with zero Node.js overhead.
- **3-tier binary resolution** — Entry point tries: (1) platform package binary, (2) GitHub Releases download fallback, (3) JS CLI fallback. Covers `--no-optional`, cross-device mounts, and offline scenarios.
- **`LPM_BINARY_PATH` env override** — Point to a custom binary for debugging or local development.

### Changed

- **Rust binary v0.6.0** — Sigstore provenance signing, behavioral + supply-chain security tags, `lpm self-update`, `lpm tunnel`, `lpm vault`, `lpm migrate`, `lpm graph`, TUI dashboard, Xcode project editing, import rewriting enhancements, and more.
- Quality check field renamed `maxPoints` → `max_points` for consistency with registry API responses.
- `bin/lpm.js` rewritten from simple lpm-bin delegate to full 3-tier resolver with platform package support.
- `scripts/install-binary.js` rewritten with esbuild-pattern hard-link optimization.

## [0.5.0] - 2026-03-25

### Changed

- **Rust binary v0.5.0** — Updated binary with install/add separation (Swift via `lpm install`), script runner (`lpm dev`), npmrc command, update notifier, binary lockfile, and more.
- Version bump to stay in sync with Rust binary releases.

## [0.4.0] - 2026-03-24

### Added

- **Rust binary drop-in replacement** — `lpm` now automatically downloads and runs the native Rust binary on postinstall. 9x faster warm installs than pnpm, 24x faster than npm. Falls back to JS CLI if binary is unavailable.
- **GitHub Releases distribution** — Platform-specific binaries (macOS arm64/x64, Linux arm64/x64, Windows x64) hosted on GitHub Releases, downloaded automatically during `npm install -g @lpm-registry/cli`.
- **Auto-integrate Agent Skills with AI editors** — After `lpm skills install`, skills are automatically wired into detected AI editor configs (Claude Code `CLAUDE.md`, Cursor `.cursorrules`, etc.). Use `--no-editor-setup` to skip.
- **`--no-editor-setup` flag** for `lpm install` and `lpm skills install` — Skip auto-configuring AI editor integration for skills.

### Changed

- Binary download URL updated from `lpm.dev/releases` to GitHub Releases (`github.com/lpm-dev/rust-client/releases`)
- Skills install now passes `editorSetup` option through from `lpm install` to `lpm skills install`
- Fixed unused variable lint warning in `bin/lpm.js`

## [0.3.0] - 2026-03-22

### Added

- **Upstream npm proxy mode (default)** — `lpm npmrc` and `lpm setup` now configure LPM as the default registry. All packages (LPM + npm) are fetched through LPM for faster, edge-cached installs via Cloudflare R2.
- **`--scoped` flag** — Use `lpm npmrc --scoped` or `lpm setup --scoped` to only route `@lpm.dev` packages through LPM (old behavior).
- **Custom registry detection** — If `.npmrc` already has a custom default registry (e.g., Artifactory), the CLI warns and automatically falls back to `--scoped` mode to avoid overriding it.
- **Pre-publish skills staleness warning** — When Agent Skills haven't changed since the previous version, the warning now appears before the publish confirmation prompt (instead of after), so you can cancel and update skills before publishing.

### Changed

- `lpm npmrc` default output changed from `@lpm.dev:registry=...` (scoped) to `registry=...` (proxy mode)
- `lpm setup` and `lpm setup --oidc` default output changed to proxy mode
- Updated CLI output messaging to indicate proxy vs scoped mode
- Updated README with new default behavior and `--scoped` flag

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
