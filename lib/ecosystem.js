/**
 * Ecosystem Detection & Non-JS Packaging Utilities
 *
 * Detects project ecosystem (JS, Swift, Rust, Python, Ruby) from manifest files,
 * reads ecosystem-specific manifests, and creates tarballs without npm.
 *
 * @module cli/lib/ecosystem
 */

import { exec } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

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
const ECOSYSTEM_REQUIRED_FILES = {
	swift: ["Package.swift"],
	rust: ["Cargo.toml"],
	python: ["pyproject.toml"],
	ruby: ["Gemfile"],
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
		metadata.platforms = manifest.platforms.map((p) => ({
			name: p.platformName,
			version: p.version,
		}))
	}

	// Extract products (libraries, executables)
	if (manifest.products) {
		metadata.products = manifest.products.map((p) => ({
			name: p.name,
			type: p.type ? Object.keys(p.type)[0] : "library",
			targets: p.targets || [],
		}))
	}

	// Extract targets
	if (manifest.targets) {
		metadata.targets = manifest.targets.map((t) => ({
			name: t.name,
			type: t.type || "regular",
			dependencies: (t.dependencies || []).map((d) => {
				if (d.byName) return { type: "byName", name: d.byName[0] }
				if (d.product) return { type: "product", name: d.product[0] }
				return d
			}),
		}))
	}

	// Extract dependencies (external packages)
	if (manifest.dependencies) {
		metadata.dependencies = manifest.dependencies.map((dep) => {
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
			const isLpm =
				dep.location && dep.location.includes("lpm.dev")

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
 * Detect XCFramework directories in the project.
 *
 * @param {string} [cwd] - Working directory
 * @returns {{ found: boolean, name: string | null, path: string | null, hasInfoPlist: boolean }}
 */
export function detectXCFramework(cwd = process.cwd()) {
	const entries = fs.readdirSync(cwd, { withFileTypes: true })

	for (const entry of entries) {
		if (entry.isDirectory() && entry.name.endsWith(".xcframework")) {
			const xcfPath = path.join(cwd, entry.name)
			const infoPlistPath = path.join(xcfPath, "Info.plist")
			const hasInfoPlist = fs.existsSync(infoPlistPath)

			return {
				found: true,
				name: entry.name,
				path: xcfPath,
				hasInfoPlist,
			}
		}
	}

	return { found: false, name: null, path: null, hasInfoPlist: false }
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
		const shouldSkip = skipPatterns.some((pattern) => {
			if (pattern.endsWith("/")) {
				// Directory pattern
				const dirName = pattern.slice(0, -1)
				return entry.name === dirName || relativePath.startsWith(dirName + "/")
			}
			if (pattern.startsWith("*.")) {
				// Extension pattern
				return entry.name.endsWith(pattern.slice(1))
			}
			return entry.name === pattern
		})

		if (shouldSkip) continue

		if (entry.isDirectory()) {
			results.push(
				...collectFilesRecursive(fullPath, baseDir, skipPatterns),
			)
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
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith("#"))
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
export async function createEcosystemTarball(ecosystem, name, version, cwd = process.cwd()) {
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

	// Write file list to a temp file (avoids argument length limits)
	const fileListPath = path.resolve(cwd, ".lpm-pack-files")
	try {
		fs.writeFileSync(fileListPath, files.map((f) => f.path).join("\n"))

		// Create tarball using tar
		await execAsync(
			`tar -czf "${tarballFilename}" -T "${fileListPath}"`,
			{ cwd, timeout: 60_000 },
		)
	} finally {
		// Clean up temp file list
		try {
			fs.unlinkSync(fileListPath)
		} catch {
			// Ignore
		}
	}

	return {
		tarballPath,
		files,
		unpackedSize,
		fileCount: files.length,
	}
}
