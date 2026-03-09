/**
 * Outdated Command
 *
 * Check for outdated dependencies in the project.
 *
 * Usage:
 *   lpm outdated [options]
 *
 * Options:
 *   --json    Output in JSON format
 *   --all     Show all dependencies, not just outdated ones
 *
 * @module cli/lib/commands/outdated
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import chalk from "chalk"
import ora from "ora"
import { post } from "../api.js"

/**
 * Read and parse package.json from current directory.
 * @returns {Object | null}
 */
function readPackageJson() {
	const packageJsonPath = join(process.cwd(), "package.json")

	if (!existsSync(packageJsonPath)) {
		return null
	}

	try {
		const content = readFileSync(packageJsonPath, "utf8")
		return JSON.parse(content)
	} catch {
		return null
	}
}

/**
 * Read package-lock.json for current versions.
 * @returns {Object | null}
 */
function readPackageLock() {
	const lockPath = join(process.cwd(), "package-lock.json")

	if (!existsSync(lockPath)) {
		return null
	}

	try {
		const content = readFileSync(lockPath, "utf8")
		const lock = JSON.parse(content)
		return lock.packages || lock.dependencies || null
	} catch {
		return null
	}
}

/**
 * Compare semver versions.
 * @param {string} current
 * @param {string} latest
 * @returns {'major' | 'minor' | 'patch' | 'same' | 'unknown'}
 */
function getUpdateType(current, latest) {
	const parseVersion = v => {
		const match = v.match(/^(\d+)\.(\d+)\.(\d+)/)
		if (!match) return null
		return [
			parseInt(match[1], 10),
			parseInt(match[2], 10),
			parseInt(match[3], 10),
		]
	}

	const currentParts = parseVersion(current)
	const latestParts = parseVersion(latest)

	if (!currentParts || !latestParts) return "unknown"

	if (latestParts[0] > currentParts[0]) return "major"
	if (latestParts[1] > currentParts[1]) return "minor"
	if (latestParts[2] > currentParts[2]) return "patch"

	return "same"
}

/**
 * Get color for update type.
 * @param {string} type
 * @returns {Function}
 */
function getUpdateColor(type) {
	switch (type) {
		case "major":
			return chalk.red
		case "minor":
			return chalk.yellow
		case "patch":
			return chalk.green
		default:
			return chalk.dim
	}
}

/**
 * Execute the outdated command.
 *
 * @param {Object} options - Command options
 * @param {boolean} [options.json] - Output as JSON
 * @param {boolean} [options.all] - Show all dependencies
 */
export async function outdated(options = {}) {
	const spinner = ora("Reading dependencies...").start()

	// Read package.json
	const packageJson = readPackageJson()

	if (!packageJson) {
		spinner.fail(chalk.red("No package.json found in current directory."))
		process.exit(1)
	}

	const dependencies = {
		...(packageJson.dependencies || {}),
	}

	const devDependencies = {
		...(packageJson.devDependencies || {}),
	}

	const allDeps = { ...dependencies, ...devDependencies }
	const depCount = Object.keys(allDeps).length

	if (depCount === 0) {
		spinner.succeed(chalk.green("No dependencies to check."))
		return
	}

	// Get current versions from lock file
	const lockData = readPackageLock()

	// Build dependency list
	const depList = Object.entries(allDeps).map(([name, version]) => {
		let currentVersion = version.replace(/^[\^~]/, "")

		if (lockData) {
			const lockEntry = lockData[name] || lockData[`node_modules/${name}`]
			if (lockEntry?.version) {
				currentVersion = lockEntry.version
			}
		}

		return {
			name,
			currentVersion,
			wantedVersion: version,
			isDev: name in devDependencies,
		}
	})

	spinner.text = `Checking ${depCount} dependencies...`

	try {
		const response = await post(
			"/outdated",
			{
				dependencies: depList.map(d => ({
					name: d.name,
					version: d.currentVersion,
				})),
			},
			{
				onRetry: (attempt, max) => {
					spinner.text = `Checking (retry ${attempt}/${max})...`
				},
			},
		)

		if (!response.ok) {
			const data = await response.json().catch(() => ({}))
			throw new Error(data.error || "Outdated check failed.")
		}

		const data = await response.json()
		const latestVersions = data.packages || {}

		spinner.stop()

		// Merge latest versions with our data
		const results = depList.map(dep => {
			const latest = latestVersions[dep.name]?.latest || dep.currentVersion
			const updateType = getUpdateType(dep.currentVersion, latest)

			return {
				...dep,
				latestVersion: latest,
				updateType,
				isOutdated: updateType !== "same" && updateType !== "unknown",
			}
		})

		// Filter if not showing all
		const displayResults = options.all
			? results
			: results.filter(r => r.isOutdated)

		// JSON output
		if (options.json) {
			console.log(JSON.stringify(displayResults, null, 2))
			return
		}

		// No outdated packages
		if (displayResults.length === 0) {
			console.log(
				chalk.green(`\n✓ All ${depCount} dependencies are up to date.\n`),
			)
			return
		}

		// Display results
		const outdatedCount = results.filter(r => r.isOutdated).length
		console.log(
			chalk.bold(
				`\n${outdatedCount} outdated package${outdatedCount > 1 ? "s" : ""} in ${depCount} dependencies.\n`,
			),
		)

		// Calculate column widths
		const maxNameLen = Math.max(...displayResults.map(r => r.name.length), 10)
		const maxCurrentLen = Math.max(
			...displayResults.map(r => r.currentVersion.length),
			7,
		)
		const maxLatestLen = Math.max(
			...displayResults.map(r => r.latestVersion.length),
			6,
		)

		// Header
		console.log(
			`  ${chalk.dim("Package".padEnd(maxNameLen))}  ${chalk.dim("Current".padEnd(maxCurrentLen))}  ${chalk.dim("Latest".padEnd(maxLatestLen))}  ${chalk.dim("Type")}`,
		)
		console.log(
			chalk.dim(
				`  ${"─".repeat(maxNameLen + maxCurrentLen + maxLatestLen + 20)}`,
			),
		)

		// Rows
		for (const result of displayResults) {
			const name = result.name.padEnd(maxNameLen)
			const current = result.currentVersion.padEnd(maxCurrentLen)
			const latest = result.latestVersion.padEnd(maxLatestLen)
			const color = getUpdateColor(result.updateType)
			const devTag = result.isDev ? chalk.dim(" (dev)") : ""

			console.log(
				`  ${chalk.cyan(name)}  ${chalk.dim(current)}  ${color(latest)}  ${color(result.updateType)}${devTag}`,
			)
		}

		console.log("")

		// Summary
		const majorCount = results.filter(r => r.updateType === "major").length
		const minorCount = results.filter(r => r.updateType === "minor").length
		const patchCount = results.filter(r => r.updateType === "patch").length

		const parts = []
		if (majorCount > 0) parts.push(chalk.red(`${majorCount} major`))
		if (minorCount > 0) parts.push(chalk.yellow(`${minorCount} minor`))
		if (patchCount > 0) parts.push(chalk.green(`${patchCount} patch`))

		if (parts.length > 0) {
			console.log(
				`  ${parts.join(", ")} update${outdatedCount > 1 ? "s" : ""} available.`,
			)
			console.log("")
		}
	} catch (error) {
		spinner.fail(chalk.red("Outdated check failed."))
		console.error(chalk.red(`  ${error.message}`))
		process.exit(1)
	}
}

export default outdated
