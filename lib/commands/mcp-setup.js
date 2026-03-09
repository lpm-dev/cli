import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as p from "@clack/prompts"
import chalk from "chalk"
import { getRegistryUrl, getToken } from "../config.js"
import { DEFAULT_REGISTRY_URL } from "../constants.js"
import {
	addMcpServer,
	EDITORS,
	getMcpServerConfig,
	hasMcpServer,
	removeMcpServerEntry,
	shortPath,
} from "../editors.js"

const SERVER_NAME = "lpm-registry"

const MCP_SERVER_PACKAGE = "@lpm-registry/mcp-server"
const THIS_FILE_DIR = path.dirname(fileURLToPath(import.meta.url))
const LOCAL_MCP_SERVER_CANDIDATES = [
	path.resolve(process.cwd(), "mcp-server", "bin", "mcp-server.js"),
	path.resolve(process.cwd(), "..", "mcp-server", "bin", "mcp-server.js"),
	path.resolve(
		THIS_FILE_DIR,
		"..",
		"..",
		"..",
		"..",
		"mcp-server",
		"bin",
		"mcp-server.js",
	),
]

function resolveNpxCommand() {
	const lookupCommand = process.platform === "win32" ? "where" : "which"
	const result = spawnSync(lookupCommand, ["npx"], { encoding: "utf-8" })

	if (result.status === 0) {
		const lines = (result.stdout || "")
			.split("\n")
			.map(line => line.trim())
			.filter(Boolean)

		if (lines.length > 0) {
			return lines[0]
		}
	}

	return "npx"
}

function getLocalMcpServerPath() {
	for (const candidate of LOCAL_MCP_SERVER_CANDIDATES) {
		if (fs.existsSync(candidate)) {
			return candidate
		}
	}

	return null
}

export function getServerConfig(registryUrl = DEFAULT_REGISTRY_URL) {
	const localServerPath = getLocalMcpServerPath()
	const hasCustomRegistry =
		typeof registryUrl === "string" &&
		registryUrl.length > 0 &&
		registryUrl !== DEFAULT_REGISTRY_URL

	const env = hasCustomRegistry ? { LPM_REGISTRY_URL: registryUrl } : undefined

	if (localServerPath) {
		return {
			command: process.execPath,
			args: [localServerPath],
			...(env ? { env } : {}),
		}
	}

	return {
		command: resolveNpxCommand(),
		args: ["-y", `${MCP_SERVER_PACKAGE}@latest`],
		...(env ? { env } : {}),
	}
}

function isCommandRunnable(command) {
	if (!command) return false

	if (path.isAbsolute(command)) {
		return fs.existsSync(command)
	}

	const lookupCommand = process.platform === "win32" ? "where" : "which"
	const result = spawnSync(lookupCommand, [command], { stdio: "ignore" })
	return result.status === 0
}

function getEditorStatus(editor, isProject = false) {
	const configPath =
		isProject && editor.projectPath
			? path.resolve(process.cwd(), editor.projectPath)
			: editor.globalPath

	const entry = getMcpServerConfig(configPath, editor.serverKey, SERVER_NAME)
	const installed = !!entry

	if (!installed) {
		return {
			editor,
			configPath,
			installed: false,
			runnable: false,
			entry: null,
		}
	}

	const command = entry.command
	const runnable = isCommandRunnable(command)

	return {
		editor,
		configPath,
		installed: true,
		runnable,
		entry,
	}
}

// ============================================================================
// Setup command
// ============================================================================

