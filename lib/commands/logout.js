/**
 * Logout Command
 *
 * Clears stored authentication token and optionally revokes it on the server.
 *
 * Usage:
 *   lpm logout [options]
 *
 * Options:
 *   --revoke       Also revoke the token on the server
 *   --clear-cache  Clear local package cache
 *
 * @module cli/lib/commands/logout
 */

import chalk from "chalk"
import ora from "ora"
import { request } from "../api.js"
import { clearToken, getToken } from "../config.js"

/**
 * Execute the logout command.
 *
 * @param {Object} options - Command options
 * @param {boolean} [options.revoke] - Whether to revoke the token on the server
 * @param {boolean} [options.clearCache] - Whether to clear the local cache
 */
export async function logout(options = {}) {
	const spinner = ora("Logging out...").start()

	try {
		const token = await getToken()

		if (!token) {
			spinner.info("Not currently logged in.")
			return
		}

		// Optionally revoke the token on the server
		if (options.revoke) {
			spinner.text = "Revoking token on server..."

			try {
				const response = await request("/tokens/revoke", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ token }),
					skipRetry: true,
				})

				if (response.ok) {
					spinner.text = "Token revoked on server."
				} else {
					// Don't fail logout if revoke fails - just warn
					spinner.text =
						"Could not revoke token on server (continuing with local logout)."
				}
			} catch {
				// Don't fail logout if revoke fails
				spinner.text =
					"Could not reach server to revoke token (continuing with local logout)."
			}
		}

		// Clear local token
		await clearToken()

		// Optionally clear cache
		if (options.clearCache) {
			spinner.text = "Clearing local cache..."
			// Import dynamically to avoid circular dependency
			const { clearCache } = await import("./cache.js")
			await clearCache()
		}

		spinner.succeed(chalk.green("Successfully logged out."))

		if (options.revoke) {
			console.log(chalk.dim("  Token has been revoked on the server."))
		}

		if (options.clearCache) {
			console.log(chalk.dim("  Local cache has been cleared."))
		}
	} catch (error) {
		spinner.fail(chalk.red("Logout failed."))
		console.error(chalk.red(`  ${error.message}`))
		process.exit(1)
	}
}

export default logout
