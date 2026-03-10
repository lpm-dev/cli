import { describe, expect, it } from "vitest"
import { xcframeworkChecks } from "../../quality/swift-checks.js"

/**
 * Helper to run a specific XCFramework check by ID.
 * @param {string} id - Check ID
 * @param {object} context - Context object
 */
function runCheck(id, context) {
	const check = xcframeworkChecks.find(c => c.id === id)
	if (!check) throw new Error(`Check "${id}" not found in xcframeworkChecks`)
	return { ...check.run(context), maxPoints: check.maxPoints }
}

// ============================================================================
// XCFramework Code Quality checks
// ============================================================================

describe("xcf-valid-plist", () => {
	it("passes with platform slices", () => {
		const result = runCheck("xcf-valid-plist", {
			xcframeworkMeta: {
				slices: [
					{
						identifier: "ios-arm64",
						platform: "ios",
						variant: null,
						architectures: ["arm64"],
					},
				],
			},
		})
		expect(result.passed).toBe(true)
		expect(result.detail).toContain("1 platform slice")
	})

	it("passes with multiple slices", () => {
		const result = runCheck("xcf-valid-plist", {
			xcframeworkMeta: {
				slices: [
					{
						identifier: "ios-arm64",
						platform: "ios",
						architectures: ["arm64"],
					},
					{
						identifier: "ios-arm64_x86_64-simulator",
						platform: "ios",
						variant: "simulator",
						architectures: ["arm64", "x86_64"],
					},
					{
						identifier: "macos-arm64_x86_64",
						platform: "macos",
						architectures: ["arm64", "x86_64"],
					},
				],
			},
		})
		expect(result.passed).toBe(true)
		expect(result.detail).toContain("3 platform slices")
	})

	it("fails with empty slices", () => {
		const result = runCheck("xcf-valid-plist", {
			xcframeworkMeta: { slices: [] },
		})
		expect(result.passed).toBe(false)
		expect(result.detail).toContain("no platform slices")
	})

	it("fails with no xcframeworkMeta", () => {
		const result = runCheck("xcf-valid-plist", {})
		expect(result.passed).toBe(false)
	})
})

describe("xcf-multi-slice", () => {
	it("returns 15 points for 4+ unique platforms", () => {
		const result = runCheck("xcf-multi-slice", {
			xcframeworkMeta: {
				slices: [
					{ platform: "ios", architectures: ["arm64"] },
					{
						platform: "ios",
						variant: "simulator",
						architectures: ["arm64", "x86_64"],
					},
					{ platform: "macos", architectures: ["arm64", "x86_64"] },
					{ platform: "watchos", architectures: ["arm64"] },
				],
			},
		})
		expect(result.passed).toBe(true)
		expect(result.points).toBe(15)
	})

	it("returns 11 points for 3 unique platforms", () => {
		const result = runCheck("xcf-multi-slice", {
			xcframeworkMeta: {
				slices: [
					{ platform: "ios", architectures: ["arm64"] },
					{
						platform: "ios",
						variant: "simulator",
						architectures: ["arm64"],
					},
					{ platform: "macos", architectures: ["arm64"] },
				],
			},
		})
		expect(result.points).toBe(11)
	})

	it("returns 9 points for 2 unique platforms", () => {
		const result = runCheck("xcf-multi-slice", {
			xcframeworkMeta: {
				slices: [
					{ platform: "ios", architectures: ["arm64"] },
					{
						platform: "ios",
						variant: "simulator",
						architectures: ["arm64"],
					},
				],
			},
		})
		expect(result.points).toBe(9)
	})

	it("returns 4 points for 1 platform", () => {
		const result = runCheck("xcf-multi-slice", {
			xcframeworkMeta: {
				slices: [{ platform: "ios", architectures: ["arm64"] }],
			},
		})
		expect(result.points).toBe(4)
	})

	it("returns 0 points for no slices", () => {
		const result = runCheck("xcf-multi-slice", {
			xcframeworkMeta: { slices: [] },
		})
		expect(result.points).toBe(0)
		expect(result.passed).toBe(false)
	})

	it("counts variant as separate platform", () => {
		// ios and ios-simulator are different unique platforms
		const result = runCheck("xcf-multi-slice", {
			xcframeworkMeta: {
				slices: [
					{ platform: "ios", architectures: ["arm64"] },
					{
						platform: "ios",
						variant: "simulator",
						architectures: ["arm64", "x86_64"],
					},
				],
			},
		})
		expect(result.points).toBe(9) // 2 unique: ios, ios-simulator
	})

	it("fails with no xcframeworkMeta", () => {
		const result = runCheck("xcf-multi-slice", {})
		expect(result.passed).toBe(false)
	})
})

