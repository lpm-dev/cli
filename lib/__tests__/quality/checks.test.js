import { describe, expect, it } from "vitest"
import { checks, getSourcePackageInfo } from "../../quality/checks.js"

/**
 * Helper to run a specific check by ID.
 * @param {string} id - Check ID
 * @param {object} context - Context object
 */
function runCheck(id, context) {
	const check = checks.find(c => c.id === id)
	if (!check) throw new Error(`Check "${id}" not found`)
	return { ...check.run(context), max_points: check.max_points }
}

// ============================================================================
// Documentation checks
// ============================================================================

describe("has-readme", () => {
	it("passes with README > 100 chars", () => {
		const result = runCheck("has-readme", { readme: "A".repeat(101) })
		expect(result.passed).toBe(true)
	})

	it("fails with no README", () => {
		const result = runCheck("has-readme", { readme: null })
		expect(result.passed).toBe(false)
	})

	it("fails with short README (< 100 chars)", () => {
		const result = runCheck("has-readme", { readme: "Short" })
		expect(result.passed).toBe(false)
	})

	it("fails with empty README", () => {
		const result = runCheck("has-readme", { readme: "" })
		expect(result.passed).toBe(false)
	})
})

describe("readme-install", () => {
	it("passes when README has ## Install section", () => {
		const result = runCheck("readme-install", {
			readme: "# My Package\n\n## Install\nnpm install my-pkg",
		})
		expect(result.passed).toBe(true)
	})

	it("passes when README mentions lpm add", () => {
		const result = runCheck("readme-install", {
			readme: "Run lpm add @lpm.dev/owner.pkg to get started",
		})
		expect(result.passed).toBe(true)
	})

	it("passes when README mentions npm install", () => {
		const result = runCheck("readme-install", {
			readme: "npm install @lpm.dev/owner.pkg",
		})
		expect(result.passed).toBe(true)
	})

	it("fails when README has no install section", () => {
		const result = runCheck("readme-install", {
			readme: "# My Package\n\nThis is a great package.",
		})
		expect(result.passed).toBe(false)
	})

	it("fails with no README", () => {
		const result = runCheck("readme-install", { readme: null })
		expect(result.passed).toBe(false)
	})
})

describe("readme-usage", () => {
	it("passes with usage section", () => {
		const result = runCheck("readme-usage", {
			readme: "## Usage\n```js\nconst x = 1\n```\n```js\nconst y = 2\n```",
		})
		expect(result.passed).toBe(true)
	})

	it("passes with 2+ code blocks even without section header", () => {
		const result = runCheck("readme-usage", {
			readme: "```js\ncode1\n```\n\n```js\ncode2\n```",
		})
		expect(result.passed).toBe(true)
	})

	it("fails with no code blocks and no usage section", () => {
		const result = runCheck("readme-usage", {
			readme: "Just some text without code.",
		})
		expect(result.passed).toBe(false)
	})
})

describe("readme-api", () => {
	it("passes with ## API section", () => {
		const result = runCheck("readme-api", { readme: "## API\nSome docs" })
		expect(result.passed).toBe(true)
	})

	it("passes with ## Props section", () => {
		const result = runCheck("readme-api", { readme: "## Props\nSome props" })
		expect(result.passed).toBe(true)
	})

	it("fails without API section", () => {
		const result = runCheck("readme-api", { readme: "## Usage\nCode here" })
		expect(result.passed).toBe(false)
	})
})

describe("has-changelog", () => {
	it("passes when CHANGELOG file exists", () => {
		const result = runCheck("has-changelog", {
			files: [{ path: "package/CHANGELOG.md" }],
		})
		expect(result.passed).toBe(true)
	})

	it("passes with string file paths", () => {
		const result = runCheck("has-changelog", {
			files: ["CHANGELOG.md", "src/index.js"],
		})
		expect(result.passed).toBe(true)
	})

	it("fails when no CHANGELOG file", () => {
		const result = runCheck("has-changelog", {
			files: [{ path: "src/index.js" }],
		})
		expect(result.passed).toBe(false)
	})
})

describe("has-license", () => {
	it("passes with LICENSE file", () => {
		const result = runCheck("has-license", {
			files: [{ path: "LICENSE" }],
			packageJson: {},
		})
		expect(result.passed).toBe(true)
	})

	it("passes with license field only", () => {
		const result = runCheck("has-license", {
			files: [],
			packageJson: { license: "MIT" },
		})
		expect(result.passed).toBe(true)
	})

	it("fails with no license file or field", () => {
		const result = runCheck("has-license", {
			files: [],
			packageJson: {},
		})
		expect(result.passed).toBe(false)
	})
})

// ============================================================================
// Code Quality checks
// ============================================================================

