#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// ─── Try Rust binary first ──────────────────────────────────────────
const __dirname_early = path.dirname(fileURLToPath(import.meta.url))
const binaryName = process.platform === "win32" ? "lpm-bin.exe" : "lpm-bin"
const binaryPath = path.join(__dirname_early, binaryName)

if (fs.existsSync(binaryPath)) {
	try {
		// Delegate to Rust binary with all args
		execFileSync(binaryPath, process.argv.slice(2), {
			stdio: "inherit",
			env: process.env,
		})
		process.exit(0)
	} catch (err) {
		// execFileSync throws on non-zero exit — propagate the exit code
		if (err.status != null) {
			process.exit(err.status)
		}
		// Binary failed to execute — fall through to JS CLI
	}
}

// ─── JS CLI fallback ────────────────────────────────────────────────
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
const __dirname = path.dirname(fileURLToPath(import.meta.url))
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

// ============================================================================
// Authentication Commands
// ============================================================================

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

// ============================================================================
// Package Management Commands
// ============================================================================

program
	.command("init")
	.description("Interactively create a package.json for LPM")
	.action(init)

program
	.command("install [packages...]")
	.alias("i")
	.description("Install packages with automatic registry authentication")
	.option("--json", "Machine-readable JSON output")
	.option("--no-skills", "Skip fetching Agent Skills after install")
	.option(
		"--no-editor-setup",
		"Skip auto-configuring AI editor integration for skills",
	)
	.option("--pm <manager>", "Package manager to use (npm, pnpm, yarn, bun)")
	.action(install)

program
	.command("uninstall <packages...>")
	.aliases(["un", "unlink"])
	.description("Uninstall packages via package manager")
	.option("--pm <manager>", "Package manager to use (npm, pnpm, yarn, bun)")
	.action(uninstall)

program
	.command("publish")
	.alias("p")
	.description("Publish a package to the registry")
	.option("--check", "Run quality checks and display report without publishing")
	.option(
		"--min-score <score>",
		"Minimum quality score required to publish (0-100)",
	)
	.option(
		"--provenance",
		"Force OIDC token exchange for secret-free publishing (auto-detected in GitHub Actions with id-token: write)",
	)
	.option(
		"--dry-run",
		"Validate and preview the publish (files, size, OIDC status) without uploading",
	)
	.action(publish)

program
	.command("add <package>")
	.description("Download and extract a package source code to your project")
	.option("-p, --path <path>", "Target directory for the component")
	.option("-f, --force", "Overwrite existing files without prompting")
	.option("-y, --yes", "Accept defaults, skip interactive config prompts")
	.option("--alias <alias>", "Import alias prefix (e.g., @/components/ui)")
	.option("--target <name>", "Swift SPM target name")
	.option("--install-deps", "Auto-install npm dependencies (default: true)")
	.option("--no-install-deps", "Skip npm dependency installation")
	.option("--json", "Machine-readable JSON output")
	.option("--dry-run", "Preview what would happen without writing files")
	.option("--no-skills", "Skip fetching Agent Skills after add")
	.action(add)

program
	.command("remove <package>")
	.alias("rm")
	.description(
		"Remove a previously added package (e.g., MCP servers from editors)",
	)
	.action(remove)

// ============================================================================
// Package Discovery Commands
// ============================================================================

program
	.command("search <query>")
	.description("Search for packages in the marketplace")
	.option("--limit <n>", "Maximum number of results", "20")
	.option("--json", "Output in JSON format")
	.action((query, options) =>
		search(query, { ...options, limit: parseInt(options.limit, 10) }),
	)

program
	.command("info <package>")
	.description("Show detailed information about a package")
	.option("--json", "Output in JSON format")
	.option("-a, --all-versions", "Show all versions")
	.action(info)

program
	.command("check-name <name>")
	.description("Check if a package name is available on the registry")
	.option("--json", "Output in JSON format")
	.action(checkName)

program
	.command("quality <package>")
	.description("Show the server-side quality report for a package")
	.option("--json", "Output in JSON format")
	.action(quality)

// ============================================================================
// Security & Maintenance Commands
// ============================================================================

program
	.command("audit [action]")
	.description("Scan dependencies for known vulnerabilities")
	.option("--json", "Output in JSON format")
	.option(
		"--level <level>",
		"Minimum severity to report (low, moderate, high, critical)",
	)
	.action(audit)

