/**
 * Cache Command
 *
 * Manage the local package cache.
 *
 * Usage:
 *   lpm cache clean   Clear all cached packages
 *   lpm cache list    Show cached packages with sizes
 *   lpm cache path    Show cache directory location
 *
 * @module cli/lib/commands/cache
 */

import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import chalk from "chalk"
import ora from "ora"
import { CACHE_DIR_NAME } from "../constants.js"

/** Full path to cache directory */
const CACHE_DIR = join(homedir(), CACHE_DIR_NAME)

/**
 * Format bytes to human-readable size.
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
	if (bytes === 0) return "0 B"

	const units = ["B", "KB", "MB", "GB"]
	const k = 1024
	const i = Math.floor(Math.log(bytes) / Math.log(k))

	return `${(bytes / k ** i).toFixed(2)} ${units[i]}`
}

/**
 * Get the size of a directory recursively.
 * @param {string} dirPath
 * @returns {number} - Total size in bytes
 */
function getDirectorySize(dirPath) {
	if (!existsSync(dirPath)) return 0

	let totalSize = 0

	const entries = readdirSync(dirPath, { withFileTypes: true })

	for (const entry of entries) {
		const fullPath = join(dirPath, entry.name)

		if (entry.isDirectory()) {
			totalSize += getDirectorySize(fullPath)
		} else if (entry.isFile()) {
			totalSize += statSync(fullPath).size
		}
	}

	return totalSize
}

/**
 * List cached packages with their sizes.
 * @param {string} dirPath
 * @param {string} [prefix='']
 * @returns {{ name: string, size: number }[]}
 */
function listCacheEntries(dirPath, prefix = "") {
	if (!existsSync(dirPath)) return []

	const entries = []
	const items = readdirSync(dirPath, { withFileTypes: true })

	for (const item of items) {
		const fullPath = join(dirPath, item.name)
		const name = prefix ? `${prefix}/${item.name}` : item.name

		if (item.isDirectory()) {
			// Check if this is a package directory (has .tgz files)
			const contents = readdirSync(fullPath)
			const hasTarballs = contents.some(f => f.endsWith(".tgz"))

			if (hasTarballs) {
				entries.push({
					name,
					size: getDirectorySize(fullPath),
					versions: contents.filter(f => f.endsWith(".tgz")).length,
				})
			} else {
				// Recurse into scope directories
				entries.push(...listCacheEntries(fullPath, name))
			}
		}
	}

	return entries
}

/**
 * Clear all cached packages.
 */
export async function clearCache() {
	const spinner = ora("Clearing cache...").start()

	try {
		if (!existsSync(CACHE_DIR)) {
			spinner.info("Cache is already empty.")
			return
		}

		const sizeBefore = getDirectorySize(CACHE_DIR)

		rmSync(CACHE_DIR, { recursive: true, force: true })

		spinner.succeed(
			chalk.green(`Cleared ${formatSize(sizeBefore)} from cache.`),
		)
	} catch (error) {
		spinner.fail(chalk.red("Failed to clear cache."))
		console.error(chalk.red(`  ${error.message}`))
		process.exit(1)
	}
}

/**
 * List cached packages.
 */
function listCachedPackages() {
	console.log(chalk.bold("\nCached Packages:\n"))

	if (!existsSync(CACHE_DIR)) {
		console.log(chalk.dim("  No packages cached."))
		console.log("")
		return
	}

	const entries = listCacheEntries(CACHE_DIR)

	if (entries.length === 0) {
		console.log(chalk.dim("  No packages cached."))
		console.log("")
		return
	}

	// Sort by size descending
	entries.sort((a, b) => b.size - a.size)

	const totalSize = entries.reduce((sum, e) => sum + e.size, 0)

	// Display each package
	const maxNameLength = Math.max(...entries.map(e => e.name.length))

	for (const entry of entries) {
		const paddedName = entry.name.padEnd(maxNameLength)
		const size = formatSize(entry.size).padStart(10)
		const versions = chalk.dim(
			`(${entry.versions} version${entry.versions > 1 ? "s" : ""})`,
		)
		console.log(`  ${chalk.cyan(paddedName)}  ${size}  ${versions}`)
	}

	console.log("")
	console.log(
		chalk.bold(
			`  Total: ${formatSize(totalSize)} in ${entries.length} package${entries.length > 1 ? "s" : ""}`,
		),
	)
	console.log("")
}

/**
 * Show cache directory path.
 */
function showCachePath() {
	console.log(CACHE_DIR)
}

/**
 * Execute the cache command.
 *
 * @param {string} action - The action to perform (clean, list, path)
 */
export async function cache(action) {
	switch (action) {
		case "clean":
		case "clear":
			await clearCache()
			break

		case "list":
		case "ls":
			listCachedPackages()
			break

		case "path":
		case "dir":
			showCachePath()
			break

		default:
			console.error(chalk.red(`Unknown action: ${action}`))
			console.log(chalk.dim("Available actions: clean, list, path"))
			process.exit(1)
	}
}

export default cache
