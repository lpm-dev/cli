import chalk from "chalk"
import ora from "ora"
import { get } from "../api.js"

const TIER_COLORS = {
	excellent: chalk.green,
	good: chalk.blue,
	fair: chalk.yellow,
	"needs-work": chalk.gray,
}

const TIER_LABELS = {
	excellent: "Excellent",
	good: "Good",
	fair: "Fair",
	"needs-work": "Needs Work",
}

const CATEGORY_LABELS = {
	documentation: "Documentation",
	code: "Code Quality",
	testing: "Testing",
	health: "Package Health",
}

function progressBar(value, max, width = 18) {
	const ratio = Math.min(value / max, 1)
	const filled = Math.round(ratio * width)
	const empty = width - filled
	return chalk.cyan("█".repeat(filled)) + chalk.gray("░".repeat(empty))
}

/**
 * Parse package name input.
 * Accepts: "owner.pkg", "@lpm.dev/owner.pkg"
 * @param {string} input
 * @returns {string|null} cleaned name as "owner.pkg" or null if invalid
 */
function parseName(input) {
	let cleaned = input
	if (cleaned.startsWith("@lpm.dev/")) {
		cleaned = cleaned.replace("@lpm.dev/", "")
	}
	const dotIndex = cleaned.indexOf(".")
	if (dotIndex === -1 || dotIndex === 0 || dotIndex === cleaned.length - 1) {
		return null
	}
	return cleaned
}

const TIPS = {
	"has-readme": "Add a README.md with at least 100 characters",
	"readme-install": "Add an install/getting started section to your README",
	"readme-usage": "Add usage examples with code blocks to your README",
	"readme-api": "Add an API/reference section to your README",
	"has-changelog": "Add a CHANGELOG.md file",
	"has-license": "Add a LICENSE file",
	"has-types": 'Add TypeScript types ("types" field or .d.ts files)',
	"intellisense-coverage": "Add .d.ts type definitions or JSDoc comments",
	"esm-exports": 'Add "type": "module" or "exports" to package.json',
	"tree-shakable": 'Add "sideEffects": false to package.json',
	"no-eval": "Remove eval() and new Function() usage",
	"has-engines": 'Add "engines": { "node": ">=18" } to package.json',
	"has-exports-map": 'Add an "exports" map to package.json',
	"small-deps": "Reduce the number of production dependencies",
	"source-maps": "Include .js.map source maps for easier debugging",
	"has-test-files": "Add test files (*.test.js, *.spec.js)",
	"has-test-script": "Add a test script to package.json",
	"has-description": "Add a description (>10 chars) to package.json",
	"has-keywords": "Add keywords to package.json",
	"has-repository": "Add a repository field to package.json",
	"has-homepage": "Add a homepage field to package.json",
	"reasonable-size": "Reduce unpacked size (check for unnecessary files)",
	"no-vulnerabilities": "Fix known vulnerabilities in dependencies",
	"maintenance-health": "Publish updates regularly (within 90 days)",
	"semver-consistency": "Use valid semantic versioning (major.minor.patch)",
	"author-verified": "Link your GitHub or LinkedIn in your profile settings",
}

/**
 * Fetch and display the server-side quality report for a package.
 *
 * @param {string} nameInput - Package name (e.g., "owner.pkg" or "@lpm.dev/owner.pkg")
 * @param {Object} [options]
 * @param {boolean} [options.json] - Output as JSON
 */
export async function quality(nameInput, options = {}) {
	if (!nameInput || nameInput.trim() === "") {
		if (options.json) {
			console.log(JSON.stringify({ error: "Package name required." }))
		} else {
			console.error(chalk.red("Error: Package name required."))
			console.log(chalk.dim("Usage: lpm quality owner.package-name"))
		}
		process.exit(1)
	}

	const cleaned = parseName(nameInput.trim())
	if (!cleaned) {
		if (options.json) {
			console.log(
				JSON.stringify({
					error: "Invalid package name format. Use: owner.package-name",
				}),
			)
		} else {
			console.error(chalk.red("Error: Invalid package name format."))
			console.log(chalk.dim("Expected: owner.package-name"))
		}
		process.exit(1)
	}

	const fullName = `@lpm.dev/${cleaned}`
	const spinner = options.json
		? null
		: ora(`Fetching quality report for ${fullName}...`).start()

	try {
		const response = await get(`/quality?name=${encodeURIComponent(cleaned)}`, {
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

		// No quality data
		if (data.score === null || data.score === undefined) {
			console.log("")
			console.log(chalk.yellow(`  ${fullName}: No quality data available.`))
			console.log(
				chalk.dim("  Publish with lpm CLI v0.16+ to generate quality scores."),
			)
			console.log("")
			return
		}

		// Display quality report
		const tier = data.tier || "needs-work"
		const tierColor = TIER_COLORS[tier] || chalk.white
		const tierLabel = TIER_LABELS[tier] || tier

		console.log("")
		console.log(`  ${chalk.bold(fullName)}`)
		console.log(
			`  ${chalk.bold("Quality Score:")} ${tierColor(`${data.score}/${data.maxScore}`)} ${tierColor(`(${tierLabel})`)}`,
		)
		console.log("")

		// Category bars
		if (data.categories) {
			for (const [cat, { score: catScore, max }] of Object.entries(
				data.categories,
			)) {
				const label = (CATEGORY_LABELS[cat] || cat).padEnd(16)
				const bar = progressBar(catScore, max)
				console.log(`  ${label}${bar}  ${catScore}/${max}`)
			}
			console.log("")
		}

		// Individual checks
		if (data.checks && data.checks.length > 0) {
			for (const check of data.checks) {
				const icon = check.passed ? chalk.green("✓") : chalk.red("✗")
				const label = check.passed ? check.label : chalk.dim(check.label)
				const points = check.passed
					? chalk.dim(` ${check.points}/${check.max_points}`)
					: chalk.dim(` 0/${check.max_points}`)
				const detail = check.detail ? chalk.dim(` — ${check.detail}`) : ""
				console.log(`  ${icon} ${label}${points}${detail}`)
			}

			// Tips for failed checks
			const failed = data.checks.filter(c => !c.passed)
			if (failed.length > 0) {
				console.log("")
				const tips = failed.slice(0, 3)
				for (const check of tips) {
					const tip = TIPS[check.id] || `Improve: ${check.id}`
					console.log(chalk.dim(`  Tip: ${tip} (+${check.max_points} points)`))
				}
			}
		}

		console.log("")
	} catch (error) {
		if (spinner) spinner.fail(chalk.red("Failed to fetch quality report."))
		if (options.json) {
			console.log(JSON.stringify({ error: error.message }))
		} else {
			console.error(chalk.red(`  ${error.message}`))
		}
		process.exit(1)
	}
}

export default quality
