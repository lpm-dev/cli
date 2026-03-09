/**
 * Shared editor detection and MCP config helpers.
 *
 * Used by both `lpm mcp setup` (for the LPM registry MCP server)
 * and `lpm add` (for installing third-party MCP server packages).
 *
 * @module cli/lib/editors
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const HOME = os.homedir()

// ============================================================================
// Editor definitions
// ============================================================================

export const EDITORS = [
	{
		id: "claude-code",
		name: "Claude Code",
		globalPath: path.join(HOME, ".claude.json"),
		projectPath: ".mcp.json",
		serverKey: "mcpServers",
		detect: () =>
			fs.existsSync(path.join(HOME, ".claude")) ||
			fs.existsSync(path.join(HOME, ".claude.json")),
	},
	{
		id: "cursor",
		name: "Cursor",
		globalPath: path.join(HOME, ".cursor", "mcp.json"),
		projectPath: path.join(".cursor", "mcp.json"),
		serverKey: "mcpServers",
		detect: () => fs.existsSync(path.join(HOME, ".cursor")),
	},
	{
		id: "vscode",
		name: "VS Code",
		globalPath:
			process.platform === "darwin"
				? path.join(
						HOME,
						"Library",
						"Application Support",
						"Code",
						"User",
						"mcp.json",
					)
				: process.platform === "win32"
					? path.join(process.env.APPDATA || "", "Code", "User", "mcp.json")
					: path.join(HOME, ".config", "Code", "User", "mcp.json"),
		projectPath: path.join(".vscode", "mcp.json"),
		serverKey: "servers",
		detect: () => {
			if (process.platform === "darwin") {
				return fs.existsSync(
					path.join(HOME, "Library", "Application Support", "Code"),
				)
			}
			if (process.platform === "win32") {
				return fs.existsSync(path.join(process.env.APPDATA || "", "Code"))
			}
			return fs.existsSync(path.join(HOME, ".config", "Code"))
		},
	},
	{
		id: "claude-desktop",
		name: "Claude Desktop",
		globalPath:
			process.platform === "darwin"
				? path.join(
						HOME,
						"Library",
						"Application Support",
						"Claude",
						"claude_desktop_config.json",
					)
				: process.platform === "win32"
					? path.join(
							process.env.APPDATA || "",
							"Claude",
							"claude_desktop_config.json",
						)
					: path.join(HOME, ".config", "Claude", "claude_desktop_config.json"),
		projectPath: null,
		serverKey: "mcpServers",
		detect: () => {
			if (process.platform === "darwin") {
				return fs.existsSync(
					path.join(HOME, "Library", "Application Support", "Claude"),
				)
			}
			if (process.platform === "win32") {
				return fs.existsSync(path.join(process.env.APPDATA || "", "Claude"))
			}
			return fs.existsSync(path.join(HOME, ".config", "Claude"))
		},
	},
	{
		id: "windsurf",
		name: "Windsurf",
		globalPath: path.join(HOME, ".codeium", "windsurf", "mcp_config.json"),
		projectPath: null,
		serverKey: "mcpServers",
		detect: () => fs.existsSync(path.join(HOME, ".codeium", "windsurf")),
	},
]

// ============================================================================
// JSON file helpers
// ============================================================================

export function readJsonSafe(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"))
	} catch {
		return {}
	}
}

export function writeJson(filePath, data) {
	const dir = path.dirname(filePath)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`)
}

// ============================================================================
// MCP config helpers (generic — work with any server name)
// ============================================================================

/**
 * Add an MCP server entry to an editor config file.
 *
 * @param {string} filePath - Path to the editor's MCP config JSON
 * @param {string} serverKey - Top-level key ('mcpServers' or 'servers')
 * @param {string} serverName - Name for the server entry
 * @param {object} serverConfig - Server config (command, args, env)
 */
export function addMcpServer(filePath, serverKey, serverName, serverConfig) {
	const config = readJsonSafe(filePath)
	if (!config[serverKey]) {
		config[serverKey] = {}
	}
	config[serverKey][serverName] = serverConfig
	writeJson(filePath, config)
}

/**
 * Remove an MCP server entry from an editor config file.
 *
 * @param {string} filePath - Path to the editor's MCP config JSON
 * @param {string} serverKey - Top-level key ('mcpServers' or 'servers')
 * @param {string} serverName - Name of the server entry to remove
 * @returns {boolean} Whether the server was found and removed
 */
export function removeMcpServerEntry(filePath, serverKey, serverName) {
	if (!fs.existsSync(filePath)) return false
	const config = readJsonSafe(filePath)
	if (config[serverKey]?.[serverName]) {
		delete config[serverKey][serverName]
		writeJson(filePath, config)
		return true
	}
	return false
}

/**
 * Check if an MCP server entry exists in an editor config file.
 *
 * @param {string} filePath - Path to the editor's MCP config JSON
 * @param {string} serverKey - Top-level key ('mcpServers' or 'servers')
 * @param {string} serverName - Name of the server entry
 * @returns {boolean}
 */
export function hasMcpServer(filePath, serverKey, serverName) {
	if (!fs.existsSync(filePath)) return false
	const config = readJsonSafe(filePath)
	return !!config[serverKey]?.[serverName]
}

/**
 * Read MCP server config entry from an editor config file.
 *
 * @param {string} filePath - Path to the editor's MCP config JSON
 * @param {string} serverKey - Top-level key ('mcpServers' or 'servers')
 * @param {string} serverName - Name of the server entry
 * @returns {object|null}
 */
export function getMcpServerConfig(filePath, serverKey, serverName) {
	if (!fs.existsSync(filePath)) return null
	const config = readJsonSafe(filePath)
	return config[serverKey]?.[serverName] || null
}

/**
 * Detect installed editors.
 * @returns {Array} Array of editor definitions that are installed
 */
export function detectEditors() {
	return EDITORS.filter(e => e.detect())
}

/**
 * Shorten a path by replacing HOME with ~
 * @param {string} fullPath
 * @returns {string}
 */
export function shortPath(fullPath) {
	return fullPath.replace(HOME, "~")
}
