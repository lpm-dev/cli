/**
 * Ecosystem Detection & Non-JS Packaging Utilities
 *
 * Detects project ecosystem (JS, Swift, Rust, Python, Ruby) from manifest files,
 * reads ecosystem-specific manifests, and creates tarballs without npm.
 *
 * @module cli/lib/ecosystem
 */

import { exec } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import * as tar from "tar"

const execAsync = promisify(exec)

/**
 * Ecosystem manifest files in detection priority order.
 * First match wins.
 */
const ECOSYSTEM_MANIFESTS = [
	{ file: "Package.swift", ecosystem: "swift" },
	{ file: "Cargo.toml", ecosystem: "rust" },
	{ file: "pyproject.toml", ecosystem: "python" },
	{ file: "package.json", ecosystem: "js" },
]

/**
 * Files/directories to always skip when creating tarballs.
 * Keyed by ecosystem.
 */
const ECOSYSTEM_SKIP_PATTERNS = {
	swift: [
		".build/",
		"DerivedData/",
		"Pods/",
		".swiftpm/",
		"*.xcworkspace/",
		"xcuserdata/",
		".DS_Store",
	],
	rust: ["target/", ".DS_Store"],
	python: [
		"__pycache__/",
		"*.pyc",
		".venv/",
		"venv/",
		"dist/",
		"*.egg-info/",
		".DS_Store",
	],
	ruby: [".bundle/", "vendor/bundle/", "*.gem", ".DS_Store"],
}

/**
 * Files to always include in tarball for each ecosystem.
 */
const _ECOSYSTEM_REQUIRED_FILES = {
	swift: ["Package.swift", "lpm.config.json"],
	rust: ["Cargo.toml", "lpm.config.json"],
	python: ["pyproject.toml", "lpm.config.json"],
	ruby: ["Gemfile", "lpm.config.json"],
}

/**
 * Detect the ecosystem of the current project.
 * Checks for manifest files in priority order.
 *
 * @param {string} [cwd] - Working directory (defaults to process.cwd())
 * @returns {{ ecosystem: string, manifestFile: string }}
 */
export function detectEcosystem(cwd = process.cwd()) {
	for (const { file, ecosystem } of ECOSYSTEM_MANIFESTS) {
		const filePath = path.resolve(cwd, file)
		if (fs.existsSync(filePath)) {
			return { ecosystem, manifestFile: file }
		}
	}
	// No manifest found — caller should handle this
	return { ecosystem: null, manifestFile: null }
}

/**
 * Read and parse the Swift Package.swift manifest using `swift package dump-package`.
 * Returns structured data about the Swift package.
 *
 * @param {string} [cwd] - Working directory
 * @returns {Promise<object>} Parsed Swift manifest JSON
 * @throws {Error} If swift CLI is not available or manifest is invalid
 */
export async function readSwiftManifest(cwd = process.cwd()) {
	try {
		const { stdout } = await execAsync("swift package dump-package", {
			cwd,
			timeout: 30_000,
		})
		const manifest = JSON.parse(stdout)
		return manifest
	} catch (err) {
		if (err.code === "ENOENT" || err.message.includes("not found")) {
			throw new Error(
				"Swift toolchain not found. Install Xcode or Swift from swift.org.",
			)
		}
		throw new Error(`Failed to read Package.swift: ${err.message}`)
	}
}

/**
 * Extract structured metadata from a Swift manifest for storage in versionMeta.
 *
 * @param {object} manifest - Parsed output from `swift package dump-package`
 * @returns {object} Structured Swift metadata
 */
export function extractSwiftMetadata(manifest) {
	const metadata = {
		toolsVersion: manifest.toolsVersion?._version || null,
		platforms: [],
		products: [],
		targets: [],
		dependencies: [],
	}

	// Extract platform declarations
	if (manifest.platforms) {
		metadata.platforms = manifest.platforms.map(p => ({
			name: p.platformName,
			version: p.version,
		}))
	}

	// Extract products (libraries, executables)
	if (manifest.products) {
		metadata.products = manifest.products.map(p => ({
			name: p.name,
			type: p.type ? Object.keys(p.type)[0] : "library",
			targets: p.targets || [],
		}))
	}

	// Extract targets
	if (manifest.targets) {
		metadata.targets = manifest.targets.map(t => ({
			name: t.name,
			type: t.type || "regular",
			dependencies: (t.dependencies || []).map(d => {
				if (d.byName) return { type: "byName", name: d.byName[0] }
				if (d.product) return { type: "product", name: d.product[0] }
				return d
			}),
		}))
	}

	// Extract dependencies (external packages)
	if (manifest.dependencies) {
		metadata.dependencies = manifest.dependencies.map(dep => {
			if (dep.sourceControl) {
				const sc = dep.sourceControl[0]
				return {
					type: "sourceControl",
					identity: sc.identity,
					location: sc.location?.remote?.[0] || null,
					requirement: sc.requirement || null,
				}
			}
			if (dep.fileSystem) {
				const fs = dep.fileSystem[0]
				return {
					type: "fileSystem",
					identity: fs.identity,
					path: fs.path,
				}
			}
			return dep
		})
	}

	return metadata
}

