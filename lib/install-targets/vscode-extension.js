/**
 * VS Code Extension Install Target
 *
 * Handles `lpm add` for packages with `type: "vscode-extension"` in lpm.config.json.
 *
 * Instead of copying source files into the project, this handler:
 * 1. Copies the extracted package into ~/.vscode/extensions/ with the correct naming
 * 2. VS Code auto-detects the new extension on restart
 *
 * @module cli/lib/install-targets/vscode-extension
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as p from "@clack/prompts"
import chalk from "chalk"

/**
 * Get the VS Code extensions directory (cross-platform).
 * @returns {string}
 */
function getExtensionsDir() {
	return path.join(os.homedir(), ".vscode", "extensions")
}

/**
 * Derive the extension folder name from the package name and version.
 *
 * LPM format: @lpm.dev/owner.my-extension → owner.my-extension-1.0.0
 * This matches VS Code's publisher.extension-version convention.
 *
 * @param {string} pkgName - Full package reference (e.g., "@lpm.dev/owner.my-extension")
 * @param {string} version - Package version
 * @returns {string}
 */
function deriveExtensionFolderName(pkgName, version) {
	// Strip @lpm.dev/ prefix → "owner.my-extension"
	const baseName = pkgName.replace("@lpm.dev/", "")
	return `${baseName}-${version}`
}

/**
 * Recursively copy a directory.
 *
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
function copyDirRecursive(src, dest) {
	fs.mkdirSync(dest, { recursive: true })
	const entries = fs.readdirSync(src, { withFileTypes: true })

	for (const entry of entries) {
		const srcPath = path.join(src, entry.name)
		const destPath = path.join(dest, entry.name)

		if (entry.isDirectory()) {
			copyDirRecursive(srcPath, destPath)
		} else {
			fs.copyFileSync(srcPath, destPath)
		}
	}
}

/**
 * Install a VS Code extension package.
 *
 * Called by `lpm add` when the package has `type: "vscode-extension"` in lpm.config.json.
 *
 * @param {object} params
 * @param {string} params.name - Package name (e.g., "@lpm.dev/owner.my-extension")
 * @param {string} params.version - Package version
 * @param {object} params.lpmConfig - Parsed lpm.config.json
 * @param {string} params.extractDir - Temp directory with extracted package files
 * @param {object} params.options - CLI options (force, yes)
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function installVscodeExtension({
	name,
	version,
	lpmConfig: _lpmConfig,
	extractDir,
	options,
}) {
	const extensionsDir = getExtensionsDir()
	const folderName = deriveExtensionFolderName(name, version)
	const targetDir = path.join(extensionsDir, folderName)

	// Check if VS Code extensions directory exists
	if (!fs.existsSync(path.join(os.homedir(), ".vscode"))) {
		return {
			success: false,
			message:
				"VS Code not detected. Install VS Code first (no ~/.vscode directory found).",
		}
	}

	// Check for existing version
	if (fs.existsSync(targetDir)) {
		if (!options?.force && !options?.yes) {
			const overwrite = await p.confirm({
				message: `Extension ${folderName} already exists. Overwrite?`,
				initialValue: false,
			})

			if (p.isCancel(overwrite) || !overwrite) {
				return {
					success: false,
					message: "Installation cancelled.",
				}
			}
		}

		// Remove existing version
		fs.rmSync(targetDir, { recursive: true, force: true })
	}

	// Copy extension files to the extensions directory
	try {
		copyDirRecursive(extractDir, targetDir)
	} catch (err) {
		return {
			success: false,
			message: `Failed to install extension: ${err.message}`,
		}
	}

	return {
		success: true,
		message: `VS Code extension installed to ${chalk.dim(targetDir)}. Restart VS Code to activate.`,
	}
}

/**
 * Remove a VS Code extension package.
 *
 * @param {object} params
 * @param {string} params.name - Package name
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function removeVscodeExtension({ name }) {
	const extensionsDir = getExtensionsDir()
	const baseName = name.replace("@lpm.dev/", "")

	// Find matching extension folders (any version)
	if (!fs.existsSync(extensionsDir)) {
		return {
			success: true,
			message: "No VS Code extensions directory found.",
		}
	}

	const entries = fs.readdirSync(extensionsDir)
	const matching = entries.filter(e => e.startsWith(`${baseName}-`))

	if (matching.length === 0) {
		return {
			success: true,
			message: "Extension was not installed via LPM.",
		}
	}

	let count = 0
	for (const folder of matching) {
		const fullPath = path.join(extensionsDir, folder)
		try {
			fs.rmSync(fullPath, { recursive: true, force: true })
			count++
		} catch (err) {
			console.error(chalk.red(`  Failed to remove ${folder}: ${err.message}`))
		}
	}

	return {
		success: true,
		message: `Removed ${count} extension version${count > 1 ? "s" : ""}. Restart VS Code to apply.`,
	}
}
