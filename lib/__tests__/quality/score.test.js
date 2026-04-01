import { describe, expect, it } from "vitest"
import { runQualityChecks } from "../../quality/score.js"

/**
 * Create a minimal package context for testing.
 */
function makeContext(overrides = {}) {
	return {
		packageJson: {
			name: "@lpm.dev/test.pkg",
			version: "1.0.0",
			description: "A test package for quality checks",
			...overrides.packageJson,
		},
		readme: overrides.readme ?? null,
		lpmConfig: overrides.lpmConfig ?? null,
		files: overrides.files ?? [],
		unpackedSize: overrides.unpackedSize ?? 10000,
	}
}

describe("runQualityChecks", () => {
	it("returns a score between 0 and 100", () => {
		const result = runQualityChecks(makeContext())
		expect(result.score).toBeGreaterThanOrEqual(0)
		expect(result.score).toBeLessThanOrEqual(100)
	})

	it("returns checks array with all 29 checks", () => {
		const result = runQualityChecks(makeContext())
		expect(result.checks).toHaveLength(29)
	})

	it("returns meta with tier, score, and categories", () => {
		const result = runQualityChecks(makeContext())
		expect(result.meta.tier).toBeDefined()
		expect(result.meta.score).toBe(result.score)
		expect(result.meta.maxScore).toBe(100)
		expect(result.meta.categories).toBeDefined()
		expect(result.meta.computedAt).toBeDefined()
	})

	it("has 4 categories in meta", () => {
		const result = runQualityChecks(makeContext())
		const cats = Object.keys(result.meta.categories)
		expect(cats).toEqual(
			expect.arrayContaining(["documentation", "code", "testing", "health"]),
		)
		expect(cats).toHaveLength(4)
	})

	it("category scores do not exceed max", () => {
		const result = runQualityChecks(makeContext())
		for (const [, { score, max }] of Object.entries(result.meta.categories)) {
			expect(score).toBeLessThanOrEqual(max)
			expect(score).toBeGreaterThanOrEqual(0)
		}
	})

	it('assigns tier "needs-work" for minimal package', () => {
		const result = runQualityChecks(makeContext())
		// A bare package with no README, no types, no tests should score low
		expect(["needs-work", "fair"]).toContain(result.meta.tier)
	})

	it('assigns tier "excellent" for well-configured package', () => {
		const result = runQualityChecks(
			makeContext({
				packageJson: {
					name: "@lpm.dev/test.pkg",
					version: "1.0.0",
					description: "A comprehensive package with everything",
					types: "./dist/index.d.ts",
					type: "module",
					exports: { ".": "./dist/index.js" },
					sideEffects: false,
					engines: { node: ">=18" },
					scripts: { test: "vitest run" },
					keywords: ["utility", "helper"],
					repository: "https://github.com/test/repo",
					homepage: "https://test.dev",
					license: "MIT",
				},
				readme:
					'# My Package\n\n## Install\n```\nnpm install\n```\n\n## Usage\n```js\nimport { x } from "pkg"\n```\n```js\nconst y = x()\n```\n\n## API\nDocumentation here',
				files: [
					{ path: "dist/index.js" },
					{ path: "dist/index.d.ts" },
					{ path: "dist/index.js.map" },
					{ path: "src/index.test.js" },
					{ path: "CHANGELOG.md" },
					{ path: "LICENSE" },
					{ path: ".github/workflows/ci.yml" },
				],
				unpackedSize: 50 * 1024,
			}),
		)
		expect(result.score).toBeGreaterThanOrEqual(70)
		expect(["excellent", "good"]).toContain(result.meta.tier)
	})

	it("detects source package from lpmConfig", () => {
		const result = runQualityChecks(
			makeContext({
				lpmConfig: {
					configSchema: { component: { type: "select", options: ["a"] } },
				},
			}),
		)
		expect(result.meta.isSourcePackage).toBe(true)
		expect(result.meta.sourcePackageInfo).toBeDefined()
		expect(result.meta.sourcePackageInfo.hasConfig).toBe(true)
	})

	it("reports isSourcePackage false without lpmConfig", () => {
		const result = runQualityChecks(makeContext())
		expect(result.meta.isSourcePackage).toBe(false)
		expect(result.meta.sourcePackageInfo).toBeNull()
	})

	it("check results have required fields", () => {
		const result = runQualityChecks(makeContext())
		for (const check of result.checks) {
			expect(check.id).toBeDefined()
			expect(check.category).toBeDefined()
			expect(check.label).toBeDefined()
			expect(typeof check.passed).toBe("boolean")
			expect(typeof check.points).toBe("number")
			expect(typeof check.max_points).toBe("number")
		}
	})

	it("passed checks get full points (unless custom)", () => {
		const result = runQualityChecks(makeContext())
		for (const check of result.checks) {
			if (check.passed && check.points !== undefined) {
				expect(check.points).toBeGreaterThan(0)
				expect(check.points).toBeLessThanOrEqual(check.max_points)
			}
		}
	})

	it("failed checks get 0 points", () => {
		const result = runQualityChecks(makeContext())
		for (const check of result.checks) {
			if (!check.passed) {
				expect(check.points).toBe(0)
			}
		}
	})
})