describe("xcf-size", () => {
	it("returns 5 points for ≤10 MB", () => {
		const result = runCheck("xcf-size", {
			unpackedSize: 5 * 1024 * 1024,
		})
		expect(result.passed).toBe(true)
		expect(result.points).toBe(5)
	})

	it("returns 4 points for ≤50 MB", () => {
		const result = runCheck("xcf-size", {
			unpackedSize: 30 * 1024 * 1024,
		})
		expect(result.points).toBe(4)
	})

	it("returns 3 points for ≤100 MB", () => {
		const result = runCheck("xcf-size", {
			unpackedSize: 80 * 1024 * 1024,
		})
		expect(result.points).toBe(3)
	})

	it("returns 1 point for ≤200 MB", () => {
		const result = runCheck("xcf-size", {
			unpackedSize: 150 * 1024 * 1024,
		})
		expect(result.points).toBe(1)
	})

	it("returns 0 points for >200 MB", () => {
		const result = runCheck("xcf-size", {
			unpackedSize: 250 * 1024 * 1024,
		})
		expect(result.points).toBe(0)
		expect(result.passed).toBe(false)
	})

	it("returns 5 points with no size data", () => {
		const result = runCheck("xcf-size", {})
		expect(result.points).toBe(5)
		expect(result.passed).toBe(true)
	})

	it("includes size in MB in detail", () => {
		const result = runCheck("xcf-size", {
			unpackedSize: 25 * 1024 * 1024,
		})
		expect(result.detail).toContain("25.0 MB")
	})
})

describe("xcf-architectures", () => {
	it("passes when arm64 is supported", () => {
		const result = runCheck("xcf-architectures", {
			xcframeworkMeta: {
				slices: [
					{ platform: "ios", architectures: ["arm64"] },
					{
						platform: "ios",
						variant: "simulator",
						architectures: ["arm64", "x86_64"],
					},
				],
			},
		})
		expect(result.passed).toBe(true)
		expect(result.detail).toContain("arm64")
	})

	it("fails when arm64 is not supported", () => {
		const result = runCheck("xcf-architectures", {
			xcframeworkMeta: {
				slices: [
					{
						platform: "ios",
						variant: "simulator",
						architectures: ["x86_64"],
					},
				],
			},
		})
		expect(result.passed).toBe(false)
		expect(result.detail).toContain("Missing arm64")
	})

	it("fails with no xcframeworkMeta", () => {
		const result = runCheck("xcf-architectures", {})
		expect(result.passed).toBe(false)
	})

	it("lists all unique architectures in detail", () => {
		const result = runCheck("xcf-architectures", {
			xcframeworkMeta: {
				slices: [
					{ platform: "ios", architectures: ["arm64"] },
					{
						platform: "macos",
						architectures: ["arm64", "x86_64"],
					},
				],
			},
		})
		expect(result.detail).toContain("arm64")
		expect(result.detail).toContain("x86_64")
	})
})

// ============================================================================
// XCFramework reasonable-size (health check — MB scale, not JS KB scale)
// ============================================================================

describe("reasonable-size (XCFramework MB thresholds)", () => {
	it("returns 3 points for ≤10 MB", () => {
		const result = runCheck("reasonable-size", {
			unpackedSize: 5 * 1024 * 1024,
		})
		expect(result.passed).toBe(true)
		expect(result.points).toBe(3)
		expect(result.maxPoints).toBe(3)
	})

	it("returns 2 points for ≤50 MB", () => {
		const result = runCheck("reasonable-size", {
			unpackedSize: 30 * 1024 * 1024,
		})
		expect(result.passed).toBe(true)
		expect(result.points).toBe(2)
	})

	it("returns 1 point for ≤100 MB", () => {
		const result = runCheck("reasonable-size", {
			unpackedSize: 80 * 1024 * 1024,
		})
		expect(result.passed).toBe(true)
		expect(result.points).toBe(1)
	})

	it("returns 0 points for >100 MB", () => {
		const result = runCheck("reasonable-size", {
			unpackedSize: 120 * 1024 * 1024,
		})
		expect(result.passed).toBe(false)
		expect(result.points).toBe(0)
	})

	it("returns 3 points when size is unknown", () => {
		const result = runCheck("reasonable-size", {})
		expect(result.points).toBe(3)
		expect(result.passed).toBe(true)
	})

	it("does NOT use KB thresholds — a 2 MB framework must score > 0", () => {
		// With JS KB thresholds (<1MB=1, ≥1MB=0), 2 MB would score 0.
		// With XCF MB thresholds (≤10MB=3), 2 MB must score 3.
		const result = runCheck("reasonable-size", {
			unpackedSize: 2 * 1024 * 1024,
		})
		expect(result.points).toBeGreaterThan(0)
	})

	it("includes size in MB in detail", () => {
		const result = runCheck("reasonable-size", {
			unpackedSize: 25 * 1024 * 1024,
		})
		expect(result.detail).toContain("25.0 MB")
	})
})

