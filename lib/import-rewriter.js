/**
 * Smart Import Rewriter for LPM Source Packages
 *
 * Resolves import specifiers against the installed file set and rewrites
 * internal imports to match the buyer's project alias setup.
 *
 * Pure-function module — no I/O, no fs, no side effects.
 * All path logic uses forward-slash (POSIX) conventions.
 *
 * @module cli/lib/import-rewriter
 */

/**
 * @typedef {Object} RewriteOptions
 * @property {string} fileDestPath - Dest-relative path of the file being processed
 * @property {Set<string>} destFileSet - All dest-relative paths being installed
 * @property {string} [fileSrcPath] - Src-relative path (for relative import resolution)
 * @property {Map<string,string>} [srcToDestMap] - Maps src paths → dest paths
 * @property {string} [authorAlias] - Author's import alias prefix (e.g., "@/")
 * @property {string} [buyerAlias] - Buyer's alias for the dest directory (e.g., "@/components/design-system")
 */

/** File extensions to try when resolving extensionless imports */
const EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"]

/**
 * Matches import/export specifiers on a single line.
 *
 * Captures:
 *   - from 'specifier' / from "specifier"
 *   - import 'specifier' / import "specifier" (side-effect)
 *   - import('specifier') / import("specifier") (dynamic)
 *   - export { x } from 'specifier'
 *
 * Groups: $1 = keyword prefix, $2 = quote char, $3 = specifier
 */
