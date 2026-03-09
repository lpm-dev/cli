/**
 * Swift project utilities for `lpm add`.
 *
 * Handles SPM target detection, Xcode local package scaffolding,
 * and automatic Xcode project linking.
 *
 * Each installed LPM package gets its own Swift target/module so users
 * can `import Charts`, `import Networking`, etc. instead of one monolithic module.
 */

import { exec } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { project as XcodeProject } from "xcode"

const execAsync = promisify(exec)

// ─── SPM Target Detection ────────────────────────────────────────────────────

/**
 * Get the list of non-test targets from the current SPM package.
 * Uses `swift package dump-package` to read the manifest.
 *
 * @returns {Promise<string[]>} Array of target names (excluding test targets)
 */
export async function getSpmTargets() {
	try {
		const { stdout } = await execAsync("swift package dump-package", {
			timeout: 15000,
		})
		const manifest = JSON.parse(stdout)
		const targets = (manifest.targets || [])
			.filter(t => t.type !== "test")
			.map(t => t.name)
		return targets
	} catch {
		return []
	}
}

// ─── Source Package Parsing ──────────────────────────────────────────────────

/**
 * Parse a Package.swift to extract the first library product name.
 * This is the module name users will `import` in their code.
 *
 * Uses regex since we can't run `swift package dump-package` on an
 * extracted tarball (it's not in a valid SPM project context).
 *
 * @param {string} packageSwiftPath - Path to the Package.swift file
 * @returns {string|null} The product/target name, or null if not found
 */
