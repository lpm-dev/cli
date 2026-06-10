# LPM — The Package Manager for Modern Software

> This repository is retained as the legacy JavaScript CLI source archive.
> The published `@lpm-registry/cli` npm package now lives in
> [`lpm-dev/rust-client/npm/cli`](https://github.com/lpm-dev/rust-client/tree/main/npm/cli)
> and is released by the Rust client's release workflow. Do not publish this
> repository to npm.

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

## About This Repository

This repository contains the retired JavaScript CLI implementation. Current CLI
functionality is provided by the Rust client — see
[lpm-dev/rust-client](https://github.com/lpm-dev/rust-client) for full
documentation, benchmarks, and the complete command reference.

The npm package name remains active as the public install gateway, but it is no
longer published from this repository.

## Quick Start

```bash
lpm login                      # Authenticate
lpm install                    # Install deps (aliases: i)
lpm publish                    # Publish to lpm.dev (aliases: p)
lpm dev                        # Zero-config dev server + HTTPS + tunnel
```

## Commands

See the full command reference at [github.com/lpm-dev/rust-client](https://github.com/lpm-dev/rust-client#commands).

## Legacy API Exports

The retired JavaScript package exported utilities for programmatic use:

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