export async function mcpSetup(options = {}) {
	p.intro(chalk.bgCyan(chalk.black(" lpm mcp setup ")))
	const registryUrl = getRegistryUrl()
	const serverConfig = getServerConfig(registryUrl)

	// Check authentication and offer login
	let token = await getToken()
	if (!token) {
		const shouldLogin = await p.confirm({
			message:
				"Not logged in. Login now for full MCP functionality? (recommended)",
			initialValue: true,
		})

		if (p.isCancel(shouldLogin)) {
			p.cancel("Setup cancelled.")
			process.exit(0)
		}

		if (shouldLogin) {
			p.log.info("Opening browser for login...\n")
			const result = spawnSync("lpm", ["login"], {
				stdio: "inherit",
			})

			if (result.status === 0) {
				token = await getToken()
			} else {
				p.log.warn("Login did not complete. Continuing without authentication.")
			}
		}
	}

	const isProject = !!options.project

	// Detect installed editors
	const detected = EDITORS.filter(e => e.detect())

	if (detected.length === 0) {
		p.log.warn("No supported editors detected on this machine.")
		p.note(
			"Supported: Claude Code, Cursor, VS Code, Claude Desktop, Windsurf",
			"Supported editors",
		)
		p.outro("Install a supported editor and try again.")
		return
	}

	// Filter to editors that support project config when --project is used
	const eligible = isProject ? detected.filter(e => e.projectPath) : detected

	if (eligible.length === 0) {
		p.log.warn("No detected editors support project-level MCP config.")
		p.outro(
			`Try ${chalk.cyan("lpm mcp setup")} without --project for global setup.`,
		)
		return
	}

	// Build multiselect options
	const selectOptions = eligible.map(editor => {
		const configPath =
			isProject && editor.projectPath
				? path.resolve(process.cwd(), editor.projectPath)
				: editor.globalPath

		const installed = hasMcpServer(configPath, editor.serverKey, SERVER_NAME)

		return {
			value: editor.id,
			label: installed
				? `${editor.name} ${chalk.dim("(already configured)")}`
				: editor.name,
			hint: shortPath(configPath),
		}
	})

	const selected = await p.multiselect({
		message: isProject
			? "Add LPM MCP server to (project-level):"
			: "Add LPM MCP server to:",
		options: selectOptions,
		initialValues: selectOptions.map(o => o.value),
		required: true,
	})

	if (p.isCancel(selected)) {
		p.cancel("Setup cancelled.")
		process.exit(0)
	}

	// Write configs
	let count = 0
	for (const editorId of selected) {
		const editor = EDITORS.find(e => e.id === editorId)
		const configPath =
			isProject && editor.projectPath
				? path.resolve(process.cwd(), editor.projectPath)
				: editor.globalPath

		try {
			addMcpServer(configPath, editor.serverKey, SERVER_NAME, {
				...serverConfig,
			})
			p.log.success(`${editor.name} ${chalk.dim(shortPath(configPath))}`)
			count++
		} catch (err) {
			p.log.error(`${editor.name}: ${err.message}`)
		}
	}

	if (count > 0) {
		const authLine = token
			? `Auth: Using keychain token from ${chalk.cyan("lpm login")}`
			: `Auth: Run ${chalk.cyan("lpm login")} to enable authenticated tools`

		p.note(authLine, `Added to ${count} editor${count > 1 ? "s" : ""}`)

		if (registryUrl !== DEFAULT_REGISTRY_URL) {
			p.log.info(
				`Using custom registry URL for MCP: ${chalk.cyan(registryUrl)}`,
			)
		}
	}

	p.outro("Restart your editors to activate the MCP server.")
}

// ============================================================================
// Remove command
// ============================================================================

export async function mcpRemove(options = {}) {
	p.intro(chalk.bgCyan(chalk.black(" lpm mcp remove ")))

	const isProject = !!options.project
	let count = 0

	for (const editor of EDITORS) {
		if (isProject && !editor.projectPath) continue

		const configPath =
			isProject && editor.projectPath
				? path.resolve(process.cwd(), editor.projectPath)
				: editor.globalPath

		if (removeMcpServerEntry(configPath, editor.serverKey, SERVER_NAME)) {
			p.log.success(
				`Removed from ${editor.name} ${chalk.dim(shortPath(configPath))}`,
			)
			count++
		}
	}

	if (count === 0) {
		p.log.info("LPM MCP server was not configured in any editor.")
	}

	p.outro(
		count > 0 ? "Done. Restart your editors to apply." : "Nothing to remove.",
	)
}

// ============================================================================
// Status command
// ============================================================================

export async function mcpStatus(options = {}) {
	p.intro(chalk.bgCyan(chalk.black(" lpm mcp status ")))

	const token = await getToken()
	const isVerbose = !!options.verbose
	let found = 0
	let notRunnable = 0

	for (const editor of EDITORS) {
		const status = getEditorStatus(editor, false)
		const globalInstalled = status.installed

		if (globalInstalled) {
			if (status.runnable) {
				p.log.success(
					`${editor.name} ${chalk.dim(shortPath(editor.globalPath))}`,
				)
			} else {
				p.log.warn(
					`${editor.name} ${chalk.dim(shortPath(editor.globalPath))} ${chalk.dim("(configured, command not found)")}`,
				)
				notRunnable++
			}

			if (isVerbose) {
				const args = Array.isArray(status.entry?.args) ? status.entry.args : []
				const command = status.entry?.command || "(missing)"
				p.log.info(`  command: ${command}`)
				p.log.info(`  args: ${args.length > 0 ? args.join(" ") : "(none)"}`)
				if (!status.runnable) {
					p.log.info(
						`  hint: use ${chalk.cyan("lpm mcp setup")} again to refresh config on this machine`,
					)
				}
			}
			found++
		} else if (isVerbose) {
			p.log.info(
				`${editor.name} ${chalk.dim(shortPath(editor.globalPath))} ${chalk.dim("(not configured)")}`,
			)
		}
	}

	if (found === 0) {
		p.log.info("LPM MCP server is not configured in any editor.")
		p.note(`Run ${chalk.cyan("lpm mcp setup")} to configure it.`, "Get started")
	} else if (notRunnable > 0) {
		p.note(
			`${notRunnable} configured editor${notRunnable > 1 ? "s" : ""} have a command that is not runnable in this environment.`,
			"Action needed",
		)
	}

	const authStatus = token
		? chalk.green("Authenticated")
		: chalk.yellow(`Not logged in — run ${chalk.cyan("lpm login")}`)

	p.log.info(`Auth: ${authStatus}`)

	p.outro("")
}
