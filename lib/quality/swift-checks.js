/**
 * Swift-specific quality check definitions for LPM packages.
 * Replaces JS-specific checks (TypeScript types, ESM, tree-shaking, etc.)
 * while keeping universal checks (README, license, testing, health).
 *
 * Categories:
 *   - documentation: 25 points (6 checks)
 *   - code: 30 points (6 checks)
 *   - testing: 15 points (3 checks)
 *   - health: 30 points (9 checks)
 */

// --- Documentation checks (25 points) ---
// Reused from JS: hasReadme, readmeHasInstall, readmeHasUsage, readmeHasApi, hasChangelog, hasLicense
// readmeHasInstall is modified to also look for Swift-specific install patterns

export const swiftReadmeHasInstall = {
	id: "readme-install",
	category: "documentation",
	label: "README has install section",
	maxPoints: 3,
	run: ({ readme }) => {
		if (!readme) return { passed: false, detail: "No README" }
		const lower = readme.toLowerCase()
		const hasSection =
			lower.includes("## install") ||
			lower.includes("## getting started") ||
			lower.includes("## setup") ||
			lower.includes("## requirements") ||
			lower.includes("swift package manager") ||
			lower.includes("package.swift") ||
			lower.includes(".package(") ||
			lower.includes("lpm add") ||
			lower.includes("lpm install")
		return {
			passed: hasSection,
			detail: hasSection
				? "Install instructions found"
				: "No install section found in README",
		}
	},
}

// --- Code Quality checks (30 points) — Swift-specific ---

export const hasPlatformDeclarations = {
	id: "has-platforms",
	category: "code",
	label: "Has platform declarations",
	maxPoints: 6,
	run: ({ swiftManifest }) => {
		if (!swiftManifest)
			return { passed: false, detail: "No Swift manifest data" }
		const platforms = swiftManifest.platforms || []
		if (platforms.length === 0) {
			return {
				passed: false,
				detail:
					"No platform declarations in Package.swift (add platforms: [.iOS(.v16), .macOS(.v13)])",
			}
		}
		const names = platforms.map((p) => `${p.name} ${p.version}`).join(", ")
		return {
			passed: true,
			detail: `Platforms: ${names}`,
		}
	},
}

export const recentToolsVersion = {
	id: "recent-tools-version",
	category: "code",
	label: "Uses recent swift-tools-version",
	maxPoints: 5,
	run: ({ swiftManifest }) => {
		if (!swiftManifest)
			return { passed: false, detail: "No Swift manifest data" }
		const version = swiftManifest.toolsVersion
		if (!version) {
			return { passed: false, detail: "No swift-tools-version found" }
		}
		// Parse major.minor from version string
		const match = version.match(/^(\d+)\.(\d+)/)
		if (!match) {
			return { passed: false, detail: `Invalid tools version: ${version}` }
		}
		const major = parseInt(match[1], 10)
		const minor = parseInt(match[2], 10)
		// 5.9+ is recent (Swift 5.9 introduced macros, 5.10 strict concurrency)
		const isRecent = major > 5 || (major === 5 && minor >= 9)
		return {
			passed: isRecent,
			detail: isRecent
				? `swift-tools-version: ${version}`
				: `swift-tools-version ${version} is outdated (5.9+ recommended)`,
		}
	},
}

export const supportsMultiplePlatforms = {
	id: "multi-platform",
	category: "code",
	label: "Supports multiple platforms",
	maxPoints: 4,
	run: ({ swiftManifest }) => {
		if (!swiftManifest)
			return { passed: false, detail: "No Swift manifest data" }
		const platforms = swiftManifest.platforms || []
		const count = platforms.length
		let points
		if (count >= 3) points = 4
		else if (count === 2) points = 3
		else if (count === 1) points = 2
		else points = 0
		return {
			passed: points > 0,
			points,
			detail:
				count > 0
					? `Supports ${count} platform${count !== 1 ? "s" : ""}`
					: "No platform declarations",
		}
	},
}

