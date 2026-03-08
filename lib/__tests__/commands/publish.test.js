import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const {
	mockExecAsync,
	mockExec,
	mockRequest,
	mockVerifyTokenScope,
	mockGetRegistryUrl,
	mockRunQualityChecks,
	mockDisplayQualityReport,
} = vi.hoisted(() => {
	const mockExecAsync = vi.fn()
	const mockExec = vi.fn()
	mockExec[Symbol.for("nodejs.util.promisify.custom")] = mockExecAsync
	return {
		mockExecAsync,
		mockExec,
		mockRequest: vi.fn(),
		mockVerifyTokenScope: vi.fn(),
		mockGetRegistryUrl: vi.fn().mockReturnValue("https://lpm.dev"),
		mockRunQualityChecks: vi.fn().mockReturnValue({
			score: 72,
			checks: [],
			meta: { tier: "good", score: 72, maxScore: 100, categories: {} },
		}),
		mockDisplayQualityReport: vi.fn(),
	}
})

vi.mock("node:child_process", () => ({ exec: mockExec }))
vi.mock("../../api.js", () => ({
	request: mockRequest,
	verifyTokenScope: mockVerifyTokenScope,
}))
vi.mock("../../config.js", () => ({ getRegistryUrl: mockGetRegistryUrl }))
vi.mock("../../quality/score.js", () => ({
	runQualityChecks: mockRunQualityChecks,
}))
vi.mock("../../quality/display.js", () => ({
	displayQualityReport: mockDisplayQualityReport,
}))
vi.mock("../../ui.js", () => ({
	createSpinner: () => ({
		start: vi.fn().mockReturnThis(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		text: "",
	}),
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), success: vi.fn() },
	printHeader: vi.fn(),
}))
vi.mock("@clack/prompts", () => ({
	confirm: vi.fn().mockResolvedValue(true),
	isCancel: vi.fn().mockReturnValue(false),
	cancel: vi.fn(),
}))

import { publish } from "../../commands/publish.js"

let tmpDir

// Helper to create a temp project with package.json + optional files
function setupProject(pkg, extras = {}) {
	tmpDir = mkdtempSync(join(tmpdir(), "lpm-publish-"))
	writeFileSync(join(tmpDir, "package.json"), JSON.stringify(pkg))
	for (const [filename, content] of Object.entries(extras)) {
		writeFileSync(join(tmpDir, filename), content)
	}
	vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
	return tmpDir
}

// Helper to set up npm pack mock
function mockNpmPack(filename = "pkg-1.0.0.tgz") {
	const tarballPath = join(tmpDir, filename)
	writeFileSync(tarballPath, "fake-tarball-content")
	mockExecAsync.mockResolvedValue({
		stdout: JSON.stringify([
			{
				filename,
				files: [{ path: "index.js" }],
				unpackedSize: 1000,
			},
		]),
	})
}

// Helper to mock a full publish flow (auth + upload)
function mockFullPublishFlow(owner = "test") {
	mockVerifyTokenScope.mockResolvedValue({ valid: true })
	mockRequest.mockResolvedValueOnce({
		ok: true,
		json: () =>
			Promise.resolve({
				profile_username: owner,
				organizations: [],
			}),
	})
	mockRequest.mockResolvedValueOnce({ ok: true, text: () => "" })
}