describe("has-types", () => {
	it("passes with types field", () => {
		const result = runCheck("has-types", {
			packageJson: { types: "./dist/index.d.ts" },
			files: [],
		})
		expect(result.passed).toBe(true)
	})

	it("passes with typings field", () => {
		const result = runCheck("has-types", {
			packageJson: { typings: "./dist/index.d.ts" },
			files: [],
		})
		expect(result.passed).toBe(true)
	})

	it("passes with .d.ts file", () => {
		const result = runCheck("has-types", {
			packageJson: {},
			files: [{ path: "dist/index.d.ts" }],
		})
		expect(result.passed).toBe(true)
	})

	it("fails without types", () => {
		const result = runCheck("has-types", {
			packageJson: {},
			files: [{ path: "src/index.js" }],
		})
		expect(result.passed).toBe(false)
	})
})

describe("esm-exports", () => {
	it("passes with type: module", () => {
		const result = runCheck("esm-exports", {
			packageJson: { type: "module" },
		})
		expect(result.passed).toBe(true)
	})

	it("passes with exports field", () => {
		const result = runCheck("esm-exports", {
			packageJson: { exports: { ".": "./dist/index.js" } },
		})
		expect(result.passed).toBe(true)
	})

	it("passes with module field", () => {
		const result = runCheck("esm-exports", {
			packageJson: { module: "./dist/index.mjs" },
		})
		expect(result.passed).toBe(true)
	})

	it("fails without ESM support", () => {
		const result = runCheck("esm-exports", { packageJson: {} })
		expect(result.passed).toBe(false)
	})
})

describe("tree-shakable", () => {
	it("passes with sideEffects: false", () => {
		const result = runCheck("tree-shakable", {
			packageJson: { sideEffects: false },
		})
		expect(result.passed).toBe(true)
	})

	it("passes with ESM + exports", () => {
		const result = runCheck("tree-shakable", {
			packageJson: { type: "module", exports: { ".": "./index.js" } },
		})
		expect(result.passed).toBe(true)
	})

	it("fails without sideEffects or ESM exports", () => {
		const result = runCheck("tree-shakable", { packageJson: {} })
		expect(result.passed).toBe(false)
	})
})

describe("small-deps", () => {
	it("returns 3 points for 0 dependencies", () => {
		const result = runCheck("small-deps", { packageJson: {} })
		expect(result.passed).toBe(true)
		expect(result.points).toBe(3)
	})

	it("returns 2 points for 3 dependencies", () => {
		const result = runCheck("small-deps", {
			packageJson: { dependencies: { a: "1", b: "1", c: "1" } },
		})
		expect(result.points).toBe(2)
	})

	it("returns 1 point for 7 dependencies", () => {
		const deps = Object.fromEntries(
			Array.from({ length: 7 }, (_, i) => [`dep${i}`, "1"]),
		)
		const result = runCheck("small-deps", {
			packageJson: { dependencies: deps },
		})
		expect(result.points).toBe(1)
	})

	it("returns 0 points for 8+ dependencies", () => {
		const deps = Object.fromEntries(
			Array.from({ length: 8 }, (_, i) => [`dep${i}`, "1"]),
		)
		const result = runCheck("small-deps", {
			packageJson: { dependencies: deps },
		})
		expect(result.points).toBe(0)
		expect(result.passed).toBe(false)
	})
})

describe("has-engines", () => {
	it("passes with engines.node", () => {
		const result = runCheck("has-engines", {
			packageJson: { engines: { node: ">=18" } },
		})
		expect(result.passed).toBe(true)
	})

	it("fails without engines", () => {
		const result = runCheck("has-engines", { packageJson: {} })
		expect(result.passed).toBe(false)
	})
})

describe("has-exports-map", () => {
	it("passes with exports field", () => {
		const result = runCheck("has-exports-map", {
			packageJson: { exports: { ".": "./index.js" } },
		})
		expect(result.passed).toBe(true)
	})

	it("fails without exports", () => {
		const result = runCheck("has-exports-map", { packageJson: {} })
		expect(result.passed).toBe(false)
	})
})

describe("source-maps", () => {
	it("passes with .js.map files", () => {
		const result = runCheck("source-maps", {
			files: [{ path: "dist/index.js.map" }],
		})
		expect(result.passed).toBe(true)
	})

	it("fails without source maps", () => {
		const result = runCheck("source-maps", {
			files: [{ path: "dist/index.js" }],
		})
		expect(result.passed).toBe(false)
	})
})

// ============================================================================
// Testing checks
// ============================================================================

