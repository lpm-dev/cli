/**
 * Install Target Resolver
 *
 * Routes package types to type-specific install handlers.
 * When `lpm add` encounters a package with a `type` in lpm.config.json,
 * it delegates to the appropriate handler instead of the default file-copy flow.
 *
 * @module cli/lib/install-targets
 */

import { installMcpServer, removeMcpServer } from './install-targets/mcp-server.js'
import { installVscodeExtension, removeVscodeExtension } from './install-targets/vscode-extension.js'

/**
 * Registry of package types that have custom install behavior.
 * Types not listed here fall through to the default source file-copy flow.
 */
const INSTALL_HANDLERS = {
	'mcp-server': {
		install: installMcpServer,
		remove: removeMcpServer,
	},
	'vscode-extension': {
		install: installVscodeExtension,
		remove: removeVscodeExtension,
	},
}

/**
 * Default install target paths for package types that use the standard
 * file-copy flow but with a well-known destination.
 *
 * When a package has a type listed here and the user doesn't provide --path,
 * the CLI skips the "Where to install?" prompt and uses this default.
 *
 * If the package's files[] rules define explicit `dest` paths, targetDir is
 * set to the project root (since dest is relative to targetDir).
 * Otherwise, targetDir is set to this default path.
 */
const DEFAULT_TARGETS = {
	'cursor-rules': '.cursor/rules',
	'github-action': '.github',
}

/**
 * Check if a package type has a custom install handler.
 *
 * @param {string} type - Package type from lpm.config.json
 * @returns {boolean}
 */
export function hasCustomHandler(type) {
	return !!INSTALL_HANDLERS[type]
}

/**
 * Get the install handler for a package type.
 *
 * @param {string} type - Package type from lpm.config.json
 * @returns {{ install: Function, remove: Function } | null}
 */
export function getHandler(type) {
	return INSTALL_HANDLERS[type] || null
}

/**
 * Get the default install target path for a package type.
 *
 * Returns a path relative to the project root. Types not listed here
 * use the standard interactive prompt to determine the install path.
 *
 * @param {string} type - Package type from lpm.config.json
 * @returns {string | null} Relative path or null if no default
 */
export function getDefaultTarget(type) {
	return DEFAULT_TARGETS[type] || null
}