export const hasPublicAPI = {
	id: "has-public-api",
	category: "code",
	label: "Has public API surface",
	maxPoints: 5,
	run: ({ files }) => {
		// Check if any .swift source files exist (exclude manifest and tests)
		const swiftFiles = files.filter((f) => {
			const name = f.path || f
			return (
				name.endsWith(".swift") &&
				!name.includes("Tests/") &&
				name !== "Package.swift"
			)
		})
		if (swiftFiles.length === 0) {
			return { passed: false, detail: "No Swift source files found" }
		}
		// CLI can't read file contents from the file list alone
		// Server will do deeper analysis; CLI just checks file presence
		return {
			passed: true,
			detail: `${swiftFiles.length} Swift source file${swiftFiles.length !== 1 ? "s" : ""} found`,
			serverOnly: true,
		}
	},
}

export const hasDocComments = {
	id: "has-doc-comments",
	category: "code",
	label: "Has DocC documentation",
	maxPoints: 5,
	run: () => {
		// Full check runs server-side from tarball contents.
		// CLI assumes pass; server overrides if no documentation found.
		return {
			passed: true,
			detail: "Full check runs server-side",
			serverOnly: true,
		}
	},
}

export const smallDepsSwift = {
	id: "small-deps",
	category: "code",
	label: "Small dependency footprint",
	maxPoints: 5,
	run: ({ swiftManifest }) => {
		if (!swiftManifest) return { passed: true, points: 5, detail: "No manifest data" }
		const deps = swiftManifest.dependencies?.length || 0
		let points
		if (deps === 0) points = 5
		else if (deps <= 2) points = 4
		else if (deps <= 5) points = 3
		else if (deps <= 10) points = 1
		else points = 0
		return {
			passed: points > 0,
			points,
			detail: `${deps} ${deps === 1 ? "dependency" : "dependencies"}`,
		}
	},
}

// --- Testing checks (15 points) ---

export const swiftHasTestTargets = {
	id: "has-test-files",
	category: "testing",
	label: "Has test targets",
	maxPoints: 7,
	run: ({ swiftManifest, files }) => {
		// Check Swift manifest for test targets
		const testTargets = (swiftManifest?.targets || []).filter(
			(t) => t.type === "test",
		)

		// Also check file paths
		const testFiles = files.filter((f) => {
			const name = (f.path || f).toLowerCase()
			return name.includes("tests/") || name.includes("test/")
		})

		const passed = testTargets.length > 0 || testFiles.length > 0
		let detail
		if (testTargets.length > 0) {
			detail = `${testTargets.length} test target${testTargets.length !== 1 ? "s" : ""}: ${testTargets.map((t) => t.name).join(", ")}`
		} else if (testFiles.length > 0) {
			detail = `${testFiles.length} test file${testFiles.length !== 1 ? "s" : ""} found`
		} else {
			detail = "No test targets or test files found"
		}

		return { passed, detail }
	},
}

export const swiftHasTestScript = {
	id: "has-test-script",
	category: "testing",
	label: "Has test configuration",
	maxPoints: 4,
	run: ({ swiftManifest }) => {
		// For Swift, having test targets in the manifest is the equivalent
		const testTargets = (swiftManifest?.targets || []).filter(
			(t) => t.type === "test",
		)
		const passed = testTargets.length > 0
		return {
			passed,
			detail: passed
				? "Test targets defined in Package.swift"
				: "No test targets in Package.swift",
		}
	},
}

// --- Export Swift check set ---
// We import the universal checks from checks.js and replace JS-specific ones

import {
	hasReadme,
	readmeHasUsage,
	readmeHasApi,
	hasChangelog,
	hasLicense,
	hasCiConfig,
	hasDescription,
	hasKeywords,
	hasRepository,
	hasHomepage,
	reasonableSize,
	noVulnerabilities,
	maintenanceHealth,
	semverConsistency,
	authorVerified,
} from "./checks.js"

export const swiftChecks = [
	// Documentation (25)
	hasReadme,
	swiftReadmeHasInstall,
	readmeHasUsage,
	readmeHasApi,
	hasChangelog,
	hasLicense,
	// Code Quality (30)
	hasPlatformDeclarations,
	recentToolsVersion,
	supportsMultiplePlatforms,
	hasPublicAPI,
	hasDocComments,
	smallDepsSwift,
	// Testing (15)
	swiftHasTestTargets,
	swiftHasTestScript,
	hasCiConfig,
	// Health (30)
	hasDescription,
	hasKeywords,
	hasRepository,
	hasHomepage,
	reasonableSize,
	noVulnerabilities,
	maintenanceHealth,
	semverConsistency,
	authorVerified,
]