describe("publish command", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit")
		})
		mockRequest.mockReset()
		mockVerifyTokenScope.mockReset()
		mockExecAsync.mockReset()
		mockRunQualityChecks.mockReturnValue({
			score: 72,
			checks: [],
			meta: { tier: "good", score: 72, maxScore: 100, categories: {} },
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	// ── Package Name Parsing ──────────────────────────────────────────

	describe("package name parsing", () => {
		it("exits when no package.json found", async () => {
			tmpDir = mkdtempSync(join(tmpdir(), "lpm-publish-"))
			vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
			await expect(publish({ check: true })).rejects.toThrow("process.exit")
		})

		it("exits with invalid package name (no scope)", async () => {
			setupProject({ name: "invalid-name", version: "1.0.0" })
			await expect(publish({ check: true })).rejects.toThrow("process.exit")
		})

		it("exits with @lpm.dev/ name missing dot separator", async () => {
			setupProject({ name: "@lpm.dev/no-dot-separator", version: "1.0.0" })
			await expect(publish({ check: true })).rejects.toThrow("process.exit")
		})

		it("exits with malformed JSON in package.json", async () => {
			tmpDir = mkdtempSync(join(tmpdir(), "lpm-publish-"))
			writeFileSync(join(tmpDir, "package.json"), "{ not valid json }")
			vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
			await expect(publish({ check: true })).rejects.toThrow("process.exit")
		})

		it("accepts @lpm.dev/owner.package format", async () => {
			setupProject({ name: "@lpm.dev/test.my-package", version: "1.0.0" })
			mockNpmPack()
			await expect(publish({ check: true })).rejects.toThrow("process.exit")
			expect(mockRunQualityChecks).toHaveBeenCalled()
		})

		it("accepts legacy @scope/name format", async () => {
			setupProject({ name: "@test/my-package", version: "1.0.0" })
			mockNpmPack("test-my-package-1.0.0.tgz")
			await expect(publish({ check: true })).rejects.toThrow("process.exit")
			expect(mockDisplayQualityReport).toHaveBeenCalled()
		})
	})

	// ── Quality Checks ────────────────────────────────────────────────

	describe("quality checks", () => {
		it("runs quality checks in --check mode", async () => {
			setupProject({ name: "@lpm.dev/test.my-package", version: "1.0.0" })
			mockNpmPack()
			await expect(publish({ check: true })).rejects.toThrow("process.exit")
			expect(mockRunQualityChecks).toHaveBeenCalled()
			expect(mockDisplayQualityReport).toHaveBeenCalled()
		})

		it("blocks publish when quality score below --min-score", async () => {
			setupProject({ name: "@lpm.dev/test.my-package", version: "1.0.0" })
			mockNpmPack()
			mockRunQualityChecks.mockReturnValueOnce({
				score: 40,
				checks: [],
				meta: { tier: "fair", score: 40, maxScore: 100, categories: {} },
			})
			await expect(publish({ check: true, minScore: "80" })).rejects.toThrow(
				"process.exit",
			)
		})

		it("allows publish when quality score meets --min-score", async () => {
			setupProject({ name: "@lpm.dev/test.my-package", version: "1.0.0" })
			mockNpmPack()
			mockRunQualityChecks.mockReturnValueOnce({
				score: 85,
				checks: [],
				meta: { tier: "good", score: 85, maxScore: 100, categories: {} },
			})
			// In --check mode with score >= minScore, it exits with 0
			await expect(publish({ check: true, minScore: "80" })).rejects.toThrow(
				"process.exit",
			)
			// Should display the report regardless
			expect(mockDisplayQualityReport).toHaveBeenCalled()
		})
	})

	// ── README Reading ────────────────────────────────────────────────

	describe("README handling", () => {
		it("includes README.md in quality checks when present", async () => {
			setupProject(
				{ name: "@lpm.dev/test.my-package", version: "1.0.0" },
				{ "README.md": "# My Package\n\nA test package." },
			)
			mockNpmPack()
			await expect(publish({ check: true })).rejects.toThrow("process.exit")

			// Quality checks should receive the readme
			expect(mockRunQualityChecks).toHaveBeenCalledWith(
				expect.objectContaining({
					readme: "# My Package\n\nA test package.",
				}),
			)
		})

		it("finds readme.md (lowercase)", async () => {
			setupProject(
				{ name: "@lpm.dev/test.my-package", version: "1.0.0" },
				{ "readme.md": "# Lowercase readme" },
			)
			mockNpmPack()
			await expect(publish({ check: true })).rejects.toThrow("process.exit")

			expect(mockRunQualityChecks).toHaveBeenCalledWith(
				expect.objectContaining({
					readme: "# Lowercase readme",
				}),
			)
		})

		it("passes null readme when no README file exists", async () => {
			setupProject({ name: "@lpm.dev/test.my-package", version: "1.0.0" })
			mockNpmPack()
			await expect(publish({ check: true })).rejects.toThrow("process.exit")

			expect(mockRunQualityChecks).toHaveBeenCalledWith(
				expect.objectContaining({
					readme: null,
				}),
			)
		})
	})

	// ── lpm.config.json ───────────────────────────────────────────────

	describe("lpm.config.json handling", () => {
		it("includes lpm.config.json when present", async () => {
			const config = {
				source: { components: "src/components" },
				aliases: { "@/components": "src/components" },
			}
			setupProject(
				{ name: "@lpm.dev/test.my-package", version: "1.0.0" },
				{ "lpm.config.json": JSON.stringify(config) },
			)
			mockNpmPack()
			await expect(publish({ check: true })).rejects.toThrow("process.exit")

			expect(mockRunQualityChecks).toHaveBeenCalledWith(
				expect.objectContaining({
					lpmConfig: config,
				}),
			)
		})

		it("passes null lpmConfig when no config file exists", async () => {
			setupProject({ name: "@lpm.dev/test.my-package", version: "1.0.0" })
			mockNpmPack()
			await expect(publish({ check: true })).rejects.toThrow("process.exit")

			expect(mockRunQualityChecks).toHaveBeenCalledWith(
				expect.objectContaining({
					lpmConfig: null,
				}),
			)
		})

		it("passes null lpmConfig when config has invalid JSON", async () => {
			setupProject(
				{ name: "@lpm.dev/test.my-package", version: "1.0.0" },
				{ "lpm.config.json": "{ broken json" },
			)
			mockNpmPack()
			await expect(publish({ check: true })).rejects.toThrow("process.exit")

			expect(mockRunQualityChecks).toHaveBeenCalledWith(
				expect.objectContaining({
					lpmConfig: null,
				}),
			)
		})
	})

	// ── Full Publish Flow ─────────────────────────────────────────────

	describe("full publish flow", () => {
		it("verifies token scope before publishing", async () => {
			setupProject({ name: "@lpm.dev/test.my-package", version: "1.0.0" })
			mockNpmPack()
			mockVerifyTokenScope.mockResolvedValue({
				valid: false,
				error: "Token does not have publish scope",
			})

			await expect(publish()).rejects.toThrow("process.exit")
			expect(mockVerifyTokenScope).toHaveBeenCalledWith("publish")
		})

		it("checks owner permissions via whoami", async () => {
			setupProject({ name: "@lpm.dev/test.my-package", version: "1.0.0" })
			mockNpmPack()
			mockVerifyTokenScope.mockResolvedValue({ valid: true })

			// whoami returns a user who doesn't own "test"
			mockRequest.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						profile_username: "other-user",
						organizations: [],
					}),
			})

			await expect(publish()).rejects.toThrow("process.exit")
		})

		it("allows publish when owner matches personal username", async () => {
			setupProject({ name: "@lpm.dev/test.my-package", version: "1.0.0" })
			mockNpmPack()
			mockFullPublishFlow("test")

			await publish()

			// Should have made PUT request to registry (URL is percent-encoded)
			const putCall = mockRequest.mock.calls.find(
				(c) => c[1]?.method === "PUT",
			)
			expect(putCall).toBeDefined()
			expect(putCall[0]).toContain("lpm.dev")
		})

		it("allows publish when owner matches an organization slug", async () => {
			setupProject({ name: "@lpm.dev/myorg.my-package", version: "1.0.0" })
			mockNpmPack()
			mockVerifyTokenScope.mockResolvedValue({ valid: true })
			mockRequest.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						profile_username: "me",
						organizations: [{ slug: "myorg" }],
					}),
			})
			mockRequest.mockResolvedValueOnce({ ok: true, text: () => "" })

			await publish()

			const putCall = mockRequest.mock.calls.find(
				(c) => c[1]?.method === "PUT",
			)
			expect(putCall).toBeDefined()
			expect(putCall[0]).toContain("myorg.my-package")
		})

		it("sends correct payload structure to registry", async () => {
			setupProject(
				{
					name: "@lpm.dev/test.my-package",
					version: "2.0.0",
					description: "A test",
				},
				{ "README.md": "# Hello" },
			)
			mockNpmPack()
			mockFullPublishFlow("test")

			await publish()

			const putCall = mockRequest.mock.calls.find(
				(c) => c[1]?.method === "PUT",
			)
			expect(putCall).toBeDefined()

			const payload = JSON.parse(putCall[1].body)
			expect(payload._id).toBe("@lpm.dev/test.my-package")
			expect(payload.name).toBe("@lpm.dev/test.my-package")
			expect(payload.description).toBe("A test")
			expect(payload["dist-tags"].latest).toBe("2.0.0")
			expect(payload.versions["2.0.0"]).toBeDefined()
			expect(payload.versions["2.0.0"].readme).toBe("# Hello")
			expect(payload.versions["2.0.0"].dist.integrity).toBeDefined()
			expect(payload.versions["2.0.0"].dist.shasum).toBeDefined()
			expect(payload._attachments).toBeDefined()
		})

		it("fails gracefully when upload returns error", async () => {
			setupProject({ name: "@lpm.dev/test.my-package", version: "1.0.0" })
			mockNpmPack()
			mockVerifyTokenScope.mockResolvedValue({ valid: true })
			mockRequest.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						profile_username: "test",
						organizations: [],
					}),
			})
			mockRequest.mockResolvedValueOnce({
				ok: false,
				status: 409,
				text: () => Promise.resolve("Version already exists"),
			})

			await expect(publish()).rejects.toThrow("process.exit")
		})
	})

	// ── Tarball Cleanup ───────────────────────────────────────────────

	describe("tarball cleanup", () => {
		it("removes tarball after successful publish", async () => {
			setupProject({ name: "@lpm.dev/test.my-package", version: "1.0.0" })
			const tarball = join(tmpDir, "pkg-1.0.0.tgz")
			writeFileSync(tarball, "content")
			mockExecAsync.mockResolvedValue({
				stdout: JSON.stringify([
					{ filename: "pkg-1.0.0.tgz", files: [], unpackedSize: 100 },
				]),
			})
			mockFullPublishFlow("test")

			await publish()

			// Tarball should be cleaned up
			const { existsSync } = await import("node:fs")
			expect(existsSync(tarball)).toBe(false)
		})
	})
})
