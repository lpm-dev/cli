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

// --- XCFramework-specific checks ---

export const xcfHasValidPlist = {
	id: "xcf-valid-plist",
	category: "code",
	label: "Valid Info.plist",
	maxPoints: 10,
	run: ({ xcframeworkMeta }) => {
		if (!xcframeworkMeta)
			return { passed: false, detail: "No XCFramework metadata" }
		const slices = xcframeworkMeta.slices || []
		if (slices.length === 0)
			return {
				passed: false,
				detail: "Info.plist has no platform slices",
			}
		return {
			passed: true,
			detail: `Info.plist defines ${slices.length} platform slice${slices.length !== 1 ? "s" : ""}`,
		}
	},
}

export const xcfMultipleSlices = {
	id: "xcf-multi-slice",
	category: "code",
	label: "Supports multiple platform slices",
	maxPoints: 10,
	run: ({ xcframeworkMeta }) => {
		if (!xcframeworkMeta)
			return { passed: false, detail: "No XCFramework metadata" }
		const slices = xcframeworkMeta.slices || []
		const uniquePlatforms = new Set(
			slices.map((s) =>
				s.variant ? `${s.platform}-${s.variant}` : s.platform,
			),
		)
		const count = uniquePlatforms.size
		let points
		if (count >= 4) points = 10
		else if (count === 3) points = 8
		else if (count === 2) points = 5
		else if (count === 1) points = 2
		else points = 0
		const labels = [...uniquePlatforms].join(", ")
		return {
			passed: points > 0,
			points,
			detail:
				count > 0
					? `${count} platform target${count !== 1 ? "s" : ""}: ${labels}`
					: "No platform slices",
		}
	},
}

export const xcfReasonableSize = {
	id: "xcf-size",
	category: "code",
	label: "Reasonable framework size",
	maxPoints: 5,
	run: ({ unpackedSize }) => {
		if (!unpackedSize) return { passed: true, points: 5, detail: "No size data" }
		const mb = unpackedSize / (1024 * 1024)
		let points
		if (mb <= 10) points = 5
		else if (mb <= 50) points = 4
		else if (mb <= 100) points = 3
		else if (mb <= 200) points = 1
		else points = 0
		return {
			passed: points > 0,
			points,
			detail: `${mb.toFixed(1)} MB`,
		}
	},
}

export const xcfHasArchitectures = {
	id: "xcf-architectures",
	category: "code",
	label: "Supports arm64 architecture",
	maxPoints: 5,
	run: ({ xcframeworkMeta }) => {
		if (!xcframeworkMeta)
			return { passed: false, detail: "No XCFramework metadata" }
		const slices = xcframeworkMeta.slices || []
		const allArchs = new Set(slices.flatMap((s) => s.architectures || []))
		const hasArm64 = allArchs.has("arm64")
		return {
			passed: hasArm64,
			detail: hasArm64
				? `Architectures: ${[...allArchs].join(", ")}`
				: "Missing arm64 architecture support",
		}
	},
}

// --- Export check sets ---
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

// XCFramework CI config check — binary packages have limited testability,
// so CI/CD configuration carries full testing weight (15 pts).
const xcfHasCiConfig = {
	id: "has-ci-config",
	category: "testing",
	label: "Has CI/CD configuration",
	maxPoints: 15,
	run: hasCiConfig.run,
}

export const xcframeworkChecks = [
	// Documentation (25)
	hasReadme,
	swiftReadmeHasInstall,
	readmeHasUsage,
	readmeHasApi,
	hasChangelog,
	hasLicense,
	// Code Quality (30) — XCFramework-specific
	xcfHasValidPlist,
	xcfMultipleSlices,
	xcfReasonableSize,
	xcfHasArchitectures,
	// Testing (15) — binary packages have limited testability
	xcfHasCiConfig,
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
