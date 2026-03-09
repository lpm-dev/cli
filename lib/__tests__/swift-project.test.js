import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	detectFramework,
	getDefaultPath,
	isSwiftProject,
} from "../project-utils.js"
import {
	autoLinkXcodePackage,
	ensureXcodeLocalPackage,
	parsePlatforms,
	parseSwiftTargetName,
	resolveTargetName,
	scopedTargetName,
} from "../swift-project.js"

// ============================================================================
// detectFramework — Swift project detection
// ============================================================================

describe("detectFramework — Swift projects", () => {
	let tmpDir
	let originalCwd

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".test-swift-detect-"))
		originalCwd = process.cwd()
		process.chdir(tmpDir)
	})

	afterEach(() => {
		process.chdir(originalCwd)
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it("detects swift-spm from Package.swift", () => {
		fs.writeFileSync(path.join(tmpDir, "Package.swift"), "// swift")
		expect(detectFramework()).toBe("swift-spm")
	})

	it("detects swift-xcode from .xcodeproj", () => {
		fs.mkdirSync(path.join(tmpDir, "MyApp.xcodeproj"))
		expect(detectFramework()).toBe("swift-xcode")
	})

	it("detects swift-xcode from .xcworkspace", () => {
		fs.mkdirSync(path.join(tmpDir, "MyApp.xcworkspace"))
		expect(detectFramework()).toBe("swift-xcode")
	})

	it("prioritizes Package.swift over .xcodeproj", () => {
		fs.writeFileSync(path.join(tmpDir, "Package.swift"), "// swift")
		fs.mkdirSync(path.join(tmpDir, "MyApp.xcodeproj"))
		expect(detectFramework()).toBe("swift-spm")
	})

	it("returns unknown for empty directory", () => {
		expect(detectFramework()).toBe("unknown")
	})

	it("returns JS framework when package.json has next", () => {
		fs.writeFileSync(
			path.join(tmpDir, "package.json"),
			JSON.stringify({ dependencies: { next: "^14" } }),
		)
		expect(detectFramework()).toBe("next-pages")
	})
})

// ============================================================================
// isSwiftProject
// ============================================================================

describe("isSwiftProject", () => {
	it("returns true for swift-spm", () => {
		expect(isSwiftProject("swift-spm")).toBe(true)
	})

	it("returns true for swift-xcode", () => {
		expect(isSwiftProject("swift-xcode")).toBe(true)
	})

	it("returns false for JS frameworks", () => {
		expect(isSwiftProject("next-app")).toBe(false)
		expect(isSwiftProject("vite")).toBe(false)
		expect(isSwiftProject("unknown")).toBe(false)
	})
})

// ============================================================================
// getDefaultPath — Swift
// ============================================================================

describe("getDefaultPath — Swift", () => {
	it("returns Sources/{target} for swift-spm with target", () => {
		expect(getDefaultPath("swift-spm", "MyLib")).toBe("Sources/MyLib")
	})

	it("returns Sources for swift-spm without target", () => {
		expect(getDefaultPath("swift-spm")).toBe("Sources")
	})

	it("returns LPMComponents path for swift-xcode without target", () => {
		expect(getDefaultPath("swift-xcode")).toBe(
			"Packages/LPMComponents/Sources/LPMComponents",
		)
	})

	it("returns target-specific path for swift-xcode with target", () => {
		expect(getDefaultPath("swift-xcode", "Haptic")).toBe(
			"Packages/LPMComponents/Sources/Haptic",
		)
	})
})

// ============================================================================
// parseSwiftTargetName
// ============================================================================

