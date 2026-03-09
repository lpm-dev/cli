/**
 * Config Command
 *
 * Manage CLI configuration values.
 *
 * Usage:
 *   lpm config list              List all configuration values
 *   lpm config get <key>         Get a specific config value
 *   lpm config set <key> <value> Set a config value
 *   lpm config delete <key>      Delete a config value (reset to default)
 *
 * Configurable Keys:
 *   registry  - Registry URL (default: https://lpm.dev)
 *   timeout   - Request timeout in milliseconds (default: 30000)
 *   retries   - Maximum retry attempts (default: 3)
 *
 * @module cli/lib/commands/config
 */

import chalk from "chalk"
import {
	deleteConfigValue,
	getAllConfig,
	getConfigValue,
	setConfigValue,
} from "../config.js"

/**
 * List all configuration values.
 */
async function listConfig() {
	console.log(chalk.bold("\nLPM Configuration:\n"))

	const config = await getAllConfig()

	// Format and display each config value
	const entries = [
		["Registry URL", config.registryUrl],
		["Request Timeout", `${config.timeout}ms`],
		["Max Retries", config.retries],
		["Secure Storage", config.secureStorage],
		[
			"Authenticated",
			config.authenticated ? chalk.green("Yes") : chalk.dim("No"),
		],
	]

	const maxKeyLength = Math.max(...entries.map(([key]) => key.length))

	for (const [key, value] of entries) {
		const paddedKey = key.padEnd(maxKeyLength)
		console.log(`  ${chalk.cyan(paddedKey)}  ${value}`)
	}

	console.log("")
}

/**
 * Get a specific configuration value.
 * @param {string} key - The config key to get
 */
function getConfig(key) {
	const value = getConfigValue(key)

	if (value === undefined) {
		console.log(chalk.yellow(`Configuration key '${key}' is not set.`))
		return
	}

	console.log(value)
}

/**
 * Set a configuration value.
 * @param {string} key - The config key to set
 * @param {string} value - The value to set
 */
function setConfig(key, value) {
	// Validate known keys
	const numericKeys = ["timeout", "retries"]
	if (numericKeys.includes(key)) {
		const numValue = parseInt(value, 10)
		if (Number.isNaN(numValue) || numValue < 0) {
			console.error(chalk.red(`Error: '${key}' must be a positive number.`))
			process.exit(1)
		}
	}

	// Validate registry URL
	if (key === "registry" || key === "registryUrl") {
		try {
			new URL(value)
		} catch {
			console.error(chalk.red(`Error: '${value}' is not a valid URL.`))
			process.exit(1)
		}
	}

	const success = setConfigValue(key, value)

	if (success) {
		console.log(chalk.green(`Set ${key} = ${value}`))
	} else {
		console.error(chalk.red(`Failed to set '${key}'.`))
		process.exit(1)
	}
}

/**
 * Delete a configuration value (reset to default).
 * @param {string} key - The config key to delete
 */
function deleteConfig(key) {
	const success = deleteConfigValue(key)

	if (success) {
		console.log(chalk.green(`Reset '${key}' to default value.`))
	} else {
		console.error(chalk.red(`Failed to delete '${key}'.`))
		process.exit(1)
	}
}

/**
 * Execute the config command.
 *
 * @param {string} action - The action to perform (list, get, set, delete)
 * @param {string} [key] - The config key
 * @param {string} [value] - The value to set
 */
export async function config(action, key, value) {
	switch (action) {
		case "list":
		case undefined:
			await listConfig()
			break

		case "get":
			if (!key) {
				console.error(chalk.red("Error: Key required."))
				console.log(chalk.dim("Usage: lpm config get <key>"))
				process.exit(1)
			}
			getConfig(key)
			break

		case "set":
			if (!key || value === undefined) {
				console.error(chalk.red("Error: Key and value required."))
				console.log(chalk.dim("Usage: lpm config set <key> <value>"))
				process.exit(1)
			}
			setConfig(key, value)
			break

		case "delete":
		case "rm":
		case "remove":
			if (!key) {
				console.error(chalk.red("Error: Key required."))
				console.log(chalk.dim("Usage: lpm config delete <key>"))
				process.exit(1)
			}
			deleteConfig(key)
			break

		default:
			console.error(chalk.red(`Unknown action: ${action}`))
			console.log(chalk.dim("Available actions: list, get, set, delete"))
			process.exit(1)
	}
}

export default config
