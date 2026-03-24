# LPM CLI

The command-line interface for the Licensed Package Manager (LPM). Ships with a native Rust binary for fast installs — 9x faster than pnpm, 24x faster than npm.

## Installation

```bash
# npm (recommended — auto-downloads native binary)
npm install -g @lpm-registry/cli

# curl (standalone, no Node required)
curl -fsSL https://raw.githubusercontent.com/lpm-dev/rust-client/main/install.sh | sh
```

## Command Shortcuts

LPM provides convenient aliases for common commands:

| Shortcut                | Full Command     | Description      |
| ----------------------- | ---------------- | ---------------- |
| `lpm i`                 | `lpm install`    | Install packages |
| `lpm p`                 | `lpm publish`    | Publish package  |
| `lpm l`                 | `lpm login`      | Log in           |
| `lpm lo`                | `lpm logout`     | Log out          |
| `lpm set <key> <value>` | `lpm config set` | Set config       |

## Package Name Format

LPM uses the `@lpm.dev` scope for all packages with dot notation:

```
@lpm.dev/owner.package-name
```

Examples:

- `@lpm.dev/tolgaergin.my-utils` (personal package)
- `@lpm.dev/acme-corp.design-system` (org package)

## Commands

### Authentication

#### Login

Authenticate with the registry. Opens your browser for secure OAuth login.

```bash
lpm login
```

#### Logout

Clear stored authentication token. Optionally revoke on server and clear cache.

```bash
lpm logout
lpm logout --revoke        # Also revoke token on server
lpm logout --clear-cache   # Also clear local package cache
```

#### Check Identity

See who you are logged in as and check plan status.

```bash
lpm whoami
```

### Project Setup

#### Generate .npmrc Token (Local Dev)

Generate a 30-day read-only token for your project. Makes `npm install` work with LPM packages.

By default, LPM is configured as your default registry — all packages (LPM + npm) are fetched through LPM for faster, edge-cached installs.

```bash
lpm npmrc                  # 30-day token, proxy mode (default)
lpm npmrc --days 7         # 7-day token
lpm npmrc --days 90        # 90-day token
lpm npmrc --scoped         # Only route @lpm.dev packages through LPM
```

Automatically adds `.npmrc` to `.gitignore` to prevent token leaks.

#### Setup .npmrc (CI/CD)

Configure `.npmrc` for CI/CD environments.

```bash
lpm setup                  # Writes ${LPM_TOKEN} placeholder (proxy mode)
lpm setup --oidc           # OIDC — no secrets needed (GitHub Actions, GitLab CI)
lpm setup --scoped         # Only route @lpm.dev packages through LPM
```

For deployment platforms (Vercel, Netlify), set the `LPM_TOKEN` environment variable.

### Package Management

#### Initialize a Package

Scaffold a new package with `package.json` configured for LPM.

```bash
lpm init
```

#### Publish

Publish the current package to the registry. Automatically verifies you have the required token scope. Includes a quality score report on every publish.

```bash
lpm publish
lpm publish --check            # Run quality checks without publishing
lpm publish --min-score 80     # Block publish if quality score < 80
lpm publish --check --min-score 90  # Check only, fail if below 90 (useful in CI)
```

| Option            | Description                                                         |
| ----------------- | ------------------------------------------------------------------- |
| `--check`         | Run quality checks and display report, then exit without publishing |
| `--min-score <n>` | Set minimum quality score (0-100) required to publish               |

> **Note:** If `.lpm/skills/` exists in your package but skills aren't included in the tarball, the CLI warns you to add `.lpm` to the `files` field in package.json.

#### Install

Install packages from the registry with automatic authentication.

```bash
lpm install @lpm.dev/owner.package-name
lpm install @lpm.dev/tolgaergin.utils @lpm.dev/acme.helpers
lpm install                 # Install all @lpm.dev packages from package.json
lpm install --no-skills     # Skip fetching Agent Skills
lpm install --pm pnpm       # Use pnpm instead of npm
lpm i                       # Shortcut
```

Agent Skills are fetched by default for packages that include them.

