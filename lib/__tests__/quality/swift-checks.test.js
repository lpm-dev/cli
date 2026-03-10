import { describe, expect, it } from "vitest"
import { swiftChecks } from "../../quality/swift-checks.js"

/**
 * Helper to run a specific Swift check by ID.
 * @param {string} id - Check ID
 * @param {object} context - Context object
 */
function runCheck(id, context) {
	const check = swiftChecks.find(c => c.id === id)
	if (!check) throw new Error(`Check "${id}" not found in swiftChecks`)
	return { ...check.run(context), maxPoints: check.maxPoints }
}

// ============================================================================
// Documentation checks (reused from JS + Swift install override)
// ============================================================================

describe("Swift readme-install", () => {
	it("passes when README mentions Package.swift", () => {
		const result = runCheck("readme-install", {
			readme: "Add the dependency to your Package.swift file",
		})
		expect(result.passed).toBe(true)
	})

	it("passes when README mentions .package(", () => {
		const result = runCheck("readme-install", {
			readme: 'Add .package(url: "...", from: "1.0.0") to dependencies',
		})
		expect(result.passed).toBe(true)
	})

	it("passes when README mentions Swift Package Manager", () => {
		const result = runCheck("readme-install", {
			readme: "Install via Swift Package Manager",
		})
		expect(result.passed).toBe(true)
	})

	it("passes when README mentions lpm add", () => {
		const result = runCheck("readme-install", {
			readme: "Run lpm add @lpm.dev/owner.my-swift-lib",
		})
		expect(result.passed).toBe(true)
	})

	it("passes with ## Requirements section", () => {
		const result = runCheck("readme-install", {
			readme: "## Requirements\niOS 16+",
		})
		expect(result.passed).toBe(true)
	})

	it("fails when README has no install info", () => {
		const result = runCheck("readme-install", {
			readme: "# My Swift Library\nThis does stuff.",
		})
		expect(result.passed).toBe(false)
	})

	it("fails with no README", () => {
		const result = runCheck("readme-install", { readme: null })
		expect(result.passed).toBe(false)
	})
})

// ============================================================================
// Code Quality checks (Swift-specific)
// ============================================================================

describe("has-platforms", () => {
	it("passes with platform declarations", () => {
		const result = runCheck("has-platforms", {
			swiftManifest: {
				platforms: [
					{ name: "ios", version: "16.0" },
					{ name: "macos", version: "13.0" },
				],
			},
		})
		expect(result.passed).toBe(true)
		expect(result.detail).toContain("ios 16.0")
	})

	it("fails with empty platforms", () => {
		const result = runCheck("has-platforms", {
			swiftManifest: { platforms: [] },
		})
		expect(result.passed).toBe(false)
	})

	it("fails with no manifest", () => {
		const result = runCheck("has-platforms", { swiftManifest: null })
		expect(result.passed).toBe(false)
	})
})

describe("recent-tools-version", () => {
	it("passes with 5.10", () => {
		const result = runCheck("recent-tools-version", {
			swiftManifest: { toolsVersion: "5.10.0" },
		})
		expect(result.passed).toBe(true)
	})

	it("passes with 5.9", () => {
		const result = runCheck("recent-tools-version", {
			swiftManifest: { toolsVersion: "5.9.0" },
		})
		expect(result.passed).toBe(true)
	})

	it("passes with 6.0", () => {
		const result = runCheck("recent-tools-version", {
			swiftManifest: { toolsVersion: "6.0.0" },
		})
		expect(result.passed).toBe(true)
	})

	it("fails with 5.8", () => {
		const result = runCheck("recent-tools-version", {
			swiftManifest: { toolsVersion: "5.8.0" },
		})
		expect(result.passed).toBe(false)
	})

	it("fails with 5.5", () => {
		const result = runCheck("recent-tools-version", {
			swiftManifest: { toolsVersion: "5.5.0" },
		})
		expect(result.passed).toBe(false)
	})

	it("fails with no manifest", () => {
		const result = runCheck("recent-tools-version", { swiftManifest: null })
		expect(result.passed).toBe(false)
	})

	it("fails with no toolsVersion", () => {
		const result = runCheck("recent-tools-version", {
			swiftManifest: { toolsVersion: null },
		})
		expect(result.passed).toBe(false)
	})
})