/**
 * Map Swift dependencies to LPM dependency tree format.
 *
 * @param {object} swiftMetadata - Output from extractSwiftMetadata
 * @returns {{ lpm: Array, external: Array }}
 */
export function mapSwiftDependencies(swiftMetadata) {
	const lpm = []
	const external = []

	for (const dep of swiftMetadata.dependencies) {
		if (dep.type === "sourceControl") {
			// Check if it's an LPM package (lpm.dev URL) — for future use
			const isLpm = dep.location?.includes("lpm.dev")

			if (isLpm) {
				lpm.push({
					name: dep.identity,
					location: dep.location,
					requirement: dep.requirement,
				})
			} else {
				external.push({
					name: dep.identity,
					location: dep.location,
					requirement: dep.requirement,
				})
			}
		}
		// Skip fileSystem dependencies (local only)
	}

	return { lpm, external }
}

/**
 * Parse an XCFramework Info.plist to extract platform slices.
 * Handles the XML plist format without external dependencies.
 *
 * @param {string} plistPath - Path to Info.plist
 * @returns {{ slices: Array<{ identifier: string, platform: string, variant: string|null, architectures: string[] }>, formatVersion: string|null }}
 */
/**
 * Extract the content of an outer <array>...</array> after a given <key>,
 * correctly handling nested <array> tags inside (e.g. SupportedArchitectures).
 *
 * @param {string} xml - Full plist XML string
 * @param {string} keyName - The plist key name (e.g. "AvailableLibraries")
 * @returns {string|null} The inner content of the matched array, or null
 */
function extractOuterArray(xml, keyName) {
	const keyPattern = `<key>${keyName}</key>`
	const keyIdx = xml.indexOf(keyPattern)
	if (keyIdx === -1) return null

	const afterKey = xml.substring(keyIdx + keyPattern.length)
	const arrayTagIdx = afterKey.indexOf("<array>")
	if (arrayTagIdx === -1) return null

	const startContent = arrayTagIdx + "<array>".length
	let depth = 1
	let i = startContent

	while (i < afterKey.length && depth > 0) {
		if (afterKey.substring(i, i + 7) === "<array>") {
			depth++
			i += 7
		} else if (afterKey.substring(i, i + 8) === "</array>") {
			depth--
			if (depth === 0) return afterKey.substring(startContent, i)
			i += 8
		} else {
			i++
		}
	}

	return null
}

export function parseXCFrameworkPlist(plistPath) {
	const xml = fs.readFileSync(plistPath, "utf-8")
	const slices = []
	let formatVersion = null

	// Extract XCFrameworkFormatVersion
	const fvMatch = xml.match(
		/<key>XCFrameworkFormatVersion<\/key>\s*<string>([^<]+)<\/string>/,
	)
	if (fvMatch) formatVersion = fvMatch[1]

	// Extract AvailableLibraries array (handles nested <array> for architectures)
	const libsContent = extractOuterArray(xml, "AvailableLibraries")
	if (!libsContent) return { slices, formatVersion }

	// Split into individual <dict> entries
	const dictBlocks = libsContent.match(/<dict>[\s\S]*?<\/dict>/g) || []

	for (const block of dictBlocks) {
		const id = block.match(
			/<key>LibraryIdentifier<\/key>\s*<string>([^<]+)<\/string>/,
		)
		const platform = block.match(
			/<key>SupportedPlatform<\/key>\s*<string>([^<]+)<\/string>/,
		)
		const variant = block.match(
			/<key>SupportedPlatformVariant<\/key>\s*<string>([^<]+)<\/string>/,
		)

		// Extract architectures array
		const archMatch = block.match(
			/<key>SupportedArchitectures<\/key>\s*<array>([\s\S]*?)<\/array>/,
		)
		const architectures = archMatch
			? (archMatch[1].match(/<string>([^<]+)<\/string>/g) || []).map(s =>
					s.replace(/<\/?string>/g, ""),
				)
			: []

		if (id && platform) {
			slices.push({
				identifier: id[1],
				platform: platform[1],
				variant: variant ? variant[1] : null,
				architectures,
			})
		}
	}

	return { slices, formatVersion }
}

/**
 * Detect XCFramework directories in the project.
 * If found and Info.plist exists, parses platform slices.
 *
 * @param {string} [cwd] - Working directory
 * @returns {{ found: boolean, name: string|null, path: string|null, hasInfoPlist: boolean, slices: Array, formatVersion: string|null }}
 */