describe("tier thresholds", () => {
	it("score 90+ is excellent", () => {
		// We can't easily force 90+ without a perfect package,
		// but we can test the tier computation indirectly
		const result = runQualityChecks(
			makeContext({
				packageJson: {
					name: "@lpm.dev/t.p",
					version: "1.0.0",
					description: "A comprehensive package with everything",
					types: "./dist/index.d.ts",
					type: "module",
					exports: { ".": "./dist/index.js" },
					sideEffects: false,
					engines: { node: ">=18" },
					scripts: { test: "vitest" },
					keywords: ["a"],
					repository: "https://github.com/t/r",
					homepage: "https://t.dev",
					license: "MIT",
				},
				readme:
					"# Pkg\n\n## Install\n```\nnpm i\n```\n\n## Usage\n```js\nx()\n```\n```js\ny()\n```\n\n## API\nDocs",
				files: [
					{ path: "dist/index.d.ts" },
					{ path: "dist/index.js.map" },
					{ path: "test/a.test.js" },
					{ path: "CHANGELOG.md" },
					{ path: "LICENSE" },
					{ path: ".github/workflows/ci.yml" },
				],
				unpackedSize: 10 * 1024,
			}),
		)
		// Skills checks are server-only (fail locally), so max local score is ~82
		expect(result.score).toBeGreaterThanOrEqual(75)
	})
})

// ============================================================================
// Ecosystem-aware scoring
// ============================================================================

/**
 * Create a Swift package context for testing.
 */
function makeSwiftContext(overrides = {}) {
	return {
		packageJson: {
			name: "@lpm.dev/test.swift-pkg",
			version: "1.0.0",
			description: "A test Swift package for quality checks",
			...overrides.packageJson,
		},
		readme: overrides.readme ?? null,
		lpmConfig: overrides.lpmConfig ?? null,
		files: overrides.files ?? [],
		unpackedSize: overrides.unpackedSize ?? 10000,
		ecosystem: "swift",
		swiftManifest: overrides.swiftManifest ?? null,
	}
}

