#!/usr/bin/env node

/**
 * LPM CLI Entry Point — Minimal fallback wrapper.
 *
 * In most cases, this file has been replaced by a hard link to the native
 * Rust binary during postinstall (zero Node.js overhead). This JS wrapper
 * only runs when:
 *
 * 1. Hard-link failed (cross-device mount, permissions)
 * 2. npm rebuild recreated the symlink
 * 3. Binary download failed during postinstall
 *
 * Resolution order:
 * 1. Try platform package binary (optionalDependencies)
 * 2. Try lpm-bin in bin/ directory (GitHub Releases download)
 * 3. Fall through to JS CLI implementation
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// ─── Try native binary (Tier 1: platform package) ──────────────────

const PLATFORMS = {
	"darwin-arm64": { pkg: "@lpm-registry/cli-darwin-arm64", binary: "lpm" },
	"darwin-x64": { pkg: "@lpm-registry/cli-darwin-x64", binary: "lpm" },
	"linux-x64": { pkg: "@lpm-registry/cli-linux-x64", binary: "lpm" },
	"linux-arm64": { pkg: "@lpm-registry/cli-linux-arm64", binary: "lpm" },
	"win32-x64": { pkg: "@lpm-registry/cli-win32-x64", binary: "lpm.exe" },
}

// Allow override via environment variable (for debugging / custom builds)
const envBinary = process.env.LPM_BINARY_PATH
if (envBinary && fs.existsSync(envBinary)) {
	runBinary(envBinary)
}

// Try platform package from optionalDependencies
const platform = `${process.platform}-${os.arch()}`
const platformInfo = PLATFORMS[platform]

if (platformInfo) {
	try {
		const pkgJsonPath = require.resolve(`${platformInfo.pkg}/package.json`)
		const binaryPath = path.join(path.dirname(pkgJsonPath), platformInfo.binary)
		if (fs.existsSync(binaryPath)) {
			runBinary(binaryPath)
		}
	} catch {
		// Package not installed
	}
}

// ─── Try native binary (Tier 2: downloaded by postinstall) ─────────

const legacyBinaryName =
	process.platform === "win32" ? "lpm-bin.exe" : "lpm-bin"
const legacyBinaryPath = path.join(__dirname, legacyBinaryName)

if (fs.existsSync(legacyBinaryPath)) {
	runBinary(legacyBinaryPath)
}

// ─── JS CLI fallback (Tier 3) ──────────────────────────────────────

import { Command } from "commander"
import updateNotifier from "update-notifier"
import { add } from "../lib/commands/add.js"
import { audit } from "../lib/commands/audit.js"
import { cache } from "../lib/commands/cache.js"
import { checkName } from "../lib/commands/check-name.js"
import { config } from "../lib/commands/config.js"
import { doctor } from "../lib/commands/doctor.js"
import { info } from "../lib/commands/info.js"
import { init } from "../lib/commands/init.js"
import { install } from "../lib/commands/install.js"
import { login } from "../lib/commands/login.js"
import { logout } from "../lib/commands/logout.js"
import { marketplaceCompare } from "../lib/commands/marketplace-compare.js"
import { marketplaceEarnings } from "../lib/commands/marketplace-earnings.js"
import { mcpRemove, mcpSetup, mcpStatus } from "../lib/commands/mcp-setup.js"
import { npmrc } from "../lib/commands/npmrc.js"
import { openDashboard } from "../lib/commands/open.js"
import { outdated } from "../lib/commands/outdated.js"
import { poolStats } from "../lib/commands/pool-stats.js"
import { publish } from "../lib/commands/publish.js"
import { quality } from "../lib/commands/quality.js"
import { remove } from "../lib/commands/remove.js"
import { run } from "../lib/commands/run.js"
import { search } from "../lib/commands/search.js"
import { setup } from "../lib/commands/setup.js"
import {
	skillsClean,
	skillsInstall,
	skillsList,
	skillsValidate,
} from "../lib/commands/skills.js"
import { rotateToken } from "../lib/commands/token-rotate.js"
import { uninstall } from "../lib/commands/uninstall.js"
import { whoami } from "../lib/commands/whoami.js"

// Load package.json
const pkg = JSON.parse(
	fs.readFileSync(path.join(__dirname, "../package.json"), "utf-8"),
)

// Check for updates
updateNotifier({ pkg }).notify()

const program = new Command()

program
	.name("lpm")
	.description("CLI for Licensed Package Manager")
	.version(pkg.version)

// Authentication
program
	.command("login")
	.alias("l")
	.description("Authenticate with the registry")
	.action(login)
program
	.command("logout")
	.alias("lo")
	.description("Clear stored authentication token")
	.option("--revoke", "Also revoke the token on the server")
	.option("--clear-cache", "Clear local package cache")
	.action(logout)
program
	.command("whoami")
	.description("Check current authenticated user")
	.option("--json", "Output in JSON format")
	.action(whoami)

// Package Management
program
	.command("init")
	.description("Interactively create a package.json for LPM")
	.action(init)
program
	.command("install [packages...]")
	.alias("i")
	.description("Install packages")
	.option("--json", "Machine-readable JSON output")
	.option("--no-skills", "Skip fetching Agent Skills")
	.option("--pm <manager>", "Package manager to use")
	.action(install)
program
	.command("uninstall <packages...>")
	.aliases(["un", "unlink"])
	.description("Uninstall packages")
	.option("--pm <manager>", "Package manager to use")
	.action(uninstall)
program
	.command("publish")
	.alias("p")
	.description("Publish a package to the registry")
	.option("--check", "Quality check only")
	.option("--min-score <score>", "Minimum quality score")
	.option("--provenance", "Force OIDC provenance")
	.option("--dry-run", "Preview without publishing")
	.action(publish)
program
	.command("add <package>")
	.description("Extract package source code")
	.option("-p, --path <path>", "Target directory")
	.option("-f, --force", "Overwrite existing files")
	.option("-y, --yes", "Accept defaults")
	.option("--alias <alias>", "Import alias prefix")
	.option("--target <name>", "Swift SPM target")
	.option("--json", "JSON output")
	.option("--dry-run", "Preview only")
	.action(add)
program
	.command("remove <package>")
	.alias("rm")
	.description("Remove a previously added package")
	.action(remove)

// Discovery
program
	.command("search <query>")
	.description("Search packages")
	.option("--limit <n>", "Max results", "20")
	.option("--json", "JSON output")
	.action((q, o) => search(q, { ...o, limit: parseInt(o.limit, 10) }))
program
	.command("info <package>")
	.description("Package info")
	.option("--json", "JSON output")
	.option("-a, --all-versions", "Show all versions")
	.action(info)
program
	.command("check-name <name>")
	.description("Check name availability")
	.option("--json", "JSON output")
	.action(checkName)
program
	.command("quality <package>")
	.description("Quality report")
	.option("--json", "JSON output")
	.action(quality)

// Maintenance
program
	.command("audit [action]")
	.description("Security audit")
	.option("--json", "JSON output")
	.option("--level <level>", "Minimum severity")
	.action(audit)
program
	.command("outdated")
	.description("Check outdated deps")
	.option("--json", "JSON output")
	.option("--all", "Show all deps")
	.action(outdated)
program.command("doctor").description("Health check").action(doctor)

// Configuration
program
	.command("setup")
	.description("Configure .npmrc")
	.option("-r, --registry <url>", "Custom registry URL")
	.option("--oidc", "Exchange OIDC token")
	.option("--scoped", "Scoped registry only")
	.action(setup)
program
	.command("npmrc")
	.description("Generate read-only .npmrc token")
	.option("-d, --days <number>", "Token expiry days")
	.option("--scoped", "Scoped registry only")
	.action(npmrc)
program
	.command("config [action] [key] [value]")
	.description("Manage CLI config")
	.action(config)
program
	.command("set <key> <value>")
	.description('Shortcut for "lpm config set"')
	.action((k, v) => config("set", k, v))
program
	.command("cache <action>")
	.description("Manage local cache")
	.action(cache)

// Utility
program
	.command("open")
	.description("Open dashboard in browser")
	.action(openDashboard)
program
	.command("run <script>")
	.description("Run npm scripts")
	.allowUnknownOption()
	.action(run)

// Subcommands
const token = program.command("token").description("Token management")
token.command("rotate").description("Rotate token").action(rotateToken)

const pool = program.command("pool").description("Pool revenue")
pool
	.command("stats")
	.description("Pool earnings")
	.option("--json", "JSON output")
	.action(poolStats)

const mcp = program.command("mcp").description("MCP server")
mcp
	.command("setup")
	.description("Configure MCP server")
	.option("--project", "Project-level config")
	.action(mcpSetup)
mcp
	.command("remove")
	.description("Remove MCP server")
	.option("--project", "Project-level only")
	.action(mcpRemove)
mcp
	.command("status")
	.description("MCP server status")
	.option("--verbose", "Show diagnostics")
	.action(mcpStatus)

const skills = program.command("skills").description("Agent Skills")
skills
	.command("validate")
	.description("Validate skills files")
	.option("--json", "JSON output")
	.action(skillsValidate)
skills
	.command("install [package]")
	.description("Install skills")
	.option("--json", "JSON output")
	.action(skillsInstall)
skills
	.command("list")
	.description("List available skills")
	.option("--json", "JSON output")
	.action(skillsList)
skills
	.command("clean")
	.description("Remove installed skills")
	.option("--json", "JSON output")
	.action(skillsClean)

const marketplace = program.command("marketplace").description("Marketplace")
marketplace
	.command("compare <input>")
	.description("Find comparable packages")
	.option("--json", "JSON output")
	.option("--category <category>", "Filter by category")
	.option("--limit <n>", "Max results")
	.action(marketplaceCompare)
marketplace
	.command("earnings")
	.description("Revenue summary")
	.option("--json", "JSON output")
	.action(marketplaceEarnings)

program.parse()

// ─── Helper ────────────────────────────────────────────────────────

function runBinary(binaryPath) {
	try {
		execFileSync(binaryPath, process.argv.slice(2), {
			stdio: "inherit",
			env: process.env,
		})
		process.exit(0)
	} catch (err) {
		if (err.status != null) {
			process.exit(err.status)
		}
		// Binary failed to execute — fall through to JS CLI
	}
}