const SPECIFIER_RE = /(from\s+|import\s*\(\s*|import\s+)(['"])(.*?)\2/g

/**
 * Rewrite internal imports in file content to use the buyer's alias.
 *
 * @param {string} content - File source content
 * @param {RewriteOptions} options
 * @returns {string} Content with internal imports rewritten
 */
export function rewriteImports(content, options) {
	const {
		fileDestPath,
		destFileSet,
		fileSrcPath,
		srcToDestMap,
		authorAlias,
		buyerAlias,
	} = options

	// Nothing to do if no buyer alias (relative imports already work)
	// and no author alias to resolve
	if (!buyerAlias && !authorAlias) return content

	const fileDestDir = dirname(fileDestPath)
	const fileSrcDir = fileSrcPath ? dirname(fileSrcPath) : fileDestDir

	// Build src file set from srcToDestMap keys for author alias lookups
	const srcFileSet = srcToDestMap ? new Set(srcToDestMap.keys()) : null

	const lines = content.split("\n")
	const result = []
	let inBlockComment = false

	for (const line of lines) {
		// Track block comments (best-effort)
		if (inBlockComment) {
			if (line.includes("*/")) inBlockComment = false
			result.push(line)
			continue
		}
		if (line.trimStart().startsWith("/*")) {
			if (!line.includes("*/")) inBlockComment = true
			result.push(line)
			continue
		}
		// Skip single-line comments
		if (line.trimStart().startsWith("//")) {
			result.push(line)
			continue
		}

		result.push(
			rewriteLineImports(
				line,
				fileDestDir,
				fileSrcDir,
				destFileSet,
				srcFileSet,
				srcToDestMap,
				authorAlias,
				buyerAlias,
			),
		)
	}

	return result.join("\n")
}

/**
 * Rewrite import specifiers on a single line.
 *
 * @param {string} line
 * @param {string} fileDestDir
 * @param {string} fileSrcDir
 * @param {Set<string>} destFileSet
 * @param {Set<string>|null} srcFileSet
 * @param {Map<string,string>|null} srcToDestMap
 * @param {string} [authorAlias]
 * @param {string} [buyerAlias]
 * @returns {string}
 */
function rewriteLineImports(
	line,
	fileDestDir,
	fileSrcDir,
	destFileSet,
	srcFileSet,
	srcToDestMap,
	authorAlias,
	buyerAlias,
) {
	return line.replace(SPECIFIER_RE, (match, prefix, quote, specifier) => {
		const resolvedDestPath = resolveSpecifier(
			specifier,
			fileDestDir,
			fileSrcDir,
			destFileSet,
			srcFileSet,
			srcToDestMap,
			authorAlias,
		)

		if (!resolvedDestPath) {
			// External import or unresolvable — leave unchanged
			return match
		}

		// Internal import — compute new specifier
		const newSpecifier = computeNewSpecifier(
			resolvedDestPath,
			fileDestDir,
			buyerAlias,
		)

		if (!newSpecifier) {
			// No buyer alias and cannot compute — leave unchanged
			return match
		}

		return `${prefix}${quote}${newSpecifier}${quote}`
	})
}

/**
 * Resolve an import specifier to a dest file path if it's internal.
 *
 * @param {string} specifier - The import specifier
 * @param {string} fileDestDir - Dest directory of the importing file
 * @param {string} fileSrcDir - Src directory of the importing file
 * @param {Set<string>} destFileSet - All dest paths
 * @param {Set<string>|null} srcFileSet - All src paths (for author alias)
 * @param {Map<string,string>|null} srcToDestMap - src → dest mapping
 * @param {string} [authorAlias] - Author's import alias prefix
 * @returns {string|null} Resolved dest path, or null if external
 */
function resolveSpecifier(
	specifier,
	fileDestDir,
	fileSrcDir,
	destFileSet,
	srcFileSet,
	srcToDestMap,
	authorAlias,
) {
	// 1. Relative import: ./foo or ../bar
	if (specifier.startsWith("./") || specifier.startsWith("../")) {
		// Resolve against src directory, then map to dest
		if (srcToDestMap && srcToDestMap.size > 0) {
			const resolvedSrc = normalizePath(joinPath(fileSrcDir, specifier))
			const srcMatch = tryResolveFile(resolvedSrc, new Set(srcToDestMap.keys()))
			if (srcMatch) {
				return srcToDestMap.get(srcMatch) || null
			}
		}

		// Fallback: resolve against dest directory directly
		const resolvedDest = normalizePath(joinPath(fileDestDir, specifier))
		return tryResolveFile(resolvedDest, destFileSet)
	}

	// 2. Author alias import: starts with the declared importAlias
	if (authorAlias && specifier.startsWith(authorAlias)) {
		const aliasRelative = specifier.slice(authorAlias.length)

		// Look up in src file set, then map to dest
		if (srcFileSet && srcToDestMap) {
			const srcMatch = tryResolveFile(aliasRelative, srcFileSet)
			if (srcMatch) {
				return srcToDestMap.get(srcMatch) || null
			}
		}

		// Fallback: try direct match in dest file set
		return tryResolveFile(aliasRelative, destFileSet)
	}

	// 3. Bare specifier (react, next/link, @scope/pkg) — external
	return null
}

/**
 * Resolve an import specifier to a dest file path.
 *
 * Exported for testing.
 *
 * @param {string} specifier - Import specifier
 * @param {string} fileDir - Directory of the importing file
 * @param {Set<string>} fileSet - File paths to match against
 * @param {string} [authorAlias] - Author's import alias prefix
 * @returns {string|null} Matching file path, or null if external
 */
export function resolveImportToFilePath(specifier, fileDir, fileSet, authorAlias) {
	if (specifier.startsWith("./") || specifier.startsWith("../")) {
		const resolved = normalizePath(joinPath(fileDir, specifier))
		return tryResolveFile(resolved, fileSet)
	}

	if (authorAlias && specifier.startsWith(authorAlias)) {
		const aliasRelative = specifier.slice(authorAlias.length)
		return tryResolveFile(aliasRelative, fileSet)
	}

	return null
}

/**
 * Try to resolve a path against a file set, trying extensions and index files.
 *
 * @param {string} candidatePath - Path to resolve (no leading ./)
 * @param {Set<string>} fileSet - Set of file paths
 * @returns {string|null} Matching path or null
 */
function tryResolveFile(candidatePath, fileSet) {
	// Normalize: remove leading ./
	candidatePath = candidatePath.replace(/^\.\//, "")

	// 1. Exact match
	if (fileSet.has(candidatePath)) return candidatePath

	// 2. Try appending extensions
	for (const ext of EXTENSIONS) {
		const withExt = candidatePath + ext
		if (fileSet.has(withExt)) return withExt
	}

	// 3. Try as directory: append /index.ext
	for (const ext of EXTENSIONS) {
		const indexPath = candidatePath + "/index" + ext
		if (fileSet.has(indexPath)) return indexPath
	}

	return null
}

/**
 * Compute the new import specifier for an internal file.
 *
 * @param {string} resolvedDestPath - Dest path of the imported file
 * @param {string} fileDestDir - Dest directory of the importing file
 * @param {string} [buyerAlias] - Buyer's alias (e.g., "@/components/design-system")
 * @returns {string|null} New specifier, or null if no rewrite needed
 */
function computeNewSpecifier(resolvedDestPath, fileDestDir, buyerAlias) {
	const cleanPath = stripImportExtension(resolvedDestPath)

	if (buyerAlias) {
		// Buyer wants alias-based imports
		const alias = buyerAlias.endsWith("/") ? buyerAlias : buyerAlias + "/"
		return alias + cleanPath
	}

	// No buyer alias — no rewrite needed
	return null
}

/**
 * Strip file extension and /index suffix for clean import paths.
 *
 * "components/dialog/Dialog.jsx" → "components/dialog/Dialog"
 * "components/dialog/index.js" → "components/dialog"
 *
 * @param {string} filePath
 * @returns {string}
 */
function stripImportExtension(filePath) {
	// Strip /index.ext → parent dir
	const indexMatch = filePath.match(/\/index\.(js|jsx|ts|tsx)$/)
	if (indexMatch) {
		return filePath.slice(0, -("/index." + indexMatch[1]).length)
	}

	// Strip .ext
	const extMatch = filePath.match(/\.(js|jsx|ts|tsx)$/)
	if (extMatch) {
		return filePath.slice(0, -("." + extMatch[1]).length)
	}

	return filePath
}

/**
 * Normalize a path by resolving . and .. segments.
 * Pure string operation — no filesystem access.
 *
 * @param {string} p - Path with forward slashes
 * @returns {string} Normalized path
 */
function normalizePath(p) {
	const segments = p.split("/")
	const resolved = []
	for (const seg of segments) {
		if (seg === "..") {
			resolved.pop()
		} else if (seg !== "." && seg !== "") {
			resolved.push(seg)
		}
	}
	return resolved.join("/")
}

/**
 * Join two path segments with forward slashes.
 *
 * @param {string} base
 * @param {string} relative
 * @returns {string}
 */
function joinPath(base, relative) {
	if (!base || base === ".") return relative
	return base + "/" + relative
}

/**
 * Get the directory portion of a path.
 *
 * @param {string} filePath
 * @returns {string}
 */
function dirname(filePath) {
	const lastSlash = filePath.lastIndexOf("/")
	if (lastSlash === -1) return ""
	return filePath.substring(0, lastSlash)
}