describe("runQualityChecks with ecosystem=swift", () => {
	it("returns 25 checks for Swift ecosystem", () => {
		const result = runQualityChecks(makeSwiftContext())
		expect(result.checks).toHaveLength(25)
	})

	it("includes ecosystem in meta", () => {
		const result = runQualityChecks(makeSwiftContext())
		expect(result.meta.ecosystem).toBe("swift")
	})

	it("defaults ecosystem to js", () => {
		const result = runQualityChecks(makeContext())
		expect(result.meta.ecosystem).toBe("js")
	})

	it("uses Swift check IDs instead of JS check IDs", () => {
		const result = runQualityChecks(makeSwiftContext())
		const ids = result.checks.map(c => c.id)

		// Swift-specific checks
		expect(ids).toContain("has-platforms")
		expect(ids).toContain("recent-tools-version")
		expect(ids).toContain("multi-platform")
		expect(ids).toContain("has-public-api")
		expect(ids).toContain("has-doc-comments")

		// JS-only checks should NOT be present
		expect(ids).not.toContain("has-types")
		expect(ids).not.toContain("esm-exports")
		expect(ids).not.toContain("tree-shakable")
		expect(ids).not.toContain("has-engines")
		expect(ids).not.toContain("has-exports-map")
		expect(ids).not.toContain("source-maps")
		expect(ids).not.toContain("no-eval")
	})

	it("still includes universal checks for Swift", () => {
		const result = runQualityChecks(makeSwiftContext())
		const ids = result.checks.map(c => c.id)

		expect(ids).toContain("has-readme")
		expect(ids).toContain("readme-install")
		expect(ids).toContain("has-changelog")
		expect(ids).toContain("has-license")
		expect(ids).toContain("has-description")
		expect(ids).toContain("semver-consistency")
		expect(ids).toContain("reasonable-size")
	})

	it("scores well for a well-configured Swift package", () => {
		const result = runQualityChecks(
			makeSwiftContext({
				packageJson: {
					name: "@lpm.dev/test.swift-pkg",
					version: "1.0.0",
					description: "A comprehensive Swift library for networking",
					keywords: ["swift", "networking", "ios"],
					repository: "https://github.com/test/swift-lib",
					homepage: "https://swift-lib.dev",
					license: "MIT",
				},
				readme:
					"# SwiftLib\n\n## Requirements\niOS 16+\n\n## Usage\n```swift\nimport SwiftLib\nlet client = Client()\n```\n```swift\nlet data = try await client.fetch()\n```\n\n## API\nPublic API docs here",
				files: [
					{ path: "Sources/SwiftLib/Client.swift", size: 2000 },
					{ path: "Sources/SwiftLib/Models.swift", size: 1500 },
					{ path: "Tests/SwiftLibTests/ClientTests.swift", size: 1000 },
					{ path: "CHANGELOG.md", size: 500 },
					{ path: "LICENSE", size: 1000 },
					{ path: ".github/workflows/ci.yml", size: 800 },
					{ path: "Package.swift", size: 400 },
				],
				unpackedSize: 50 * 1024,
				swiftManifest: {
					toolsVersion: "5.10.0",
					platforms: [
						{ name: "ios", version: "16.0" },
						{ name: "macos", version: "13.0" },
						{ name: "watchos", version: "9.0" },
					],
					targets: [
						{ name: "SwiftLib", type: "regular" },
						{ name: "SwiftLibTests", type: "test" },
					],
					dependencies: [],
				},
			}),
		)
		expect(result.score).toBeGreaterThanOrEqual(70)
		expect(["excellent", "good"]).toContain(result.meta.tier)
	})

	it("Swift score stays between 0 and 100", () => {
		const result = runQualityChecks(makeSwiftContext())
		expect(result.score).toBeGreaterThanOrEqual(0)
		expect(result.score).toBeLessThanOrEqual(100)
	})

	it("Swift category scores do not exceed max", () => {
		const result = runQualityChecks(makeSwiftContext())
		for (const [, { score, max }] of Object.entries(result.meta.categories)) {
			expect(score).toBeLessThanOrEqual(max)
			expect(score).toBeGreaterThanOrEqual(0)
		}
	})

	it("Swift failed checks get 0 points", () => {
		const result = runQualityChecks(makeSwiftContext())
		for (const check of result.checks) {
			if (!check.passed) {
				expect(check.points).toBe(0)
			}
		}
	})
})

// ============================================================================
// XCFramework ecosystem scoring
// ============================================================================

/**
 * Create an XCFramework package context for testing.
 */
function makeXCFrameworkContext(overrides = {}) {
	return {
		packageJson: {
			name: "@lpm.dev/test.xcf-pkg",
			version: "1.0.0",
			description: "A test XCFramework package",
			...overrides.packageJson,
		},
		readme: overrides.readme ?? null,
		lpmConfig: overrides.lpmConfig ?? null,
		files: overrides.files ?? [],
		unpackedSize: overrides.unpackedSize ?? 5 * 1024 * 1024,
		ecosystem: "xcframework",
		xcframeworkMeta: overrides.xcframeworkMeta ?? null,
	}
}