program
	.command("outdated")
	.description("Check for outdated dependencies")
	.option("--json", "Output in JSON format")
	.option("--all", "Show all dependencies, not just outdated ones")
	.action(outdated)

program
	.command("doctor")
	.description("Check the health of your LPM setup")
	.action(doctor)

// ============================================================================
// Configuration Commands
// ============================================================================

program
	.command("setup")
	.description("Configure .npmrc for LPM registry")
	.option("-r, --registry <url>", "Custom registry URL")
	.option(
		"--oidc",
		"Exchange CI OIDC token for install access (no secrets needed)",
	)
	.option(
		"--scoped",
		"Only route @lpm.dev packages through LPM (don't proxy npm)",
	)
	.action(setup)

program
	.command("npmrc")
	.description("Generate a read-only .npmrc token for local development")
	.option("-d, --days <number>", "Token expiry in days (default: 30)")
	.option(
		"--scoped",
		"Only route @lpm.dev packages through LPM (don't proxy npm)",
	)
	.action(npmrc)

program
	.command("config [action] [key] [value]")
	.description("Manage CLI configuration (list, get, set, delete)")
	.action(config)

program
	.command("set <key> <value>")
	.description('Shortcut for "lpm config set"')
	.action((key, value) => config("set", key, value))

program
	.command("cache <action>")
	.description("Manage local package cache (clean, list, path)")
	.action(cache)

// ============================================================================
// Utility Commands
// ============================================================================

program
	.command("open")
	.description("Open the dashboard or package page in your browser")
	.action(openDashboard)

program
	.command("run <script>")
	.description("Run npm scripts (forwards to npm run)")
	.allowUnknownOption()
	.action(run)

// ============================================================================
// Token Management (Subcommand)
// ============================================================================

const token = program
	.command("token")
	.description("Manage authentication tokens")

token
	.command("rotate")
	.description("Rotate the current token")
	.action(rotateToken)

// ============================================================================
// Pool Revenue (Subcommand)
// ============================================================================

const pool = program.command("pool").description("Pool revenue commands")

pool
	.command("stats")
	.description("Show your Pool earnings estimate for the current month")
	.option("--json", "Output in JSON format")
	.action(poolStats)

// ============================================================================
// MCP Server (Subcommand)
// ============================================================================

const mcp = program.command("mcp").description("MCP server commands")

mcp
	.command("setup")
	.description("Configure the LPM MCP server in your AI coding editors")
	.option("--project", "Add to project-level config instead of global")
	.action(mcpSetup)

mcp
	.command("remove")
	.description("Remove the LPM MCP server from all configured editors")
	.option("--project", "Remove from project-level config only")
	.action(mcpRemove)

mcp
	.command("status")
	.description("Show where the LPM MCP server is configured")
	.option("--verbose", "Show command and args diagnostics for each editor")
	.action(mcpStatus)

// ============================================================================
// Agent Skills (Subcommand)
// ============================================================================

const skills = program
	.command("skills")
	.description("Manage Agent Skills for AI coding assistants")

skills
	.command("validate")
	.description("Validate .lpm/skills/ files in the current directory")
	.option("--json", "Output in JSON format")
	.action(skillsValidate)

skills
	.command("install [package]")
	.description(
		"Fetch and install skills from the registry (all deps or specific package)",
	)
	.option("--json", "Output in JSON format")
	.option(
		"--no-editor-setup",
		"Skip auto-configuring AI editor integration for skills",
	)
	.action(skillsInstall)

skills
	.command("list")
	.description("List available skills for installed @lpm.dev/* packages")
	.option("--json", "Output in JSON format")
	.action(skillsList)

skills
	.command("clean")
	.description("Remove locally installed skills (.lpm/skills/ directory)")
	.option("--json", "Output in JSON format")
	.action(skillsClean)

// ============================================================================
// Marketplace (Subcommand)
// ============================================================================

const marketplace = program
	.command("marketplace")
	.description("Marketplace commands")

marketplace
	.command("compare <input>")
	.description("Find comparable packages by name or category")
	.option("--json", "Output in JSON format")
	.option("--category <category>", "Filter by category")
	.option("--limit <n>", "Maximum number of results")
	.action(marketplaceCompare)

marketplace
	.command("earnings")
	.description("Show your Marketplace revenue summary")
	.option("--json", "Output in JSON format")
	.action(marketplaceEarnings)

program.parse()