// ============================================================================
// XCFramework check registry
// ============================================================================

describe("XCFramework check registry", () => {
	it("has 21 checks total", () => {
		expect(xcframeworkChecks).toHaveLength(21)
	})

	it("all checks have required fields", () => {
		for (const check of xcframeworkChecks) {
			expect(check.id).toBeDefined()
			expect(check.category).toBeDefined()
			expect(check.label).toBeDefined()
			expect(check.maxPoints).toBeGreaterThan(0)
			expect(typeof check.run).toBe("function")
		}
	})

	it("category points sum to 100", () => {
		const catSums = {}
		for (const check of xcframeworkChecks) {
			catSums[check.category] = (catSums[check.category] || 0) + check.maxPoints
		}
		const total = Object.values(catSums).reduce((a, b) => a + b, 0)
		expect(total).toBe(100)
	})

	it("has documentation category = 22 points", () => {
		const docChecks = xcframeworkChecks.filter(
			c => c.category === "documentation",
		)
		const total = docChecks.reduce((sum, c) => sum + c.maxPoints, 0)
		expect(total).toBe(22)
	})

	it("has code category = 40 points", () => {
		const codeChecks = xcframeworkChecks.filter(c => c.category === "code")
		const total = codeChecks.reduce((sum, c) => sum + c.maxPoints, 0)
		expect(total).toBe(40)
	})

	it("has no testing category", () => {
		const testChecks = xcframeworkChecks.filter(c => c.category === "testing")
		expect(testChecks).toHaveLength(0)
	})

	it("has health category = 38 points", () => {
		const healthChecks = xcframeworkChecks.filter(c => c.category === "health")
		const total = healthChecks.reduce((sum, c) => sum + c.maxPoints, 0)
		expect(total).toBe(38)
	})

	it("includes xcf-specific check IDs", () => {
		const ids = xcframeworkChecks.map(c => c.id)
		expect(ids).toContain("xcf-valid-plist")
		expect(ids).toContain("xcf-multi-slice")
		expect(ids).toContain("xcf-size")
		expect(ids).toContain("xcf-architectures")
	})

	it("includes universal documentation checks", () => {
		const ids = xcframeworkChecks.map(c => c.id)
		expect(ids).toContain("has-readme")
		expect(ids).toContain("readme-install")
		expect(ids).toContain("readme-usage")
		expect(ids).toContain("readme-api")
		expect(ids).toContain("has-changelog")
		expect(ids).toContain("has-license")
	})

	it("includes universal health checks", () => {
		const ids = xcframeworkChecks.map(c => c.id)
		expect(ids).toContain("has-description")
		expect(ids).toContain("has-keywords")
		expect(ids).toContain("has-repository")
		expect(ids).toContain("semver-consistency")
	})

	it("does NOT include Swift source-code checks", () => {
		const ids = xcframeworkChecks.map(c => c.id)
		expect(ids).not.toContain("has-platforms")
		expect(ids).not.toContain("recent-tools-version")
		expect(ids).not.toContain("multi-platform")
		expect(ids).not.toContain("has-public-api")
		expect(ids).not.toContain("has-doc-comments")
	})

	it("does NOT include JS-specific checks", () => {
		const ids = xcframeworkChecks.map(c => c.id)
		expect(ids).not.toContain("has-types")
		expect(ids).not.toContain("esm-exports")
		expect(ids).not.toContain("tree-shakable")
	})
})