describe("multi-platform", () => {
	it("returns 4 points for 3+ platforms", () => {
		const result = runCheck("multi-platform", {
			swiftManifest: {
				platforms: [
					{ name: "ios", version: "16.0" },
					{ name: "macos", version: "13.0" },
					{ name: "watchos", version: "9.0" },
				],
			},
		})
		expect(result.passed).toBe(true)
		expect(result.points).toBe(4)
	})

	it("returns 3 points for 2 platforms", () => {
		const result = runCheck("multi-platform", {
			swiftManifest: {
				platforms: [
					{ name: "ios", version: "16.0" },
					{ name: "macos", version: "13.0" },
				],
			},
		})
		expect(result.points).toBe(3)
	})

	it("returns 2 points for 1 platform", () => {
		const result = runCheck("multi-platform", {
			swiftManifest: {
				platforms: [{ name: "ios", version: "16.0" }],
			},
		})
		expect(result.points).toBe(2)
	})

	it("returns 0 points for no platforms", () => {
		const result = runCheck("multi-platform", {
			swiftManifest: { platforms: [] },
		})
		expect(result.points).toBe(0)
		expect(result.passed).toBe(false)
	})

	it("fails with no manifest", () => {
		const result = runCheck("multi-platform", { swiftManifest: null })
		expect(result.passed).toBe(false)
	})
})

describe("has-public-api", () => {
	it("passes with Swift source files", () => {
		const result = runCheck("has-public-api", {
			files: [
				{ path: "Sources/MyLib/MyLib.swift", size: 500 },
				{ path: "Sources/MyLib/Helpers.swift", size: 300 },
			],
		})
		expect(result.passed).toBe(true)
		expect(result.detail).toContain("2 Swift source file")
		expect(result.serverOnly).toBe(true)
	})

	it("excludes test files from count", () => {
		const result = runCheck("has-public-api", {
			files: [
				{ path: "Sources/MyLib/MyLib.swift", size: 500 },
				{ path: "Tests/MyLibTests/Test.swift", size: 300 },
			],
		})
		expect(result.passed).toBe(true)
		expect(result.detail).toContain("1 Swift source file")
	})

	it("fails with no Swift source files", () => {
		const result = runCheck("has-public-api", {
			files: [
				{ path: "README.md", size: 100 },
				{ path: "Package.swift", size: 200 },
			],
		})
		expect(result.passed).toBe(false)
	})
})

describe("has-doc-comments", () => {
	it("returns serverOnly: true", () => {
		const result = runCheck("has-doc-comments", {})
		expect(result.passed).toBe(true)
		expect(result.serverOnly).toBe(true)
	})
})

describe("Swift small-deps", () => {
	it("returns 4 points for 0 dependencies", () => {
		const result = runCheck("small-deps", {
			swiftManifest: { dependencies: [] },
		})
		expect(result.points).toBe(4)
	})

	it("returns 3 points for 2 dependencies", () => {
		const result = runCheck("small-deps", {
			swiftManifest: { dependencies: [{}, {}] },
		})
		expect(result.points).toBe(3)
	})

	it("returns 2 points for 5 dependencies", () => {
		const result = runCheck("small-deps", {
			swiftManifest: { dependencies: Array.from({ length: 5 }, () => ({})) },
		})
		expect(result.points).toBe(2)
	})

	it("returns 1 point for 10 dependencies", () => {
		const result = runCheck("small-deps", {
			swiftManifest: { dependencies: Array.from({ length: 10 }, () => ({})) },
		})
		expect(result.points).toBe(1)
	})

	it("returns 0 points for 11+ dependencies", () => {
		const result = runCheck("small-deps", {
			swiftManifest: { dependencies: Array.from({ length: 11 }, () => ({})) },
		})
		expect(result.points).toBe(0)
		expect(result.passed).toBe(false)
	})

	it("returns 4 points with no manifest", () => {
		const result = runCheck("small-deps", { swiftManifest: null })
		expect(result.points).toBe(4)
	})
})

