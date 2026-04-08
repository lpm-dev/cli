# LPM — The Package Manager for Modern Software

Fast, secure, all-in-one. Written in Rust.

```bash
npm install -g @lpm-registry/cli
```

<details>
<summary>Other install methods</summary>

```bash
brew tap lpm-dev/lpm && brew install lpm        # Homebrew
curl -fsSL https://lpm.dev/install.sh | sh       # Standalone
cargo install --git https://github.com/lpm-dev/rust-client lpm-cli  # Source
```

</details>

## About This Package

This npm package is a thin wrapper that downloads the native Rust binary on `postinstall`. All CLI functionality is provided by the Rust client — see [lpm-dev/rust-client](https://github.com/lpm-dev/rust-client) for full documentation, benchmarks, and the complete command reference.

If the native binary isn't available for your platform, the JS fallback CLI activates automatically.

## Quick Start

```bash
lpm login                      # Authenticate
lpm install                    # Install deps (aliases: i)
lpm publish                    # Publish to lpm.dev (aliases: p)
lpm dev                        # Zero-config dev server + HTTPS + tunnel
```

## Commands

See the full command reference at [github.com/lpm-dev/rust-client](https://github.com/lpm-dev/rust-client#commands).

## API Exports

This package exports utilities for programmatic use:

```js
import {
  generateIntegrity,
  verifyIntegrity,
  runQualityChecks,
  parseLpmPackageReference,
  detectFramework,
} from "@lpm-registry/cli";
```

| Function | Description |
| --- | --- |
| `generateIntegrity(buffer, algorithm?)` | Generate an SRI integrity hash (default: `sha512`) |
| `verifyIntegrity(buffer, expected)` | Verify a buffer against an SRI integrity string |
| `runQualityChecks({ packageJson, readme, ... })` | Run all 28 quality checks and return score, tier, and checks |
| `parseLpmPackageReference(ref)` | Parse `@lpm.dev/owner.pkg@version?key=val` into components |
| `readLpmConfig(dir)` | Read and validate `lpm.config.json` from a directory |
| `detectFramework()` | Detect the project framework (nextjs, vite, remix, astro) |

## License

MIT