| Option        | Description                              |
| ------------- | ---------------------------------------- |
| `--no-skills` | Skip fetching Agent Skills after install |
| `--pm <name>` | Package manager: npm (default), pnpm, yarn, bun |

Set a default package manager: `lpm config set packageManager pnpm`

#### Uninstall

Uninstall packages with automatic registry authentication.

```bash
lpm uninstall @lpm.dev/owner.package-name
lpm uninstall --pm pnpm     # Use pnpm
lpm un                      # Shortcut
```

#### Add (Source Code)

Download and extract package source code directly into your project.

```bash
# JavaScript
lpm add @lpm.dev/owner.component
lpm add @lpm.dev/tolgaergin.button --path ./src/ui/Button
lpm add @lpm.dev/owner.component --force  # Overwrite without prompting
lpm add @lpm.dev/owner.component --no-skills  # Skip fetching Agent Skills

# Swift (auto-detects project type)
lpm add @lpm.dev/acme.swift-charts
```

Agent Skills are fetched by default for packages that include them.

For Swift projects, the CLI auto-detects whether you have a `Package.swift` (SPM package) or `.xcodeproj` (Xcode app project):

- **SPM packages:** Files are copied into the appropriate `Sources/{target}/` directory. SPM auto-discovers new `.swift` files.
- **Xcode app projects:** The CLI scaffolds a local SPM package at `Packages/LPMComponents/`, copies source files, and auto-links the package in your `.xcodeproj` file. Xcode hot-reloads the change — no restart needed.

### Package Discovery

#### Search

Search for packages in the marketplace.

```bash
lpm search <query>
lpm search button --limit 50
lpm search datepicker --json
```

#### Info

Show detailed information about a package.

```bash
lpm info @lpm.dev/owner.package
lpm info @lpm.dev/tolgaergin.utils -a            # Show all versions
lpm info @lpm.dev/owner.package --all-versions
lpm info @lpm.dev/owner.package --json
```

#### Check Name

Check if a package name is available on the registry.

```bash
lpm check-name acme.new-package
lpm check-name acme.new-package --json
```

#### Quality

Show the server-side quality report for a published package. Displays the score, tier, and breakdown of all 28 checks.

```bash
lpm quality @lpm.dev/owner.package
lpm quality @lpm.dev/owner.package --json
```

### Skills

Manage Agent Skills for AI coding assistants.

#### `lpm skills validate`

Validate `.lpm/skills/*.md` files in the current directory. Checks file format, frontmatter, content, size limits, and blocked patterns. Shows quality score impact.

#### `lpm skills install [package]`

Fetch and install skills from the registry. Without a package argument, installs skills for all `@lpm.dev/*` dependencies in package.json. Saves to `.lpm/skills/{package-name}/` and adds `.lpm/skills/` to `.gitignore`.

#### `lpm skills list`

List available skills for all installed `@lpm.dev/*` packages. Shows which packages have skills, how many, and whether they're installed locally.

#### `lpm skills clean`

Remove the `.lpm/skills/` directory and all locally installed skills.

### Security & Maintenance

#### Audit

Scan dependencies for known security vulnerabilities.

```bash
lpm audit
lpm audit --level high     # Only show high+ severity
lpm audit --json           # JSON output for CI
lpm audit fix              # Attempt automatic fixes
```

#### Outdated

Check for outdated dependencies.

```bash
lpm outdated
lpm outdated --all         # Show all deps, not just outdated
lpm outdated --json        # JSON output for CI
```

#### Doctor

Check your CLI setup, connection, and configuration.

```bash
lpm doctor
```

### Configuration

#### Config

Manage CLI configuration values.

```bash
lpm config list                     # Show all config
lpm config get registry             # Get specific value
lpm config set registry https://... # Set registry URL
lpm config set timeout 60000        # Set request timeout (ms)
lpm config set retries 5            # Set max retries
lpm config delete <key>             # Reset to default
```

#### Cache

Manage local package cache.

```bash
lpm cache list   # Show cached packages with sizes
lpm cache clean  # Clear all cached packages
lpm cache path   # Show cache directory location
```

### Utilities

#### Open Dashboard

Open the dashboard or package page in your browser.