describe("parseSwiftTargetName", () => {
	let tmpDir

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".test-parse-target-"))
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it("extracts library product name from Package.swift", () => {
		const pkgPath = path.join(tmpDir, "Package.swift")
		fs.writeFileSync(
			pkgPath,
			`
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Haptic",
    products: [
        .library(name: "Haptic", targets: ["Haptic"]),
    ],
    targets: [
        .target(name: "Haptic", path: "Sources/Haptic"),
        .testTarget(name: "HapticTests", dependencies: ["Haptic"]),
    ]
)
`,
		)
		expect(parseSwiftTargetName(pkgPath)).toBe("Haptic")
	})

	it("falls back to first non-test target when no library product", () => {
		const pkgPath = path.join(tmpDir, "Package.swift")
		fs.writeFileSync(
			pkgPath,
			`
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MyTool",
    targets: [
        .testTarget(name: "MyToolTests"),
        .target(name: "MyTool"),
    ]
)
`,
		)
		expect(parseSwiftTargetName(pkgPath)).toBe("MyTool")
	})

	it("returns null for non-existent file", () => {
		expect(parseSwiftTargetName("/does/not/exist.swift")).toBeNull()
	})

	it("returns null for Package.swift with no targets", () => {
		const pkgPath = path.join(tmpDir, "Package.swift")
		fs.writeFileSync(
			pkgPath,
			`
// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "Empty")
`,
		)
		expect(parseSwiftTargetName(pkgPath)).toBeNull()
	})

	it("skips test targets when falling back", () => {
		const pkgPath = path.join(tmpDir, "Package.swift")
		fs.writeFileSync(
			pkgPath,
			`
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Lib",
    targets: [
        .testTarget(name: "LibTests"),
    ]
)
`,
		)
		expect(parseSwiftTargetName(pkgPath)).toBeNull()
	})
})

// ============================================================================
// parsePlatforms
// ============================================================================

describe("parsePlatforms", () => {
	let tmpDir

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".test-parse-plat-"))
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it("extracts platform declarations", () => {
		const pkgPath = path.join(tmpDir, "Package.swift")
		fs.writeFileSync(
			pkgPath,
			`
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Haptic",
    platforms: [
        .iOS(.v13),
        .macOS(.v11),
        .watchOS(.v7),
    ],
    products: []
)
`,
		)
		const platforms = parsePlatforms(pkgPath)
		expect(platforms).toEqual([".iOS(.v13)", ".macOS(.v11)", ".watchOS(.v7)"])
	})

	it("returns null when no platforms block", () => {
		const pkgPath = path.join(tmpDir, "Package.swift")
		fs.writeFileSync(
			pkgPath,
			`
// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "NoPlatforms", products: [])
`,
		)
		expect(parsePlatforms(pkgPath)).toBeNull()
	})

	it("returns null for non-existent file", () => {
		expect(parsePlatforms("/does/not/exist.swift")).toBeNull()
	})
})

// ============================================================================
// scopedTargetName
// ============================================================================

describe("scopedTargetName", () => {
	it("converts @lpm.dev/user.package to PascalCase", () => {
		expect(scopedTargetName("@lpm.dev/user2.haptic")).toBe("User2Haptic")
	})

	it("handles multi-segment names with hyphens", () => {
		expect(scopedTargetName("@lpm.dev/neo.my-great-lib")).toBe("NeoMyGreatLib")
	})

	it("handles underscores", () => {
		expect(scopedTargetName("@lpm.dev/user.my_lib")).toBe("UserMyLib")
	})

	it("handles single segment after scope", () => {
		expect(scopedTargetName("@lpm.dev/colors")).toBe("Colors")
	})
})

// ============================================================================
// resolveTargetName
// ============================================================================

describe("resolveTargetName", () => {
	let tmpDir

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".test-resolve-"))
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it("uses original name when no manifest exists", () => {
		const manifestPath = path.join(tmpDir, "Package.swift")
		const result = resolveTargetName(
			"Haptic",
			"@lpm.dev/neo.haptic",
			manifestPath,
		)
		expect(result).toEqual({ targetName: "Haptic", wasScoped: false })
	})

	it("uses original name when no conflict", () => {
		const manifestPath = path.join(tmpDir, "Package.swift")
		fs.writeFileSync(
			manifestPath,
			`
let package = Package(
    name: "LPMComponents",
    targets: [
        .target(name: "Colors"),
    ]
)
`,
		)
		const result = resolveTargetName(
			"Haptic",
			"@lpm.dev/neo.haptic",
			manifestPath,
		)
		expect(result).toEqual({ targetName: "Haptic", wasScoped: false })
	})

	it("scopes name when original conflicts", () => {
		const manifestPath = path.join(tmpDir, "Package.swift")
		fs.writeFileSync(
			manifestPath,
			`
let package = Package(
    name: "LPMComponents",
    targets: [
        .target(name: "Haptic"),
    ]
)
`,
		)
		const result = resolveTargetName(
			"Haptic",
			"@lpm.dev/user2.haptic",
			manifestPath,
		)
		expect(result).toEqual({ targetName: "User2Haptic", wasScoped: true })
	})
})

