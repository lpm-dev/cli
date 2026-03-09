import chalk from "chalk"
import ora from "ora"
import { get } from "../api.js"

/**
 * Format cents to a dollar string.
 * @param {number} cents
 * @returns {string}
 */
function formatCents(cents) {
	if (!cents && cents !== 0) return "$0.00"
	return `$${(cents / 100).toFixed(2)}`
}

/**
 * Fetch and display Pool earnings statistics for the authenticated user.
 *
 * @param {Object} [options]
 * @param {boolean} [options.json] - Output as JSON
 */
export async function poolStats(options = {}) {
	const spinner = options.json
		? null
		: ora("Fetching pool statistics...").start()

	try {
		const response = await get("/pool/stats", {
			skipRetry: false,
			onRetry: spinner
				? (attempt, max) => {
						spinner.text = `Fetching (retry ${attempt}/${max})...`
					}
				: undefined,
		})

		const data = await response.json().catch(() => ({}))

		if (!response.ok) {
			throw new Error(data.error || `Request failed: ${response.status}`)
		}

		if (options.json) {
			console.log(JSON.stringify(data, null, 2))
			return
		}

		if (spinner) spinner.stop()

		const packages = data.packages || []

		console.log("")
		console.log(chalk.bold("  Pool Earnings — Current Month"))
		console.log(chalk.dim(`  Period: ${data.billingPeriod || "N/A"}`))
		console.log("")

		// Summary stats
		console.log(
			`  ${chalk.bold("Your Estimate:")}  ${chalk.green(formatCents(data.estimatedEarningsCents))}`,
		)
		console.log("")

		if (packages.length === 0) {
			console.log(chalk.dim("  No pool packages found."))
			console.log(
				chalk.dim(
					"  Publish a package with Pool distribution to start earning.",
				),
			)
			console.log("")
			return
		}

		// Table header
		const nameWidth = Math.max(30, ...packages.map(p => p.name.length + 2))
		console.log(
			`  ${chalk.dim("Package".padEnd(nameWidth))}${chalk.dim("Installs".padStart(10))}${chalk.dim("Share %".padStart(10))}${chalk.dim("Earnings".padStart(12))}`,
		)
		console.log(chalk.dim(`  ${"─".repeat(nameWidth + 32)}`))

		for (const pkg of packages) {
			const name = pkg.name.padEnd(nameWidth)
			const installs = (pkg.installCount || 0).toLocaleString().padStart(10)
			const share = `${(pkg.sharePercentage || 0).toFixed(2)}%`.padStart(10)
			const earnings = formatCents(pkg.estimatedEarningsCents).padStart(12)
			console.log(`  ${name}${installs}${share}${chalk.green(earnings)}`)
		}

		console.log("")
	} catch (error) {
		if (spinner) spinner.fail(chalk.red("Failed to fetch pool statistics."))
		if (options.json) {
			console.log(JSON.stringify({ error: error.message }))
		} else {
			console.error(chalk.red(`  ${error.message}`))
		}
		process.exit(1)
	}
}

export default poolStats
