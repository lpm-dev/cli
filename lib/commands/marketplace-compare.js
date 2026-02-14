import chalk from 'chalk'
import ora from 'ora'
import { get } from '../api.js'

/**
 * Format cents to a dollar string.
 * @param {number} cents
 * @returns {string}
 */
function formatCents(cents) {
	if (!cents && cents !== 0) return '—'
	return `$${(cents / 100).toFixed(2)}`
}

/**
 * Parse package name to extract category or clean name.
 * @param {string} input
 * @returns {{ isPackage: boolean, owner?: string, name?: string, category?: string }}
 */
function parseInput(input) {
	let cleaned = input
	if (cleaned.startsWith('@lpm.dev/')) {
		cleaned = cleaned.replace('@lpm.dev/', '')
	}
	const dotIndex = cleaned.indexOf('.')
	if (dotIndex > 0 && dotIndex < cleaned.length - 1) {
		return {
			isPackage: true,
			owner: cleaned.substring(0, dotIndex),
			name: cleaned.substring(dotIndex + 1),
		}
	}
	// Treat as category/keyword
	return { isPackage: false, category: input }
}

/**
 * Find and display comparable marketplace packages.
 *
 * @param {string} input - Package name or category
 * @param {Object} [options]
 * @param {boolean} [options.json] - Output as JSON
 * @param {string} [options.category] - Filter by category
 * @param {number} [options.limit] - Max results
 */
export async function marketplaceCompare(input, options = {}) {
	if (!input || input.trim() === '') {
		if (options.json) {
			console.log(JSON.stringify({ error: 'Package name or category required.' }))
		} else {
			console.error(chalk.red('Error: Package name or category required.'))
			console.log(chalk.dim('Usage: lpm marketplace compare owner.package-name'))
			console.log(chalk.dim('       lpm marketplace compare --category ui-components'))
		}
		process.exit(1)
	}

	const parsed = parseInput(input.trim())
	const category = options.category || (parsed.isPackage ? null : parsed.category)
	const query = parsed.isPackage ? parsed.name : null

	const params = new URLSearchParams()
	if (category) params.set('category', category)
	if (query) params.set('q', query)
	if (options.limit) params.set('limit', String(options.limit))

	const spinner = options.json ? null : ora('Fetching comparable packages...').start()

	try {
		const response = await get(`/marketplace/comparables?${params.toString()}`, {
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

		const comparables = data.comparables || []

		console.log('')
		if (category) {
			console.log(chalk.bold(`  Marketplace: ${category}`))
		} else if (parsed.isPackage) {
			console.log(chalk.bold(`  Similar to: @lpm.dev/${parsed.owner}.${parsed.name}`))
		}

		if (data.stats?.priceRange) {
			const pr = data.stats.priceRange
			console.log(chalk.dim(`  Price range: ${formatCents(pr.minCents)} — ${formatCents(pr.maxCents)} (median: ${formatCents(pr.medianCents)})`))
		}
		console.log(chalk.dim(`  ${data.stats?.total || 0} packages found`))
		console.log('')

		if (comparables.length === 0) {
			console.log(chalk.dim('  No comparable packages found.'))
			console.log('')
			return
		}

		// Table
		const nameWidth = Math.max(30, ...comparables.map(c => c.name.length + 2))
		console.log(
			`  ${chalk.dim('Package'.padEnd(nameWidth))}${chalk.dim('Price'.padStart(10))}${chalk.dim('Quality'.padStart(10))}${chalk.dim('Downloads'.padStart(12))}${chalk.dim('Mode'.padStart(14))}`,
		)
		console.log(chalk.dim(`  ${'─'.repeat(nameWidth + 46)}`))

		for (const pkg of comparables) {
			const name = pkg.name.padEnd(nameWidth)
			const price = pkg.pricing
				? formatCents(pkg.pricing.minPriceCents).padStart(10)
				: chalk.dim('Pool'.padStart(10))
			const quality = pkg.qualityScore !== null
				? `${pkg.qualityScore}/100`.padStart(10)
				: chalk.dim('—'.padStart(10))
			const downloads = (pkg.downloadCount || 0).toLocaleString().padStart(12)
			const mode = pkg.distributionMode.padStart(14)
			console.log(`  ${name}${price}${quality}${downloads}${chalk.dim(mode)}`)
		}

		console.log('')
	} catch (error) {
		if (spinner) spinner.fail(chalk.red('Failed to fetch comparable packages.'))
		if (options.json) {
			console.log(JSON.stringify({ error: error.message }))
		} else {
			console.error(chalk.red(`  ${error.message}`))
		}
		process.exit(1)
	}
}

export default marketplaceCompare