// ============================================================================
// ensureXcodeLocalPackage
// ============================================================================

describe("ensureXcodeLocalPackage", () => {
	let tmpDir
	let originalCwd

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".test-xcode-pkg-"))
		originalCwd = process.cwd()
		process.chdir(tmpDir)
	})

	afterEach(() => {
		process.chdir(originalCwd)
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it("creates legacy single-target manifest when no targetName given", () => {
		const result = ensureXcodeLocalPackage()
		expect(result.created).toBe(true)
		expect(result.installPath).toContain("LPMComponents")

		const manifestPath = path.join(
			tmpDir,
			"Packages",
			"LPMComponents",
			"Package.swift",
		)
		expect(fs.existsSync(manifestPath)).toBe(true)

		const manifest = fs.readFileSync(manifestPath, "utf-8")
		expect(manifest).toContain("swift-tools-version")
		expect(manifest).toContain('name: "LPMComponents"')

		// Check placeholder file
		const placeholder = path.join(
			tmpDir,
			"Packages",
			"LPMComponents",
			"Sources",
			"LPMComponents",
			"LPMComponents.swift",
		)
		expect(fs.existsSync(placeholder)).toBe(true)
	})

	it("creates multi-target manifest when targetName is given", () => {
		const result = ensureXcodeLocalPackage("Haptic", [
			".iOS(.v13)",
			".macOS(.v11)",
		])
		expect(result.created).toBe(true)
		expect(result.targetName).toBe("Haptic")

		const manifestPath = path.join(
			tmpDir,
			"Packages",
			"LPMComponents",
			"Package.swift",
		)
		const manifest = fs.readFileSync(manifestPath, "utf-8")
		expect(manifest).toContain('.library(name: "Haptic", targets: ["Haptic"])')
		expect(manifest).toContain(
			'.target(name: "Haptic", path: "Sources/Haptic")',
		)
		expect(manifest).toContain(".iOS(.v13)")
		expect(manifest).toContain(".macOS(.v11)")

		// Sources/Haptic directory should exist
		const sourcesDir = path.join(
			tmpDir,
			"Packages",
			"LPMComponents",
			"Sources",
			"Haptic",
		)
		expect(fs.existsSync(sourcesDir)).toBe(true)
	})

	it("uses default platforms when none provided with targetName", () => {
		ensureXcodeLocalPackage("Haptic")

		const manifestPath = path.join(
			tmpDir,
			"Packages",
			"LPMComponents",
			"Package.swift",
		)
		const manifest = fs.readFileSync(manifestPath, "utf-8")
		expect(manifest).toContain(".iOS(.v16)")
		expect(manifest).toContain(".macOS(.v13)")
	})

	it("returns created=false when Package.swift already exists", () => {
		ensureXcodeLocalPackage()
		const result = ensureXcodeLocalPackage()
		expect(result.created).toBe(false)
	})

	it("adds new target to existing manifest", () => {
		// First install
		ensureXcodeLocalPackage("Haptic", [".iOS(.v13)"])

		// Second install — different target
		const result = ensureXcodeLocalPackage("Colors")
		expect(result.created).toBe(false)
		expect(result.targetName).toBe("Colors")

		const manifestPath = path.join(
			tmpDir,
			"Packages",
			"LPMComponents",
			"Package.swift",
		)
		const manifest = fs.readFileSync(manifestPath, "utf-8")
		expect(manifest).toContain('.library(name: "Haptic"')
		expect(manifest).toContain('.library(name: "Colors"')
		expect(manifest).toContain('.target(name: "Haptic"')
		expect(manifest).toContain('.target(name: "Colors"')
	})

	it("does not duplicate an existing target", () => {
		ensureXcodeLocalPackage("Haptic")
		ensureXcodeLocalPackage("Haptic")

		const manifestPath = path.join(
			tmpDir,
			"Packages",
			"LPMComponents",
			"Package.swift",
		)
		const manifest = fs.readFileSync(manifestPath, "utf-8")
		const libraryMatches = manifest.match(/\.library\(name: "Haptic"/g)
		expect(libraryMatches).toHaveLength(1)
	})

	it("returns correct installPath with targetName", () => {
		const result = ensureXcodeLocalPackage("Haptic")
		const expected = path.join(
			tmpDir,
			"Packages",
			"LPMComponents",
			"Sources",
			"Haptic",
		)
		expect(result.installPath).toBe(expected)
	})
})

// ============================================================================
// autoLinkXcodePackage
// ============================================================================

describe("autoLinkXcodePackage", () => {
	let tmpDir
	let originalCwd

	// Minimal but valid pbxproj that the xcode parser can handle
	const MINIMAL_PBXPROJ = `// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {
	};
	objectVersion = 77;
	objects = {

/* Begin PBXFrameworksBuildPhase section */
		AABBCCDD11223344EEFF0011 /* Frameworks */ = {
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXNativeTarget section */
		11223344AABBCCDD55667788 /* MyApp */ = {
			isa = PBXNativeTarget;
			buildPhases = (
				AABBCCDD11223344EEFF0011 /* Frameworks */,
			);
			productReference = 5566778899AABBCC11223344 /* MyApp.app */;
			productType = "com.apple.product-type.application";
		};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		00112233AABBCCDD44556677 /* Project object */ = {
			isa = PBXProject;
			buildConfigurationList = AABB001122334455EEFF0011;
			mainGroup = 9988776655443322AABBCCDD;
		};
/* End PBXProject section */

	};
	rootObject = 00112233AABBCCDD44556677 /* Project object */;
}
`

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".test-autolink-"))
		originalCwd = process.cwd()
		process.chdir(tmpDir)
	})

	afterEach(() => {
		process.chdir(originalCwd)
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it("returns failure when no .xcodeproj found", () => {
		const result = autoLinkXcodePackage("Haptic")
		expect(result.success).toBe(false)
		expect(result.message).toContain(".xcodeproj")
	})

	it("links a package to the Xcode project", () => {
		const xcodeprojDir = path.join(tmpDir, "MyApp.xcodeproj")
		fs.mkdirSync(xcodeprojDir)
		fs.writeFileSync(
			path.join(xcodeprojDir, "project.pbxproj"),
			MINIMAL_PBXPROJ,
		)

		const result = autoLinkXcodePackage("Haptic")
		expect(result.success).toBe(true)

		const content = fs.readFileSync(
			path.join(xcodeprojDir, "project.pbxproj"),
			"utf-8",
		)

		// Should have all required entries
		expect(content).toContain(
			'XCLocalSwiftPackageReference "Packages/LPMComponents"',
		)
		expect(content).toContain("isa = XCSwiftPackageProductDependency")
		expect(content).toContain("productName = Haptic")
		expect(content).toContain("Haptic in Frameworks")
		expect(content).toContain("packageReferences = (")
		expect(content).toContain("packageProductDependencies = (")
		expect(content).toContain("productRef =")
	})

	it("places all sections inside objects block (xcode library guarantee)", () => {
		const xcodeprojDir = path.join(tmpDir, "MyApp.xcodeproj")
		fs.mkdirSync(xcodeprojDir)
		fs.writeFileSync(
			path.join(xcodeprojDir, "project.pbxproj"),
			MINIMAL_PBXPROJ,
		)

		autoLinkXcodePackage("Haptic")

		const content = fs.readFileSync(
			path.join(xcodeprojDir, "project.pbxproj"),
			"utf-8",
		)

		const rootObjectIdx = content.indexOf("rootObject")
		const localPkgRefIdx = content.indexOf("XCLocalSwiftPackageReference")
		const productDepIdx = content.indexOf("XCSwiftPackageProductDependency")
		const buildFileIdx = content.indexOf("PBXBuildFile section")

		// All sections must be before rootObject (inside objects block)
		expect(localPkgRefIdx).toBeGreaterThan(0)
		expect(localPkgRefIdx).toBeLessThan(rootObjectIdx)
		expect(productDepIdx).toBeLessThan(rootObjectIdx)
		expect(buildFileIdx).toBeLessThan(rootObjectIdx)
	})

	it("creates PBXBuildFile section when it does not exist", () => {
		const xcodeprojDir = path.join(tmpDir, "MyApp.xcodeproj")
		fs.mkdirSync(xcodeprojDir)
		// MINIMAL_PBXPROJ already has no PBXBuildFile section
		fs.writeFileSync(
			path.join(xcodeprojDir, "project.pbxproj"),
			MINIMAL_PBXPROJ,
		)

		const result = autoLinkXcodePackage("Haptic")
		expect(result.success).toBe(true)

		const content = fs.readFileSync(
			path.join(xcodeprojDir, "project.pbxproj"),
			"utf-8",
		)
		expect(content).toContain("/* Begin PBXBuildFile section */")
		expect(content).toContain("Haptic in Frameworks")
	})

	it("returns already linked when package reference exists", () => {
		const xcodeprojDir = path.join(tmpDir, "MyApp.xcodeproj")
		fs.mkdirSync(xcodeprojDir)
		fs.writeFileSync(
			path.join(xcodeprojDir, "project.pbxproj"),
			MINIMAL_PBXPROJ,
		)

		autoLinkXcodePackage("Haptic")

		const result = autoLinkXcodePackage("Haptic")
		expect(result.success).toBe(true)
		expect(result.message).toBe("Already linked")
	})

	it("does not duplicate entries on repeated calls", () => {
		const xcodeprojDir = path.join(tmpDir, "MyApp.xcodeproj")
		fs.mkdirSync(xcodeprojDir)
		fs.writeFileSync(
			path.join(xcodeprojDir, "project.pbxproj"),
			MINIMAL_PBXPROJ,
		)

		autoLinkXcodePackage("Haptic")
		autoLinkXcodePackage("Haptic")

		const content = fs.readFileSync(
			path.join(xcodeprojDir, "project.pbxproj"),
			"utf-8",
		)
		const productNameMatches = content.match(/productName = Haptic/g)
		expect(productNameMatches).toHaveLength(1)
	})

	it("adds new product dependency to already-linked package", () => {
		const xcodeprojDir = path.join(tmpDir, "MyApp.xcodeproj")
		fs.mkdirSync(xcodeprojDir)
		fs.writeFileSync(
			path.join(xcodeprojDir, "project.pbxproj"),
			MINIMAL_PBXPROJ,
		)

		autoLinkXcodePackage("Haptic")

		const result = autoLinkXcodePackage("Colors")
		expect(result.success).toBe(true)
		expect(result.message).toContain("Colors")

		const content = fs.readFileSync(
			path.join(xcodeprojDir, "project.pbxproj"),
			"utf-8",
		)
		expect(content).toContain("productName = Haptic")
		expect(content).toContain("productName = Colors")
		expect(content).toContain("Colors in Frameworks")
		expect(content).toContain("Haptic in Frameworks")

		// Should still have only one local package reference
		const pkgRefMatches = content.match(
			/XCLocalSwiftPackageReference "Packages\/LPMComponents"/g,
		)
		expect(pkgRefMatches).toHaveLength(2) // one in section, one in packageReferences array
	})

	it("links three products sequentially", () => {
		const xcodeprojDir = path.join(tmpDir, "MyApp.xcodeproj")
		fs.mkdirSync(xcodeprojDir)
		fs.writeFileSync(
			path.join(xcodeprojDir, "project.pbxproj"),
			MINIMAL_PBXPROJ,
		)

		autoLinkXcodePackage("Haptic")
		autoLinkXcodePackage("Colors")
		autoLinkXcodePackage("DateTime")

		const content = fs.readFileSync(
			path.join(xcodeprojDir, "project.pbxproj"),
			"utf-8",
		)
		expect(content).toContain("productName = Haptic")
		expect(content).toContain("productName = Colors")
		expect(content).toContain("productName = DateTime")
		expect(content).toContain("Haptic in Frameworks")
		expect(content).toContain("Colors in Frameworks")
		expect(content).toContain("DateTime in Frameworks")
	})
})