describe("has-test-files", () => {
	it("passes with .test.js files in projectFiles", () => {
		const result = runCheck("has-test-files", {
			projectFiles: [{ path: "src/utils.test.js" }],
			files: [],
		})
		expect(result.passed).toBe(true)
	})

	it("passes with .spec.js files in projectFiles", () => {
		const result = runCheck("has-test-files", {
			projectFiles: [{ path: "src/utils.spec.js" }],
			files: [],
		})
		expect(result.passed).toBe(true)
	})

	it("passes with __tests__ directory in projectFiles", () => {
		const result = runCheck("has-test-files", {
			projectFiles: [{ path: "__tests__/utils.js" }],
			files: [],
		})
		expect(result.passed).toBe(true)
	})

	it("fails without test files in projectFiles", () => {
		const result = runCheck("has-test-files", {
			projectFiles: [{ path: "src/index.js" }],
			files: [],
		})
		expect(result.passed).toBe(false)
	})

	it("falls back to tarball files when projectFiles is not provided", () => {
		const result = runCheck("has-test-files", {
			files: [{ path: "src/utils.test.js" }],
		})
		expect(result.passed).toBe(true)
	})

	it("prefers projectFiles over files (tarball)", () => {
		const result = runCheck("has-test-files", {
			projectFiles: [{ path: "src/index.js" }], // no test files
			files: [{ path: "src/utils.test.js" }], // has test files in tarball
		})
		// Should use projectFiles, which has no test files
		expect(result.passed).toBe(false)
	})
})

describe("has-test-script", () => {
	it("passes with a real test script", () => {
		const result = runCheck("has-test-script", {
			packageJson: { scripts: { test: "vitest run" } },
		})
		expect(result.passed).toBe(true)
	})

	it("fails with default echo test script", () => {
		const result = runCheck("has-test-script", {
			packageJson: {
				scripts: { test: 'echo "Error: no test" && exit 1' },
			},
		})
		expect(result.passed).toBe(false)
	})

	it("fails with no scripts", () => {
		const result = runCheck("has-test-script", { packageJson: {} })
		expect(result.passed).toBe(false)
	})
})

// ============================================================================
// Package Health checks
// ============================================================================

describe("has-description", () => {
	it("passes with meaningful description", () => {
		const result = runCheck("has-description", {
			packageJson: { description: "A useful library for doing things" },
		})
		expect(result.passed).toBe(true)
	})

	it("fails with short description", () => {
		const result = runCheck("has-description", {
			packageJson: { description: "Short" },
		})
		expect(result.passed).toBe(false)
	})

	it("fails with no description", () => {
		const result = runCheck("has-description", { packageJson: {} })
		expect(result.passed).toBe(false)
	})
})

describe("has-keywords", () => {
	it("passes with keywords", () => {
		const result = runCheck("has-keywords", {
			packageJson: { keywords: ["utility", "helper"] },
		})
		expect(result.passed).toBe(true)
	})

	it("fails with empty keywords", () => {
		const result = runCheck("has-keywords", {
			packageJson: { keywords: [] },
		})
		expect(result.passed).toBe(false)
	})

	it("fails without keywords", () => {
		const result = runCheck("has-keywords", { packageJson: {} })
		expect(result.passed).toBe(false)
	})
})

describe("has-repository", () => {
	it("passes with string repository", () => {
		const result = runCheck("has-repository", {
			packageJson: { repository: "https://github.com/user/repo" },
		})
		expect(result.passed).toBe(true)
	})

	it("passes with object repository", () => {
		const result = runCheck("has-repository", {
			packageJson: {
				repository: { type: "git", url: "https://github.com/user/repo" },
			},
		})
		expect(result.passed).toBe(true)
	})

	it("fails without repository", () => {
		const result = runCheck("has-repository", { packageJson: {} })
		expect(result.passed).toBe(false)
	})
})

describe("reasonable-size", () => {
	it("returns 3 points for < 100KB", () => {
		const result = runCheck("reasonable-size", {
			unpackedSize: 50 * 1024,
		})
		expect(result.points).toBe(3)
		expect(result.passed).toBe(true)
	})

	it("returns 2 points for 200KB", () => {
		const result = runCheck("reasonable-size", {
			unpackedSize: 200 * 1024,
		})
		expect(result.points).toBe(2)
	})

	it("returns 1 point for 800KB", () => {
		const result = runCheck("reasonable-size", {
			unpackedSize: 800 * 1024,
		})
		expect(result.points).toBe(1)
	})

	it("returns 0 points for > 1MB", () => {
		const result = runCheck("reasonable-size", {
			unpackedSize: 2 * 1024 * 1024,
		})
		expect(result.points).toBe(0)
		expect(result.passed).toBe(false)
	})

	it("returns 3 points when size is unknown", () => {
		const result = runCheck("reasonable-size", { unpackedSize: undefined })
		expect(result.points).toBe(3)
	})
})

