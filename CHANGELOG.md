# Changelog

All notable changes to this project will be documented in this file.

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