export function parseSwiftTargetName(packageSwiftPath) {
	if (!fs.existsSync(packageSwiftPath)) return null

	const content = fs.readFileSync(packageSwiftPath, "utf-8")

	// Match .library(name: "Foo", ...) — the product name is the import name
	const libraryMatch = content.match(/\.library\(\s*name:\s*"([^"]+)"/)
	if (libraryMatch) return libraryMatch[1]

	// Fallback: match .target(name: "Foo", ...) excluding test targets
	const targetMatches = [...content.matchAll(/\.target\(\s*name:\s*"([^"]+)"/g)]
	const testTargets = [
		...content.matchAll(/\.testTarget\(\s*name:\s*"([^"]+)"/g),
	].map(m => m[1])

	for (const match of targetMatches) {
		if (!testTargets.includes(match[1])) {
			return match[1]
		}
	}

	return null
}

/**
 * Parse the platforms block from a Package.swift file.
 *
 * @param {string} packageSwiftPath - Path to the Package.swift file
 * @returns {string[]|null} Array of platform strings, or null if not found
 */
export function parsePlatforms(packageSwiftPath) {
	if (!fs.existsSync(packageSwiftPath)) return null

	const content = fs.readFileSync(packageSwiftPath, "utf-8")

	// Match platforms: [ ... ] block
	const platformsMatch = content.match(/platforms:\s*\[([\s\S]*?)\]/)
	if (!platformsMatch) return null

	const entries = [...platformsMatch[1].matchAll(/\.\w+\(\.\w+\)/g)]
	return entries.map(m => m[0])
}

// ─── Target Name Conflict Resolution ─────────────────────────────────────────

/**
 * Derive a scoped target name from an lpm package reference.
 * e.g., "@lpm.dev/user2.haptic" → "User2Haptic"
 *
 * @param {string} lpmPackageName - Full lpm package name (e.g., "@lpm.dev/user2.haptic")
 * @returns {string} PascalCase scoped name
 */
export function scopedTargetName(lpmPackageName) {
	// Extract "user2.haptic" from "@lpm.dev/user2.haptic"
	const shortName = lpmPackageName.replace(/^@lpm\.dev\//, "")

	// Convert "user2.haptic" → "User2Haptic"
	return shortName
		.split(/[.\-_]/)
		.map(part => part.charAt(0).toUpperCase() + part.slice(1))
		.join("")
}

/**
 * Resolve the final target name for an LPM package, handling conflicts.
 *
 * Strategy (Option C):
 * - Default to the original target name from the source Package.swift (e.g., "Haptic")
 * - If that name already exists in the local manifest, auto-scope using the lpm package name
 *
 * @param {string} originalTarget - Target name from source Package.swift
 * @param {string} lpmPackageName - Full lpm package name (e.g., "@lpm.dev/user2.haptic")
 * @param {string} manifestPath - Path to local LPMComponents Package.swift
 * @returns {{ targetName: string, wasScoped: boolean }}
 */
export function resolveTargetName(
	originalTarget,
	lpmPackageName,
	manifestPath,
) {
	if (!fs.existsSync(manifestPath)) {
		// No manifest yet — no conflict possible
		return { targetName: originalTarget, wasScoped: false }
	}

	const content = fs.readFileSync(manifestPath, "utf-8")

	if (!content.includes(`name: "${originalTarget}"`)) {
		// Target name not yet taken
		return { targetName: originalTarget, wasScoped: false }
	}

	// Conflict: scope the name
	const scoped = scopedTargetName(lpmPackageName)
	return { targetName: scoped, wasScoped: true }
}

// ─── Local Package Scaffolding ───────────────────────────────────────────────

/**
 * Ensure the local LPMComponents SPM package exists for Xcode projects.
 * Creates the package structure on first run. Each installed package gets
 * its own target so it can be imported by its original module name.
 *
 * Structure:
 *   Packages/LPMComponents/
 *   ├── Package.swift          (multi-target manifest)
 *   └── Sources/
 *       ├── Charts/            (from acme.swift-charts)
 *       ├── Networking/        (from acme.networking)
 *       └── ...
 *
 * @param {string} [targetName] - The Swift target/module name for the package being installed
 * @param {string[]} [platforms] - Platform requirements from the source package
 * @returns {{ created: boolean, installPath: string, targetName: string|null }}
 */
export function ensureXcodeLocalPackage(targetName, platforms) {
	const cwd = process.cwd()
	const pkgDir = path.join(cwd, "Packages", "LPMComponents")
	const manifestPath = path.join(pkgDir, "Package.swift")

	const effectiveTarget = targetName || "LPMComponents"
	const sourcesDir = path.join(pkgDir, "Sources", effectiveTarget)

	if (fs.existsSync(manifestPath)) {
		// Package.swift already exists — add the new target if not present
		if (targetName) {
			addTargetToManifest(manifestPath, targetName, platforms)
		}

		fs.mkdirSync(sourcesDir, { recursive: true })
		return {
			created: false,
			installPath: sourcesDir,
			targetName: effectiveTarget,
		}
	}

	// First-time creation
	fs.mkdirSync(sourcesDir, { recursive: true })

	if (targetName) {
		const platformsStr =
			platforms?.length > 0
				? `\n    platforms: [\n        ${platforms.join(",\n        ")},\n    ],`
				: "\n    platforms: [\n        .iOS(.v16),\n        .macOS(.v13),\n    ],"

		const packageSwift = `// swift-tools-version: 5.9
// Managed by lpm — do not edit manually.
// Each \`lpm add\` of a Swift package adds a new target below.

import PackageDescription

let package = Package(
    name: "LPMComponents",${platformsStr}
    products: [
        .library(name: "${targetName}", targets: ["${targetName}"]),
    ],
    targets: [
        .target(name: "${targetName}", path: "Sources/${targetName}"),
    ]
)
`
		fs.writeFileSync(manifestPath, packageSwift)
	} else {
		// Legacy single-target manifest (backwards compatibility)
		const packageSwift = `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LPMComponents",
    platforms: [
        .iOS(.v16),
        .macOS(.v13),
    ],
    products: [
        .library(name: "LPMComponents", targets: ["LPMComponents"]),
    ],
    targets: [
        .target(name: "LPMComponents"),
    ]
)
`
		fs.writeFileSync(manifestPath, packageSwift)

		// Write placeholder source file (SPM requires at least one source file)
		const placeholderPath = path.join(sourcesDir, "LPMComponents.swift")
		if (!fs.existsSync(placeholderPath)) {
			fs.writeFileSync(
				placeholderPath,
				"// LPM Components — files added via `lpm add`\n",
			)
		}
	}

	return {
		created: true,
		installPath: sourcesDir,
		targetName: effectiveTarget,
	}
}

/**
 * Add a new target to an existing LPMComponents Package.swift.
 * Parses the manifest, checks if the target already exists, and adds it if not.
 *
 * @param {string} manifestPath - Path to Package.swift
 * @param {string} targetName - Target name to add
 * @param {string[]} [platforms] - Platform requirements (used to merge)
 */
function addTargetToManifest(manifestPath, targetName, platforms) {
	let content = fs.readFileSync(manifestPath, "utf-8")

	// Check if target already exists
	if (content.includes(`name: "${targetName}"`)) {
		return
	}

	// Add product entry: find last .library() line and add after it
	const productEntry = `.library(name: "${targetName}", targets: ["${targetName}"])`
	content = content.replace(
		/(products:\s*\[[\s\S]*?)(^\s*\],)/m,
		(_match, before, closing) => {
			const lines = before.split("\n")
			const lastLibraryIdx = lines.findLastIndex(l => l.includes(".library("))
			if (lastLibraryIdx >= 0) {
				const indent = lines[lastLibraryIdx].match(/^(\s*)/)[1]
				lines.splice(lastLibraryIdx + 1, 0, `${indent}${productEntry},`)
			}
			return lines.join("\n") + closing
		},
	)

	// Add target entry: find last .target() line and add after it
	const targetEntry = `.target(name: "${targetName}", path: "Sources/${targetName}")`
	content = content.replace(
		/(targets:\s*\[[\s\S]*?)(^\s*\]\s*\))/m,
		(_match, before, closing) => {
			const lines = before.split("\n")
			const lastTargetIdx = lines.findLastIndex(l => l.includes(".target("))
			if (lastTargetIdx >= 0) {
				const indent = lines[lastTargetIdx].match(/^(\s*)/)[1]
				lines.splice(lastTargetIdx + 1, 0, `${indent}${targetEntry},`)
			}
			return lines.join("\n") + closing
		},
	)

	// Merge platforms if the source package requires ones not yet listed
	if (platforms?.length) {
		for (const platform of platforms) {
			const platformName = platform.split("(")[0]
			if (!content.includes(platformName)) {
				content = content.replace(
					/(platforms:\s*\[[\s\S]*?)(^\s*\],)/m,
					(_match, before, closing) => {
						const lines = before.split("\n")
						const lastPlatformIdx = lines.findLastIndex(l =>
							l.match(/^\s+\.\w+\(/),
						)
						if (lastPlatformIdx >= 0) {
							const indent = lines[lastPlatformIdx].match(/^(\s*)/)[1]
							lines.splice(lastPlatformIdx + 1, 0, `${indent}${platform},`)
						}
						return lines.join("\n") + closing
					},
				)
			}
		}
	}

	fs.writeFileSync(manifestPath, content)
}

// ─── Xcode Auto-Linking ─────────────────────────────────────────────────────

/**
 * Find the .xcodeproj directory in the given project root.
 *
 * @param {string} projectRoot - The project root directory
 * @returns {string|null} Path to project.pbxproj, or null if not found
 */
function findPbxprojPath(projectRoot) {
	try {
		const entries = fs.readdirSync(projectRoot)
		const xcodeproj = entries.find(e => e.endsWith(".xcodeproj"))
		if (!xcodeproj) return null
		const pbxproj = path.join(projectRoot, xcodeproj, "project.pbxproj")
		return fs.existsSync(pbxproj) ? pbxproj : null
	} catch {
		return null
	}
}

/**
 * Auto-link the LPMComponents local package to the Xcode project.
 *
 * Uses the `xcode` library (Apache Cordova's pbxproj parser/writer) to
 * safely manipulate the project file as a parsed object tree, avoiding
 * fragile regex-based string surgery.
 *
 * Adds:
 * 1. XCLocalSwiftPackageReference → points to Packages/LPMComponents
 * 2. XCSwiftPackageProductDependency → for each product (target)
 * 3. PBXBuildFile → registers in frameworks build phase
 * 4. References in PBXProject.packageReferences and PBXNativeTarget.packageProductDependencies
 *
 * @param {string} [productName] - The product name to link (e.g., "Haptic")
 * @returns {{ success: boolean, message: string }}
 */
export function autoLinkXcodePackage(productName) {
	const cwd = process.cwd()
	const pbxprojPath = findPbxprojPath(cwd)

	if (!pbxprojPath) {
		return { success: false, message: "Could not find .xcodeproj" }
	}

	const proj = new XcodeProject(pbxprojPath)
	proj.parseSync()

	const objects = proj.hash.project.objects
	const localPkgRelPath = "Packages/LPMComponents"
	const effectiveProduct = productName || "LPMComponents"

	// Check if local package reference already exists
	const existingPkgRef = findExistingLocalPkgRef(objects, localPkgRelPath)

	if (existingPkgRef) {
		// Package is already linked — just add new product dependency if needed
		if (productName && !findExistingProductDep(objects, productName)) {
			addProductDependency(proj, objects, productName)
			fs.writeFileSync(pbxprojPath, proj.writeSync())
			return {
				success: true,
				message: `Linked ${productName} to your Xcode target`,
			}
		}
		return { success: true, message: "Already linked" }
	}

	// Generate UUIDs for new entries
	const pkgRefUUID = proj.generateUuid()
	const productDepUUID = proj.generateUuid()
	const buildFileUUID = proj.generateUuid()

	// 1. Add XCLocalSwiftPackageReference
	if (!objects.XCLocalSwiftPackageReference) {
		objects.XCLocalSwiftPackageReference = {}
	}
	objects.XCLocalSwiftPackageReference[pkgRefUUID] = {
		isa: "XCLocalSwiftPackageReference",
		relativePath: localPkgRelPath,
	}
	objects.XCLocalSwiftPackageReference[`${pkgRefUUID}_comment`] =
		`XCLocalSwiftPackageReference "${localPkgRelPath}"`

	// 2. Add XCSwiftPackageProductDependency
	if (!objects.XCSwiftPackageProductDependency) {
		objects.XCSwiftPackageProductDependency = {}
	}
	objects.XCSwiftPackageProductDependency[productDepUUID] = {
		isa: "XCSwiftPackageProductDependency",
		productName: effectiveProduct,
	}
	objects.XCSwiftPackageProductDependency[`${productDepUUID}_comment`] =
		effectiveProduct

	// 3. Add PBXBuildFile with productRef
	if (!objects.PBXBuildFile) {
		objects.PBXBuildFile = {}
	}
	objects.PBXBuildFile[buildFileUUID] = {
		isa: "PBXBuildFile",
		productRef: productDepUUID,
		productRef_comment: effectiveProduct,
	}
	objects.PBXBuildFile[`${buildFileUUID}_comment`] =
		`${effectiveProduct} in Frameworks`

	// 4. Add to PBXFrameworksBuildPhase files
	for (const key in objects.PBXFrameworksBuildPhase) {
		if (key.endsWith("_comment")) continue
		const phase = objects.PBXFrameworksBuildPhase[key]
		if (phase?.files) {
			phase.files.push({
				value: buildFileUUID,
				comment: `${effectiveProduct} in Frameworks`,
			})
		}
	}

	// 5. Add packageReferences to PBXProject
	for (const key in objects.PBXProject) {
		if (key.endsWith("_comment")) continue
		const project = objects.PBXProject[key]
		if (!project?.isa) continue
		if (!project.packageReferences) project.packageReferences = []
		project.packageReferences.push({
			value: pkgRefUUID,
			comment: `XCLocalSwiftPackageReference "${localPkgRelPath}"`,
		})
	}

	// 6. Add packageProductDependencies to PBXNativeTarget
	for (const key in objects.PBXNativeTarget) {
		if (key.endsWith("_comment")) continue
		const target = objects.PBXNativeTarget[key]
		if (!target?.isa) continue
		if (!target.packageProductDependencies) {
			target.packageProductDependencies = []
		}
		target.packageProductDependencies.push({
			value: productDepUUID,
			comment: effectiveProduct,
		})
	}

	fs.writeFileSync(pbxprojPath, proj.writeSync())

	return {
		success: true,
		message: `Linked ${effectiveProduct} to your Xcode project`,
	}
}

/**
 * Find an existing XCLocalSwiftPackageReference for the given path.
 *
 * @param {object} objects - The parsed pbxproj objects
 * @param {string} relativePath - The local package path to search for
 * @returns {string|null} UUID of existing reference, or null
 */
function findExistingLocalPkgRef(objects, relativePath) {
	const section = objects.XCLocalSwiftPackageReference
	if (!section) return null
	for (const key in section) {
		if (key.endsWith("_comment")) continue
		if (section[key]?.relativePath === relativePath) return key
	}
	return null
}

/**
 * Find an existing XCSwiftPackageProductDependency for the given product.
 *
 * @param {object} objects - The parsed pbxproj objects
 * @param {string} productName - The product name to search for
 * @returns {string|null} UUID of existing dependency, or null
 */
function findExistingProductDep(objects, productName) {
	const section = objects.XCSwiftPackageProductDependency
	if (!section) return null
	for (const key in section) {
		if (key.endsWith("_comment")) continue
		if (section[key]?.productName === productName) return key
	}
	return null
}

/**
 * Add a product dependency for a new target to an already-linked local package.
 *
 * @param {object} proj - The parsed XcodeProject instance
 * @param {object} objects - The parsed pbxproj objects
 * @param {string} productName - The product to add
 */
function addProductDependency(proj, objects, productName) {
	const productDepUUID = proj.generateUuid()
	const buildFileUUID = proj.generateUuid()

	// Add XCSwiftPackageProductDependency
	if (!objects.XCSwiftPackageProductDependency) {
		objects.XCSwiftPackageProductDependency = {}
	}
	objects.XCSwiftPackageProductDependency[productDepUUID] = {
		isa: "XCSwiftPackageProductDependency",
		productName,
	}
	objects.XCSwiftPackageProductDependency[`${productDepUUID}_comment`] =
		productName

	// Add PBXBuildFile with productRef
	if (!objects.PBXBuildFile) {
		objects.PBXBuildFile = {}
	}
	objects.PBXBuildFile[buildFileUUID] = {
		isa: "PBXBuildFile",
		productRef: productDepUUID,
		productRef_comment: productName,
	}
	objects.PBXBuildFile[`${buildFileUUID}_comment`] =
		`${productName} in Frameworks`

	// Add to frameworks build phase
	for (const key in objects.PBXFrameworksBuildPhase) {
		if (key.endsWith("_comment")) continue
		const phase = objects.PBXFrameworksBuildPhase[key]
		if (phase?.files) {
			phase.files.push({
				value: buildFileUUID,
				comment: `${productName} in Frameworks`,
			})
		}
	}

	// Add to packageProductDependencies
	for (const key in objects.PBXNativeTarget) {
		if (key.endsWith("_comment")) continue
		const target = objects.PBXNativeTarget[key]
		if (!target?.isa) continue
		if (!target.packageProductDependencies) {
			target.packageProductDependencies = []
		}
		target.packageProductDependencies.push({
			value: productDepUUID,
			comment: productName,
		})
	}
}

// ─── CLI Output ──────────────────────────────────────────────────────────────

/**
 * Print one-time Xcode setup instructions.
 * Only shown when auto-linking is not available (no .xcodeproj found).
 *
 * @param {Function} log - Logging function (e.g., console.log)
 * @param {string} [targetName] - The module name the user should import
 */
export function printXcodeSetupInstructions(log, targetName) {
	log("")
	log("  To use LPM components in your Xcode project:")
	log("  1. In Xcode: File → Add Package Dependencies…")
	log('  2. Click "Add Local…"')
	log("  3. Select the Packages/LPMComponents directory")
	log("  4. Add LPMComponents to your app target")
	log("")
	if (targetName) {
		log(`  Then import in your Swift code:`)
		log(`    import ${targetName}`)
		log("")
	}
	log("  This is a one-time setup. Future `lpm add` commands")
	log("  will add new targets to the same package automatically.")
}

/**
 * Print Swift dependency instructions for the consumer.
 *
 * @param {object} versionData - Package version data from registry
 * @param {Function} log - Logging function
 */
export function printSwiftDependencyInstructions(versionData, log) {
	const meta = versionData?.versionMeta || versionData?.meta || {}
	const swiftManifest = meta.swiftManifest || meta._swiftManifest
	if (!swiftManifest?.dependencies?.length) return

	const externalDeps = swiftManifest.dependencies.filter(
		d => d.type === "sourceControl" && !d.location?.includes("lpm.dev"),
	)
	const lpmDeps = swiftManifest.dependencies.filter(
		d => d.type === "sourceControl" && d.location?.includes("lpm.dev"),
	)

	if (externalDeps.length > 0) {
		log("")
		log("  This package depends on external Swift packages.")
		log("  Add these to your Package.swift dependencies:")
		log("")
		for (const dep of externalDeps) {
			const version = dep.requirement?.range?.[0]?.lowerBound || "1.0.0"
			log(`    .package(url: "${dep.location}", from: "${version}"),`)
		}
	}

	if (lpmDeps.length > 0) {
		log("")
		log("  This package also uses LPM dependencies:")
		for (const dep of lpmDeps) {
			log(`    lpm add ${dep.identity}`)
		}
	}
}