describe("semver-consistency", () => {
	it("passes with valid semver", () => {
		const result = runCheck("semver-consistency", {
			packageJson: { version: "1.2.3" },
		})
		expect(result.passed).toBe(true)
	})

	it("passes with pre-release semver", () => {
		const result = runCheck("semver-consistency", {
			packageJson: { version: "1.0.0-beta.1" },
		})
		expect(result.passed).toBe(true)
	})

	it("fails with invalid version", () => {
		const result = runCheck("semver-consistency", {
			packageJson: { version: "not-semver" },
		})
		expect(result.passed).toBe(false)
	})

	it("fails with no version", () => {
		const result = runCheck("semver-consistency", { packageJson: {} })
		expect(result.passed).toBe(false)
	})
})

// ============================================================================
// intellisense-coverage (mixed CLI + server behavior)
// ============================================================================

describe("intellisense-coverage", () => {
	it("passes immediately when .d.ts files exist (no server check needed)", () => {
		const result = runCheck("intellisense-coverage", {
			packageJson: {},
			files: [{ path: "dist/index.d.ts" }],
		})
		expect(result.passed).toBe(true)
		expect(result.server_only).toBeUndefined()
	})

	it("passes immediately when types field in package.json", () => {
		const result = runCheck("intellisense-coverage", {
			packageJson: { types: "./dist/index.d.ts" },
			files: [],
		})
		expect(result.passed).toBe(true)
		expect(result.server_only).toBeUndefined()
	})

	it("passes immediately when typings field in package.json", () => {
		const result = runCheck("intellisense-coverage", {
			packageJson: { typings: "./dist/types.d.ts" },
			files: [],
		})
		expect(result.passed).toBe(true)
		expect(result.server_only).toBeUndefined()
	})

	it("defers to server when no .d.ts or types field (server_only: true)", () => {
		const result = runCheck("intellisense-coverage", {
			packageJson: {},
			files: [{ path: "src/index.js" }],
		})
		expect(result.passed).toBe(false)
		expect(result.server_only).toBe(true)
	})

	it("defers to server for pure-JS package with no types at all", () => {
		const result = runCheck("intellisense-coverage", {
			packageJson: { name: "my-pkg", version: "1.0.0" },
			files: [],
		})
		expect(result.server_only).toBe(true)
	})
})

// ============================================================================
// Server-only checks
// ============================================================================

describe("server-only checks", () => {
	const server_onlyIds = [
		"no-eval",
		"no-vulnerabilities",
		"maintenance-health",
		"author-verified",
	]

	for (const id of server_onlyIds) {
		it(`${id} returns server_only: true`, () => {
			const result = runCheck(id, {
				packageJson: {},
				files: [],
				readme: null,
			})
			expect(result.server_only).toBe(true)
			expect(result.passed).toBe(true)
		})
	}
})

// ============================================================================
// getSourcePackageInfo
// ============================================================================

describe("getSourcePackageInfo", () => {
	it("returns null for no config", () => {
		expect(getSourcePackageInfo(null)).toBeNull()
	})

	it("returns info for config with schema", () => {
		const result = getSourcePackageInfo({
			configSchema: {
				component: { type: "select" },
				theme: { type: "boolean" },
			},
			defaultConfig: { component: "dialog" },
			files: [
				{ src: "a.js", include: "when", condition: { component: "dialog" } },
			],
		})
		expect(result.hasConfig).toBe(true)
		expect(result.hasDefaults).toBe(true)
		expect(result.optionCount).toBe(2)
		expect(result.usesConditionalIncludes).toBe(true)
	})

	it("returns correct info for config without conditionals", () => {
		const result = getSourcePackageInfo({
			files: [{ src: "a.js", include: "always" }],
		})
		expect(result.hasConfig).toBe(true)
		expect(result.optionCount).toBe(0)
		expect(result.usesConditionalIncludes).toBe(false)
	})
})

// ============================================================================
// All checks accounted for
// ============================================================================

describe("check registry", () => {
	it("has 29 checks total", () => {
		expect(checks).toHaveLength(29)
	})

	it("does NOT include has-ci-config (removed — author concern, not user benefit)", () => {
		const ciCheck = checks.find(c => c.id === "has-ci-config")
		expect(ciCheck).toBeUndefined()
	})

	it("all checks have required fields", () => {
		for (const check of checks) {
			expect(check.id).toBeDefined()
			expect(check.category).toBeDefined()
			expect(check.label).toBeDefined()
			expect(check.max_points).toBeGreaterThan(0)
			expect(typeof check.run).toBe("function")
		}
	})

	it("category points sum to 100", () => {
		const catSums = {}
		for (const check of checks) {
			catSums[check.category] =
				(catSums[check.category] || 0) + check.max_points
		}
		const total = Object.values(catSums).reduce((a, b) => a + b, 0)
		expect(total).toBe(100)
	})
})