export function detectXCFramework(cwd = process.cwd()) {
	const entries = fs.readdirSync(cwd, { withFileTypes: true })

	for (const entry of entries) {
		if (entry.isDirectory() && entry.name.endsWith(".xcframework")) {
			const xcfPath = path.join(cwd, entry.name)
			const infoPlistPath = path.join(xcfPath, "Info.plist")
			const hasInfoPlist = fs.existsSync(infoPlistPath)

			if (hasInfoPlist) {
				const { slices, formatVersion } = parseXCFrameworkPlist(infoPlistPath)
				return {
					found: true,
					name: entry.name,
					path: xcfPath,
					hasInfoPlist: true,
					slices,
					formatVersion,
				}
			}

			return {
				found: true,
				name: entry.name,
				path: xcfPath,
				hasInfoPlist: false,
				slices: [],
				formatVersion: null,
			}
		}
	}

	return {
		found: false,
		name: null,
		path: null,
		hasInfoPlist: false,
		slices: [],
		formatVersion: null,
	}
}

/**
 * Recursively collect files in a directory, respecting skip patterns and .gitignore.
 *
 * @param {string} dir - Directory to scan
 * @param {string} baseDir - Base directory for relative paths
 * @param {string[]} skipPatterns - Patterns to skip
 * @returns {Array<{ path: string, size: number }>}
 */
function collectFilesRecursive(dir, baseDir, skipPatterns) {
	const results = []
	let entries
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return results
	}

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name)
		const relativePath = path.relative(baseDir, fullPath)

		// Check skip patterns
		const shouldSkip = skipPatterns.some(pattern => {
			if (pattern.endsWith("/")) {
				// Directory pattern
				const dirName = pattern.slice(0, -1)
				return entry.name === dirName || relativePath.startsWith(`${dirName}/`)
			}
			if (pattern.startsWith("*.")) {
				// Extension pattern
				return entry.name.endsWith(pattern.slice(1))
			}
			return entry.name === pattern
		})

		if (shouldSkip) continue

		if (entry.isDirectory()) {
			results.push(...collectFilesRecursive(fullPath, baseDir, skipPatterns))
		} else if (entry.isFile()) {
			try {
				const stats = fs.statSync(fullPath)
				results.push({
					path: relativePath,
					size: stats.size,
				})
			} catch {
				// Skip files we can't stat
			}
		}
	}

	return results
}

/**
 * Collect all files that should be included in the tarball for a non-JS ecosystem.
 *
 * @param {string} ecosystem - The ecosystem identifier
 * @param {string} [cwd] - Working directory
 * @returns {Array<{ path: string, size: number }>}
 */
export function collectPackageFiles(ecosystem, cwd = process.cwd()) {
	const skipPatterns = [
		// Universal skips
		".git/",
		"node_modules/",
		".DS_Store",
		// Ecosystem-specific skips
		...(ECOSYSTEM_SKIP_PATTERNS[ecosystem] || []),
	]

	// Also read .gitignore patterns if available
	const gitignorePath = path.join(cwd, ".gitignore")
	if (fs.existsSync(gitignorePath)) {
		try {
			const gitignore = fs.readFileSync(gitignorePath, "utf8")
			const patterns = gitignore
				.split("\n")
				.map(line => line.trim())
				.filter(line => line && !line.startsWith("#"))
			skipPatterns.push(...patterns)
		} catch {
			// Ignore .gitignore read errors
		}
	}

	return collectFilesRecursive(cwd, cwd, skipPatterns)
}

/**
 * Create a tarball (.tgz) from a list of files using the `tar` command.
 * Used for non-JS ecosystems where npm pack is not available.
 *
 * @param {string} ecosystem - Ecosystem identifier
 * @param {string} name - Package name (for tarball filename)
 * @param {string} version - Package version
 * @param {string} [cwd] - Working directory
 * @returns {Promise<{ tarballPath: string, files: Array<{ path: string, size: number }>, unpackedSize: number, fileCount: number }>}
 */
export async function createEcosystemTarball(
	ecosystem,
	name,
	version,
	cwd = process.cwd(),
) {
	const files = collectPackageFiles(ecosystem, cwd)

	if (files.length === 0) {
		throw new Error("No files found to package. Check your project directory.")
	}

	// Calculate unpacked size
	const unpackedSize = files.reduce((sum, f) => sum + f.size, 0)

	// Generate tarball filename (sanitize name for filesystem)
	const safeName = name.replace(/[/@]/g, "-").replace(/^-/, "")
	const tarballFilename = `${safeName}-${version}.tgz`
	const tarballPath = path.resolve(cwd, tarballFilename)

	// Create tarball using node-tar with package/ prefix.
	// This matches npm pack convention so `lpm add` can use strip:1
	// to extract files at the correct paths.
	await tar.create(
		{
			gzip: true,
			file: tarballPath,
			cwd,
			prefix: "package",
		},
		files.map(f => f.path),
	)

	return {
		tarballPath,
		files,
		unpackedSize,
		fileCount: files.length,
	}
}
