/**
 * MCP Server Install Target
 *
 * Handles `lpm add` for packages with `type: "mcp-server"` in lpm.config.json.
 *
 * Instead of copying source files into the project, this handler:
 * 1. Installs the package globally (so `npx` can find it, or node can run it)
 * 2. Detects installed AI editors
 * 3. Prompts for env vars defined in mcpConfig.env
 * 4. Writes MCP server config entries to each editor
 *
 * @module cli/lib/install-targets/mcp-server
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as p from '@clack/prompts'
import chalk from 'chalk'
import {
	EDITORS,
	addMcpServer,
	removeMcpServerEntry,
	hasMcpServer,
	detectEditors,
	shortPath,
} from '../editors.js'

/**
 * Derive the MCP server name from the package name.
 * @lpm.dev/owner.my-mcp → "lpm-owner-my-mcp"
 * @param {string} pkgName - Full package reference (e.g., "@lpm.dev/owner.my-mcp")
 * @returns {string}
 */
function deriveServerName(pkgName) {
	// Strip @lpm.dev/ prefix and replace dots/slashes with dashes
	return `lpm-${pkgName.replace('@lpm.dev/', '').replace(/[./]/g, '-')}`
}

/**
 * Build the server config object from lpm.config.json's mcpConfig + user answers.
 *
 * @param {object} mcpConfig - mcpConfig from lpm.config.json
 * @param {string} pkgName - Package name for npx fallback
 * @param {object} envAnswers - User-provided env var values
 * @returns {object} MCP server config for editor JSON
 */
function buildServerConfig(mcpConfig, pkgName, envAnswers) {
	const config = {}

	if (mcpConfig?.command) {
		config.command = mcpConfig.command
		config.args = mcpConfig.args || []
	} else {
		// Fallback: use npx to run the package
		config.command = 'npx'
		config.args = [pkgName]
	}

	// Add env vars (only non-empty values)
	const env = {}
	for (const [key, value] of Object.entries(envAnswers)) {
		if (value) env[key] = value
	}
	if (Object.keys(env).length > 0) {
		config.env = env
	}

	return config
}

/**
 * Prompt user for env vars defined in mcpConfig.env.
 *
 * @param {object} envSchema - env field from mcpConfig (key → { prompt, required })
 * @returns {Promise<object>} key → value answers
 */
async function promptForEnvVars(envSchema) {
	if (!envSchema || Object.keys(envSchema).length === 0) return {}

	const answers = {}

	for (const [key, schema] of Object.entries(envSchema)) {
		const label = typeof schema === 'object' ? schema.prompt : `Enter value for ${key}`
		const required = typeof schema === 'object' ? schema.required : false

		const value = await p.text({
			message: label || `Enter value for ${key}`,
			placeholder: required ? '(required)' : '(optional, press Enter to skip)',
			validate: (val) => {
				if (required && !val?.trim()) return `${key} is required`
			},
		})

		if (p.isCancel(value)) {
			p.cancel('Installation cancelled.')
			process.exit(0)
		}

		if (value?.trim()) {
			answers[key] = value.trim()
		}
	}

	return answers
}

/**
 * Install an MCP server package into the user's AI editors.
 *
 * Called by `lpm add` when the package has `type: "mcp-server"` in lpm.config.json.
 *
 * @param {object} params
 * @param {string} params.name - Package name (e.g., "@lpm.dev/owner.my-mcp")
 * @param {string} params.version - Package version
 * @param {object} params.lpmConfig - Parsed lpm.config.json
 * @param {string} params.extractDir - Temp directory with extracted package files
 * @param {object} params.options - CLI options (force, yes)
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function installMcpServer({ name, version, lpmConfig, extractDir, options }) {
	const mcpConfig = lpmConfig?.mcpConfig || {}
	const serverName = deriveServerName(name)

	// 1. Detect installed editors
	const detected = detectEditors()

	if (detected.length === 0) {
		return {
			success: false,
			message: 'No supported AI editors detected. Install Claude Code, Cursor, VS Code, Claude Desktop, or Windsurf first.',
		}
	}

	// 2. Prompt for env vars (unless --yes)
	let envAnswers = {}
	if (mcpConfig.env && !options?.yes) {
		envAnswers = await promptForEnvVars(mcpConfig.env)
	}

	// 3. Build server config
	const serverConfig = buildServerConfig(mcpConfig, name, envAnswers)

	// 4. Let user select editors (unless --yes → all detected)
	let selectedEditors = detected

	if (!options?.yes && detected.length > 1) {
		const selectOptions = detected.map((editor) => {
			const installed = hasMcpServer(editor.globalPath, editor.serverKey, serverName)
			return {
				value: editor.id,
				label: installed
					? `${editor.name} ${chalk.dim('(will update)')}`
					: editor.name,
				hint: shortPath(editor.globalPath),
			}
		})

		const selected = await p.multiselect({
			message: 'Configure MCP server in:',
			options: selectOptions,
			initialValues: selectOptions.map((o) => o.value),
			required: true,
		})

		if (p.isCancel(selected)) {
			p.cancel('Installation cancelled.')
			process.exit(0)
		}

		selectedEditors = detected.filter((e) => selected.includes(e.id))
	}

	// 5. Write config to each editor
	let count = 0
	const configured = []

	for (const editor of selectedEditors) {
		try {
			addMcpServer(editor.globalPath, editor.serverKey, serverName, serverConfig)
			configured.push(editor.name)
			count++
		} catch (err) {
			console.error(chalk.red(`  Failed to configure ${editor.name}: ${err.message}`))
		}
	}

	if (count === 0) {
		return {
			success: false,
			message: 'Failed to configure any editors.',
		}
	}

	return {
		success: true,
		message: `MCP server configured in ${configured.join(', ')}. Restart your editors to activate.`,
	}
}

/**
 * Remove an MCP server package from the user's AI editors.
 *
 * @param {object} params
 * @param {string} params.name - Package name
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function removeMcpServer({ name }) {
	const serverName = deriveServerName(name)
	let count = 0

	for (const editor of EDITORS) {
		if (removeMcpServerEntry(editor.globalPath, editor.serverKey, serverName)) {
			count++
		}
	}

	if (count === 0) {
		return {
			success: true,
			message: 'MCP server was not configured in any editor.',
		}
	}

	return {
		success: true,
		message: `Removed MCP server from ${count} editor${count > 1 ? 's' : ''}. Restart your editors to apply.`,
	}
}