// ============================================================================
// Testing checks (Swift-specific)
// ============================================================================

describe("Swift has-test-files", () => {
	it("passes with test targets in manifest", () => {
		const result = runCheck("has-test-files", {
			swiftManifest: {
				targets: [
					{ name: "MyLib", type: "regular" },
					{ name: "MyLibTests", type: "test" },
				],
			},
			files: [],
		})
		expect(result.passed).toBe(true)
		expect(result.detail).toContain("MyLibTests")
	})

	it("passes with test files in file list", () => {
		const result = runCheck("has-test-files", {
			swiftManifest: { targets: [] },
			files: [{ path: "Tests/MyLibTests/Test.swift" }],
		})
		expect(result.passed).toBe(true)
	})

	it("fails with no test targets or test files", () => {
		const result = runCheck("has-test-files", {
			swiftManifest: {
				targets: [{ name: "MyLib", type: "regular" }],
			},
			files: [{ path: "Sources/MyLib/MyLib.swift" }],
		})
		expect(result.passed).toBe(false)
	})
})

describe("Swift has-test-script", () => {
	it("passes with test targets in manifest", () => {
		const result = runCheck("has-test-script", {
			swiftManifest: {
				targets: [{ name: "MyLibTests", type: "test" }],
			},
		})
		expect(result.passed).toBe(true)
	})

	it("fails with no test targets", () => {
		const result = runCheck("has-test-script", {
			swiftManifest: {
				targets: [{ name: "MyLib", type: "regular" }],
			},
		})
		expect(result.passed).toBe(false)
	})
})

// ============================================================================
// Universal checks still present
// ============================================================================

describe("Swift check registry", () => {
	it("has 25 checks total", () => {
		expect(swiftChecks).toHaveLength(25)
	})

	it("all checks have required fields", () => {
		for (const check of swiftChecks) {
			expect(check.id).toBeDefined()
			expect(check.category).toBeDefined()
			expect(check.label).toBeDefined()
			expect(check.maxPoints).toBeGreaterThan(0)
			expect(typeof check.run).toBe("function")
		}
	})

	it("category points sum to 100", () => {
		const catSums = {}
		for (const check of swiftChecks) {
			catSums[check.category] = (catSums[check.category] || 0) + check.maxPoints
		}
		const total = Object.values(catSums).reduce((a, b) => a + b, 0)
		expect(total).toBe(100)
	})

	it("has documentation category = 22 points", () => {
		const docChecks = swiftChecks.filter(c => c.category === "documentation")
		const total = docChecks.reduce((sum, c) => sum + c.maxPoints, 0)
		expect(total).toBe(22)
	})

	it("has code category = 31 points", () => {
		const codeChecks = swiftChecks.filter(c => c.category === "code")
		const total = codeChecks.reduce((sum, c) => sum + c.maxPoints, 0)
		expect(total).toBe(31)
	})

	it("has testing category = 11 points", () => {
		const testChecks = swiftChecks.filter(c => c.category === "testing")
		const total = testChecks.reduce((sum, c) => sum + c.maxPoints, 0)
		expect(total).toBe(11)
	})

	it("has health category = 36 points", () => {
		const healthChecks = swiftChecks.filter(c => c.category === "health")
		const total = healthChecks.reduce((sum, c) => sum + c.maxPoints, 0)
		expect(total).toBe(36)
	})

	it("includes universal has-readme check", () => {
		const check = swiftChecks.find(c => c.id === "has-readme")
		expect(check).toBeDefined()
	})

	it("includes universal semver-consistency check", () => {
		const check = swiftChecks.find(c => c.id === "semver-consistency")
		expect(check).toBeDefined()
	})

	it("does NOT include JS-only has-types check", () => {
		const check = swiftChecks.find(c => c.id === "has-types")
		expect(check).toBeUndefined()
	})

	it("does NOT include JS-only esm-exports check", () => {
		const check = swiftChecks.find(c => c.id === "esm-exports")
		expect(check).toBeUndefined()
	})

	it("does NOT include JS-only tree-shakable check", () => {
		const check = swiftChecks.find(c => c.id === "tree-shakable")
		expect(check).toBeUndefined()
	})
})
