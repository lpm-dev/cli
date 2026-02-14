import chalk from 'chalk'
import ora from 'ora'
import { get } from '../api.js'

/**
 * Format cents to a dollar string.
 * @param {number} cents
 * @returns {string}
 */
function formatCents(cents) {
	if (!cents && cents !== 0) return '$0.00'
	return `$${(cents / 100).toFixed(2)}`
}

/**
 * Fetch and display Marketplace earnings for the authenticated user.
 *
 * @param {Object} [options]
 * @param {boolean} [options.json] - Output as JSON
 */
export async function marketplaceEarnings(options = {}) {
	const spinner = options.json ? null : ora('Fetching marketplace earnings...').start()

	try {
		const response = await get('/marketplace/earnings', {
			skipRetry: false,
			onRetry: spinner ? (attempt, max) => {
				spinner.text = `Fetching (retry ${attempt}/${max})...`
			} : undefined,
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

		console.log('')
		console.log(chalk.bold('  Marketplace Earnings'))
		console.log('')

		if (!data.totalSales) {
			console.log(chalk.dim('  No marketplace sales yet.'))
			console.log(chalk.dim('  Publish a package with Marketplace distribution to start selling.'))
			console.log('')
			return
		}

		console.log(`  ${chalk.dim('Total Sales:')}      ${data.totalSales.toLocaleString()}`)
		console.log(`  ${chalk.dim('Gross Revenue:')}    ${formatCents(data.grossRevenueCents)}`)
		console.log(`  ${chalk.dim('Platform Fees:')}    ${chalk.red(formatCents(data.platformFeesCents))}`)
		console.log(`  ${chalk.bold('Net Revenue:')}      ${chalk.green(formatCents(data.netRevenueCents))}`)
		console.log('')
	} catch (error) {
		if (spinner) spinner.fail(chalk.red('Failed to fetch marketplace earnings.'))
		if (options.json) {
			console.log(JSON.stringify({ error: error.message }))
		} else {
			console.error(chalk.red(`  ${error.message}`))
		}
		process.exit(1)
	}
}

export default marketplaceEarnings
