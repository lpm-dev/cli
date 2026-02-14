import chalk from 'chalk'
import ora from 'ora'
import { get } from '../api.js'

/**
 * Validate the package name format.
 * Must be owner.package-name (no @lpm.dev/ prefix needed, but accepted).
 * @param {string} input
 * @returns {{ owner: string, name: string } | null}
 */
function parseName(input) {
	let cleaned = input
	if (cleaned.startsWith('@lpm.dev/')) {
		cleaned = cleaned.replace('@lpm.dev/', '')
	}
	const dotIndex = cleaned.indexOf('.')
	if (dotIndex === -1 || dotIndex === 0 || dotIndex === cleaned.length - 1) {
		return null
	}
	return {
		owner: cleaned.substring(0, dotIndex),
		name: cleaned.substring(dotIndex + 1),
	}
}

/**
 * Check if a package name is available on the LPM registry.
 *
 * @param {string} nameInput - Package name (e.g., "owner.package-name" or "@lpm.dev/owner.package-name")
 * @param {Object} [options]
 * @param {boolean} [options.json] - Output as JSON
 */
export async function checkName(nameInput, options = {}) {
	if (!nameInput || nameInput.trim() === '') {
		if (options.json) {
			console.log(JSON.stringify({ error: 'Package name required.' }))
		} else {
			console.error(chalk.red('Error: Package name required.'))
			console.log(chalk.dim('Usage: lpm check-name owner.package-name'))
		}
		process.exit(1)
	}

	const parsed = parseName(nameInput.trim())
	if (!parsed) {
		if (options.json) {
			console.log(JSON.stringify({ error: 'Invalid package name format. Use: owner.package-name' }))
		} else {
			console.error(chalk.red('Error: Invalid package name format.'))
			console.log(chalk.dim('Expected: owner.package-name'))
			console.log(chalk.dim('Example: lpm check-name tolgaergin.my-utils'))
		}
		process.exit(1)
	}

	const fullName = `@lpm.dev/${parsed.owner}.${parsed.name}`
	const spinner = options.json ? null : ora(`Checking availability of ${fullName}...`).start()

	try {
		const queryName = `${parsed.owner}.${parsed.name}`
		const response = await get(`/check-name?name=${encodeURIComponent(queryName)}`, {
			onRetry: spinner ? (attempt, max) => {
				spinner.text = `Checking (retry ${attempt}/${max})...`
			} : undefined,
		})

		const data = await response.json().catch(() => ({}))

		if (!response.ok) {
			throw new Error(data.error || `Unexpected response: ${response.status}`)
		}

		if (options.json) {
			console.log(JSON.stringify(data, null, 2))
			return
		}

		if (data.available) {
			spinner.succeed(chalk.green(`${fullName} is available!`))
			if (!data.ownerExists) {
				console.log(chalk.yellow(`  Note: Owner "${parsed.owner}" doesn't exist yet. You'll need to create this account first.`))
			}
		} else {
			spinner.fail(chalk.red(`${fullName} is already taken.`))
		}
	} catch (error) {
		if (spinner) spinner.fail(chalk.red('Failed to check name availability.'))
		if (options.json) {
			console.log(JSON.stringify({ error: error.message }))
		} else {
			console.error(chalk.red(`  ${error.message}`))
		}
		process.exit(1)
	}
}

export default checkName
