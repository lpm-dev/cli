# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2025-02-14

### Added
- Quality scoring system with 27 checks across 4 categories
- `lpm publish --check` and `--min-score` flags for quality gating
- `lpm add` command for shadcn-style source code delivery
- `lpm.config.json` support for configurable source packages
- Secure credential storage (OS keychain with encrypted file fallback)
- SRI integrity verification for package tarballs
- Path traversal protection for tarball extraction
- Exponential backoff retry with rate-limit handling

### Changed
- Migrated from `node-fetch` to native `fetch` (Node 18+)
- Removed unused `figlet` and `form-data` dependencies
- Updated default registry URL to `https://lpm.dev`

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
