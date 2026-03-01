/**
 * Swift project utilities for `lpm add`.
 *
 * Handles SPM target detection and Xcode local package scaffolding.
 */

import { exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

/**
 * Get the list of non-test targets from the current SPM package.
 * Uses `swift package dump-package` to read the manifest.
 *
 * @returns {Promise<string[]>} Array of target names (excluding test targets)
 */
export async function getSpmTargets() {
	try {
		const { stdout } = await execAsync('swift package dump-package', {
			timeout: 15000,
		})
		const manifest = JSON.parse(stdout)
		const targets = (manifest.targets || [])
			.filter((t) => t.type !== 'test')
			.map((t) => t.name)
		return targets
	} catch {
		return []
	}
}

/**
 * Ensure the local LPMComponents SPM package exists for Xcode projects.
 * Creates the package structure on first run, returns the install path.
 *
 * Structure:
 *   Packages/LPMComponents/
 *   ├── Package.swift
 *   └── Sources/LPMComponents/
 *       └── LPMComponents.swift  (placeholder)
 *
 * @returns {{ created: boolean, installPath: string }}
 */
export function ensureXcodeLocalPackage() {
	const cwd = process.cwd()
	const pkgDir = path.join(cwd, 'Packages', 'LPMComponents')
	const sourcesDir = path.join(pkgDir, 'Sources', 'LPMComponents')
	const manifestPath = path.join(pkgDir, 'Package.swift')

	if (fs.existsSync(manifestPath)) {
		return { created: false, installPath: sourcesDir }
	}

	// Create directory structure
	fs.mkdirSync(sourcesDir, { recursive: true })

	// Write Package.swift
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
	const placeholderPath = path.join(sourcesDir, 'LPMComponents.swift')
	if (!fs.existsSync(placeholderPath)) {
		fs.writeFileSync(
			placeholderPath,
			'// LPM Components — files added via `lpm add`\n',
		)
	}

	return { created: true, installPath: sourcesDir }
}

/**
 * Print one-time Xcode setup instructions after creating the local package.
 *
 * @param {Function} log - Logging function (e.g., console.log)
 */
export function printXcodeSetupInstructions(log) {
	log('')
	log('  To use LPM components in your Xcode project:')
	log('  1. In Xcode: File → Add Package Dependencies…')
	log('  2. Click "Add Local…"')
	log('  3. Select the Packages/LPMComponents directory')
	log('  4. Add LPMComponents to your app target')
	log('')
	log('  This is a one-time setup. Future `lpm add` commands')
	log('  will copy files into the same package automatically.')
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
		(d) => d.type === 'sourceControl' && !d.location?.includes('lpm.dev'),
	)
	const lpmDeps = swiftManifest.dependencies.filter(
		(d) => d.type === 'sourceControl' && d.location?.includes('lpm.dev'),
	)

	if (externalDeps.length > 0) {
		log('')
		log('  This package depends on external Swift packages.')
		log('  Add these to your Package.swift dependencies:')
		log('')
		for (const dep of externalDeps) {
			const version = dep.requirement?.range?.[0]?.lowerBound || '1.0.0'
			log(`    .package(url: "${dep.location}", from: "${version}"),`)
		}
	}

	if (lpmDeps.length > 0) {
		log('')
		log('  This package also uses LPM dependencies:')
		for (const dep of lpmDeps) {
			log(`    lpm add ${dep.identity}`)
		}
	}
}
