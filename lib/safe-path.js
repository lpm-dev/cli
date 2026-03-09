/**
 * Safe Path Resolution
 *
 * Provides path traversal protection for file operations.
 * Ensures all paths stay within a designated base directory.
 *
 * @module cli/lib/safe-path
 */

import { isAbsolute, normalize, relative, resolve } from "node:path"
import { ERROR_MESSAGES } from "./constants.js"

/**
 * Resolve a path safely within a base directory.
 * Prevents path traversal attacks using ../ sequences or absolute paths.
 *
 * @param {string} basePath - The base directory (must be absolute)
 * @param {string} userPath - The user-provided path to resolve
 * @returns {{ safe: boolean, resolvedPath?: string, error?: string }}
 */
export function resolveSafePath(basePath, userPath) {
	// Base path must be absolute
	if (!isAbsolute(basePath)) {
		return {
			safe: false,
			error: "Base path must be absolute",
		}
	}

	// Reject absolute paths from user input
	if (isAbsolute(userPath)) {
		return {
			safe: false,
			error: ERROR_MESSAGES.pathTraversal,
		}
	}

	// Normalize the base path
	const normalizedBase = normalize(basePath)

	// Resolve the full path
	const resolvedPath = resolve(normalizedBase, userPath)

	// Normalize the resolved path
	const normalizedResolved = normalize(resolvedPath)

	// Check if resolved path is within base
	const relativePath = relative(normalizedBase, normalizedResolved)

	// Path is outside base if:
	// 1. It starts with '..' (goes above base)
	// 2. It's an absolute path (on Windows, this can happen with drive changes)
	if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
		return {
			safe: false,
			error: ERROR_MESSAGES.pathTraversal,
		}
	}

	return {
		safe: true,
		resolvedPath: normalizedResolved,
	}
}

/**
 * Check if a path contains dangerous patterns.
 * This is a quick check before more expensive resolution.
 *
 * @param {string} userPath - The path to check
 * @returns {boolean} - True if the path looks dangerous
 */
export function hasDangerousPatterns(userPath) {
	if (!userPath || typeof userPath !== "string") {
		return true
	}

	// Dangerous patterns
	const dangerousPatterns = [
		// Null bytes (can bypass checks in some systems)
		"\0",
		// Windows drive letters
		/^[a-zA-Z]:/,
		// UNC paths
		/^\\\\|^\/\//,
		// Excessive parent traversal
		/\.\.[/\\]\.\.[/\\]\.\.[/\\]/,
		// Hidden files/directories (optional, depends on use case)
		// /\/\./,
	]

	for (const pattern of dangerousPatterns) {
		if (typeof pattern === "string") {
			if (userPath.includes(pattern)) return true
		} else {
			if (pattern.test(userPath)) return true
		}
	}

	return false
}

/**
 * Sanitize a filename by removing or replacing dangerous characters.
 *
 * @param {string} filename - The filename to sanitize
 * @returns {string} - Sanitized filename
 */
export function sanitizeFilename(filename) {
	if (!filename || typeof filename !== "string") {
		return ""
	}

	return (
		filename
			// Remove null bytes
			.replace(/\0/g, "")
			// Replace path separators
			.replace(/[/\\]/g, "-")
			// Remove other dangerous characters
			.replace(/[<>:"|?*]/g, "")
			// Collapse multiple dashes
			.replace(/-+/g, "-")
			// Trim dashes from ends
			.replace(/^-+|-+$/g, "")
			// Limit length
			.slice(0, 255)
	)
}

/**
 * Validate a package component path.
 * Used by the `lpm add` command to ensure extracted files stay in bounds.
 *
 * @param {string} projectRoot - The project root directory
 * @param {string} componentPath - The path where the component should be extracted
 * @returns {{ valid: boolean, resolvedPath?: string, error?: string }}
 */
export function validateComponentPath(projectRoot, componentPath) {
	// Quick dangerous pattern check
	if (hasDangerousPatterns(componentPath)) {
		return {
			valid: false,
			error: ERROR_MESSAGES.pathTraversal,
		}
	}

	// Full path resolution and validation
	const result = resolveSafePath(projectRoot, componentPath)

	return {
		valid: result.safe,
		resolvedPath: result.resolvedPath,
		error: result.error,
	}
}

/**
 * Validate each file path in a tarball before extraction.
 * Prevents zip slip attacks.
 *
 * @param {string} extractDir - The extraction directory
 * @param {string[]} filePaths - Array of file paths from the tarball
 * @returns {{ valid: boolean, invalidPaths: string[] }}
 */
export function validateTarballPaths(extractDir, filePaths) {
	const invalidPaths = []

	for (const filePath of filePaths) {
		const result = resolveSafePath(extractDir, filePath)
		if (!result.safe) {
			invalidPaths.push(filePath)
		}
	}

	return {
		valid: invalidPaths.length === 0,
		invalidPaths,
	}
}
