/**
 * Info Command
 *
 * Display detailed information about a package.
 *
 * Usage:
 *   lpm info <package> [options]
 *
 * Options:
 *   --json      Output in JSON format
 *   --versions  Show all versions
 *
 * @module cli/lib/commands/info
 */

import chalk from "chalk"
import ora from "ora"
import { get } from "../api.js"

/**
 * Parse a package specifier.
 * @param {string} specifier - Package name (e.g., '@scope/name', 'name', 'name@1.0.0')
 * @returns {{ name: string, scope?: string, version?: string }}
 */
function parsePackageSpecifier(specifier) {
	let name = specifier
	let scope
	let version

	// Handle version specifier
	const versionMatch = name.match(/^(.+)@(\d+\.\d+\.\d+.*)$/)
	if (versionMatch) {
		name = versionMatch[1]
		version = versionMatch[2]
	}

	// Handle scope
	if (name.startsWith("@")) {
		const scopeMatch = name.match(/^@([^/]+)\/(.+)$/)
		if (scopeMatch) {
			scope = scopeMatch[1]
			name = scopeMatch[2]
		}
	}

	return { name, scope, version }
}

/**
 * Format a date for display.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
	const date = new Date(dateStr)
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	})
}

/**
 * Execute the info command.
 *
 * @param {string} packageSpec - Package specifier
 * @param {Object} options - Command options
 * @param {boolean} [options.json] - Output as JSON
 * @param {boolean} [options.versions] - Show all versions
 */
export async function info(packageSpec, options = {}) {
	if (!packageSpec || packageSpec.trim() === "") {
		console.error(chalk.red("Error: Package name required."))
		console.log(chalk.dim("Usage: lpm info <package>"))
		process.exit(1)
	}

	const { name, scope, version } = parsePackageSpecifier(packageSpec)
	const packagePath = scope ? `@${scope}/${name}` : name

	const spinner = ora(`Fetching info for ${packagePath}...`).start()

	try {
		// Registry uses NPM-compatible paths: /@scope/pkg or /@scope/pkg/version
		const url = version
			? `/${encodeURIComponent(packagePath)}/${version}`
			: `/${encodeURIComponent(packagePath)}`

		const response = await get(url, {
			onRetry: (attempt, max) => {
				spinner.text = `Fetching (retry ${attempt}/${max})...`
			},
		})

		if (!response.ok) {
			if (response.status === 404) {
				throw new Error(`Package "${packagePath}" not found.`)
			}
			const data = await response.json().catch(() => ({}))
			throw new Error(data.error || `Failed to fetch package info.`)
		}

		const pkg = await response.json()

		spinner.stop()

		if (options.json) {
			console.log(JSON.stringify(pkg, null, 2))
			return
		}

		// Get latest version data from versions object
		const latestVersionTag = pkg["dist-tags"]?.latest
		const latestVersionData = latestVersionTag
			? pkg.versions?.[latestVersionTag]
			: null

		// Display package info
		const fullName = pkg.name

		console.log("")
		console.log(
			chalk.bold.cyan(fullName) +
				chalk.dim(`@${pkg.latestVersion || latestVersionTag || "no versions"}`),
		)
		console.log("")

		if (pkg.description) {
			console.log(chalk.white(pkg.description))
			console.log("")
		}

		// Metadata table
		const metadata = [
			["Latest Version", pkg.latestVersion || latestVersionTag || "N/A"],
			["License", latestVersionData?.license || pkg.license || "N/A"],
			["Author", latestVersionData?.author || pkg.author || "N/A"],
			["Published", pkg.publishedAt ? formatDate(pkg.publishedAt) : "N/A"],
			["Downloads", (pkg.downloads ?? 0).toLocaleString()],
		]

		if (latestVersionData?.repository || pkg.repository) {
			metadata.push([
				"Repository",
				latestVersionData?.repository || pkg.repository,
			])
		}

		if (latestVersionData?.homepage || pkg.homepage) {
			metadata.push(["Homepage", latestVersionData?.homepage || pkg.homepage])
		}

		const maxKeyLength = Math.max(...metadata.map(([key]) => key.length))

		for (const [key, value] of metadata) {
			const paddedKey = key.padEnd(maxKeyLength)
			console.log(`  ${chalk.dim(paddedKey)}  ${value}`)
		}

		console.log("")

		// Dependencies from latest version
		const deps = latestVersionData?.dependencies || pkg.dependencies
		if (deps && Object.keys(deps).length > 0) {
			console.log(chalk.bold("Dependencies:"))
			for (const [dep, ver] of Object.entries(deps)) {
				console.log(`  ${chalk.cyan(dep)}  ${chalk.dim(ver)}`)
			}
			console.log("")
		}

		// Show versions if requested (versions is an object, not array)
		if (
			options.allVersions &&
			pkg.versions &&
			Object.keys(pkg.versions).length > 0
		) {
			console.log(chalk.bold("Versions:"))
			const versionList = Object.keys(pkg.versions).reverse().slice(0, 20)
			for (const v of versionList) {
				const date = pkg.time?.[v] ? formatDate(pkg.time[v]) : ""
				console.log(`  ${chalk.green(v)}  ${chalk.dim(date)}`)
			}
			if (Object.keys(pkg.versions).length > 20) {
				console.log(
					chalk.dim(
						`  ... and ${Object.keys(pkg.versions).length - 20} more versions`,
					),
				)
			}
			console.log("")
		}

		// Keywords
		const keywords = latestVersionData?.keywords || pkg.keywords
		if (keywords && keywords.length > 0) {
			console.log(
				chalk.bold("Keywords:") +
					" " +
					keywords.map(k => chalk.dim(k)).join(", "),
			)
			console.log("")
		}

		// Install hint
		console.log(chalk.dim(`Install: lpm install ${fullName}`))
		console.log("")
	} catch (error) {
		spinner.fail(chalk.red("Failed to fetch package info."))
		console.error(chalk.red(`  ${error.message}`))
		process.exit(1)
	}
}

export default info