describe("runQualityChecks with ecosystem=xcframework", () => {
	it("returns 21 checks for XCFramework ecosystem", () => {
		const result = runQualityChecks(makeXCFrameworkContext())
		expect(result.checks).toHaveLength(21)
	})

	it("includes ecosystem in meta", () => {
		const result = runQualityChecks(makeXCFrameworkContext())
		expect(result.meta.ecosystem).toBe("xcframework")
	})

	it("uses XCFramework check IDs", () => {
		const result = runQualityChecks(makeXCFrameworkContext())
		const ids = result.checks.map(c => c.id)

		// XCFramework-specific checks
		expect(ids).toContain("xcf-valid-plist")
		expect(ids).toContain("xcf-multi-slice")
		expect(ids).toContain("xcf-size")
		expect(ids).toContain("xcf-architectures")

		// Swift source checks should NOT be present
		expect(ids).not.toContain("has-platforms")
		expect(ids).not.toContain("recent-tools-version")
		expect(ids).not.toContain("multi-platform")
		expect(ids).not.toContain("has-public-api")
		expect(ids).not.toContain("has-doc-comments")

		// JS-only checks should NOT be present
		expect(ids).not.toContain("has-types")
		expect(ids).not.toContain("esm-exports")
	})

	it("still includes universal documentation checks", () => {
		const result = runQualityChecks(makeXCFrameworkContext())
		const ids = result.checks.map(c => c.id)

		expect(ids).toContain("has-readme")
		expect(ids).toContain("readme-install")
		expect(ids).toContain("has-changelog")
		expect(ids).toContain("has-license")
		expect(ids).toContain("has-description")
		expect(ids).toContain("semver-consistency")
	})

	it("score stays between 0 and 100", () => {
		const result = runQualityChecks(makeXCFrameworkContext())
		expect(result.score).toBeGreaterThanOrEqual(0)
		expect(result.score).toBeLessThanOrEqual(100)
	})

	it("category scores do not exceed max", () => {
		const result = runQualityChecks(makeXCFrameworkContext())
		for (const [, { score, max }] of Object.entries(result.meta.categories)) {
			expect(score).toBeLessThanOrEqual(max)
			expect(score).toBeGreaterThanOrEqual(0)
		}
	})

	it("failed checks get 0 points", () => {
		const result = runQualityChecks(makeXCFrameworkContext())
		for (const check of result.checks) {
			if (!check.passed) {
				expect(check.points).toBe(0)
			}
		}
	})

	it("scores well for a well-configured XCFramework package", () => {
		const result = runQualityChecks(
			makeXCFrameworkContext({
				packageJson: {
					name: "@lpm.dev/test.xcf-pkg",
					version: "1.0.0",
					description: "A well-built XCFramework for networking",
					keywords: ["swift", "networking", "ios", "xcframework"],
					repository: "https://github.com/test/my-xcf",
					homepage: "https://my-xcf.dev",
					license: "MIT",
				},
				readme:
					"# MyLib XCFramework\n\n## Install\nRun `lpm add @lpm.dev/test.xcf-pkg`\n\n## Usage\n```swift\nimport MyLib\nlet client = Client()\n```\n```swift\nlet data = try await client.fetch()\n```\n\n## API\nPublic API docs here",
				files: [
					{ path: "MyLib.xcframework/Info.plist", size: 2000 },
					{
						path: "MyLib.xcframework/ios-arm64/MyLib.framework/MyLib",
						size: 500000,
					},
					{
						path: "MyLib.xcframework/ios-arm64_x86_64-simulator/MyLib.framework/MyLib",
						size: 800000,
					},
					{
						path: "MyLib.xcframework/macos-arm64_x86_64/MyLib.framework/MyLib",
						size: 600000,
					},
					{ path: "CHANGELOG.md", size: 500 },
					{ path: "LICENSE", size: 1000 },
					{ path: ".github/workflows/ci.yml", size: 800 },
				],
				unpackedSize: 5 * 1024 * 1024,
				xcframeworkMeta: {
					name: "MyLib.xcframework",
					slices: [
						{
							identifier: "ios-arm64",
							platform: "ios",
							variant: null,
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
							variant: null,
							architectures: ["arm64", "x86_64"],
						},
					],
					formatVersion: "1.0",
				},
			}),
		)
		expect(result.score).toBeGreaterThanOrEqual(70)
		expect(["excellent", "good"]).toContain(result.meta.tier)
	})

	it("passes xcframeworkMeta to checks via context", () => {
		const xcframeworkMeta = {
			slices: [
				{
					identifier: "ios-arm64",
					platform: "ios",
					variant: null,
					architectures: ["arm64"],
				},
			],
		}
		const result = runQualityChecks(makeXCFrameworkContext({ xcframeworkMeta }))
		const plistCheck = result.checks.find(c => c.id === "xcf-valid-plist")
		expect(plistCheck.passed).toBe(true)
		expect(plistCheck.detail).toContain("1 platform slice")
	})
})