```bash
lpm open
```

#### Run npm Scripts

Forward commands to npm run.

```bash
lpm run dev           # Same as npm run dev
lpm run build         # Same as npm run build
lpm run test -- --watch  # Pass arguments through
```

#### Token Management

Rotate your authentication token.

```bash
lpm token rotate
```

### Pool Revenue

#### Pool Stats

Show your Pool earnings estimate for the current billing period. Displays per-package breakdown with install counts, weighted downloads, share percentage, and estimated earnings.

```bash
lpm pool stats
lpm pool stats --json
```

### Marketplace

#### Compare

Find comparable packages by name or category. Useful for pricing research and competitive analysis.

```bash
lpm marketplace compare "form builder"
lpm marketplace compare ui --category ui-components
lpm marketplace compare auth --limit 5
lpm marketplace compare "form builder" --json
```

#### Earnings

Show your Marketplace revenue summary including total sales, gross revenue, platform fees, and net revenue.

```bash
lpm marketplace earnings
lpm marketplace earnings --json
```

## API Reference

The CLI exports utilities for programmatic use:

```js
import {
  generateIntegrity,
  verifyIntegrity,
  runQualityChecks,
  parseLpmPackageReference,
  detectFramework,
} from "@lpm-registry/cli";
```

### Integrity

| Function                                       | Description                                        |
| ---------------------------------------------- | -------------------------------------------------- |
| `generateIntegrity(buffer, algorithm?)`        | Generate an SRI integrity hash (default: `sha512`) |
| `verifyIntegrity(buffer, expected)`            | Verify a buffer against an SRI integrity string    |
| `verifyIntegrityMultiple(buffer, integrities)` | Verify against multiple integrity strings          |
| `parseIntegrity(integrity)`                    | Parse an SRI string into `{ algorithm, digest }`   |

### Path Safety

| Function                                  | Description                                            |
| ----------------------------------------- | ------------------------------------------------------ |
| `validateComponentPath(root, path)`       | Validate a component install path stays within project |
| `validateTarballPaths(extractDir, paths)` | Check tarball entries for path traversal attacks       |
| `resolveSafePath(base, user)`             | Safely resolve a user-provided path                    |
| `sanitizeFilename(name)`                  | Strip dangerous characters from a filename             |

### Quality

| Function                                                                    | Description                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `runQualityChecks({ packageJson, readme, lpmConfig, files, unpackedSize })` | Run all 28 quality checks and return score, checks, and tier |

### Package Config

| Function                             | Description                                                |
| ------------------------------------ | ---------------------------------------------------------- |
| `parseLpmPackageReference(ref)`      | Parse `@lpm.dev/owner.pkg@version?key=val` into components |
| `readLpmConfig(dir)`                 | Read and validate `lpm.config.json` from a directory       |
| `validateLpmConfig(config)`          | Validate a parsed config object                            |
| `filterFiles(files, config, params)` | Filter file rules based on config conditions               |

### Project Utils

| Function                          | Description                                               |
| --------------------------------- | --------------------------------------------------------- |
| `detectFramework()`               | Detect the project framework (nextjs, vite, remix, astro) |
| `getDefaultPath(framework, name)` | Get the default component install path for a framework    |
| `getUserImportPrefix()`           | Get the user's import alias prefix (e.g. `@/`, `~/`)      |

## Security

LPM CLI uses secure credential storage:

- **macOS**: System Keychain
- **Windows**: Windows Credential Manager
- **Linux**: libsecret (GNOME Keyring, KWallet)

If native keychain is unavailable, credentials are stored in an encrypted file with AES-256-GCM.

## Configuration File

Configuration is stored in:

- **macOS**: `~/Library/Preferences/lpm-cli-nodejs/`
- **Windows**: `%APPDATA%/lpm-cli-nodejs/Config/`
- **Linux**: `~/.config/lpm-cli-nodejs/`

## Environment Variables

| Variable           | Description           |
| ------------------ | --------------------- |
| `DEBUG=true`       | Enable debug output   |
| `LPM_REGISTRY_URL` | Override registry URL |
| `LPM_TOKEN`        | Override auth token   |
