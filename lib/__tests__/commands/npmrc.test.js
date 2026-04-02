import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockGetToken, mockGetRegistryUrl, mockRequest, mockSpinner } =
	vi.hoisted(() => ({
		mockGetToken: vi.fn(),
		mockGetRegistryUrl: vi.fn().mockReturnValue("https://lpm.dev"),
		mockRequest: vi.fn(),
		mockSpinner: {
			start: vi.fn().mockReturnThis(),
			succeed: vi.fn().mockReturnThis(),
			fail: vi.fn().mockReturnThis(),
		},
	}))

vi.mock("../../config.js", () => ({
	getToken: mockGetToken,
	getRegistryUrl: mockGetRegistryUrl,
}))
vi.mock("../../api.js", () => ({ request: mockRequest }))
vi.mock("../../ui.js", () => ({
	log: {
		success: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
	printHeader: vi.fn(),
	createSpinner: vi.fn().mockReturnValue(mockSpinner),
}))

import { npmrc } from "../../commands/npmrc.js"
import { log } from "../../ui.js"

let tmpDir

/** Helper: mock a successful token creation API response */
function mockTokenResponse(token = "lpm_read_abc123", expiresAt = null) {
	const expires =
		expiresAt || new Date(Date.now() + 30 * 86400000).toISOString()
	mockRequest.mockResolvedValueOnce({
		ok: true,
		json: () => Promise.resolve({ token, scope: "read", expiresAt: expires }),
	})
}

describe("lpm npmrc command", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		mockGetToken.mockReset()
		mockRequest.mockReset()
		mockSpinner.start.mockReturnThis()
		mockSpinner.succeed.mockReturnThis()
		mockSpinner.fail.mockReturnThis()
	})

	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	it("exits with error if not logged in", async () => {
		mockGetToken.mockResolvedValueOnce(null)
		const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit")
		})

		await expect(npmrc({})).rejects.toThrow("process.exit")
		expect(mockExit).toHaveBeenCalledWith(1)
		expect(log.error).toHaveBeenCalledWith(expect.stringContaining("lpm login"))
	})

	it("creates .npmrc with read-only token in scoped mode by default", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-npmrc-"))
		writeFileSync(join(tmpDir, "package.json"), '{"name":"test-project"}')
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetToken.mockResolvedValueOnce("lpm_existing_token")
		mockTokenResponse("lpm_readonly_xyz")

		await npmrc({})

		const content = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(content).toContain("@lpm.dev:registry=https://lpm.dev/api/registry")
		expect(content).not.toContain(/^registry=/)
		expect(content).toContain("_authToken=lpm_readonly_xyz")
		expect(content).toContain("do not commit")
		// biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal npm token placeholder
		expect(content).not.toContain("${LPM_TOKEN}")
	})

	it("creates .npmrc with scoped config when --scoped is used", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-npmrc-"))
		writeFileSync(join(tmpDir, "package.json"), '{"name":"test-project"}')
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetToken.mockResolvedValueOnce("lpm_existing_token")
		mockTokenResponse("lpm_readonly_xyz")

		await npmrc({ scoped: true })

		const content = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(content).toContain("@lpm.dev:registry=https://lpm.dev/api/registry")
		expect(content).toContain("_authToken=lpm_readonly_xyz")
	})

	it("creates .gitignore with .npmrc entry if none exists", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-npmrc-"))
		writeFileSync(join(tmpDir, "package.json"), '{"name":"test-project"}')
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetToken.mockResolvedValueOnce("lpm_token")
		mockTokenResponse()

		await npmrc({})

		const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf8")
		expect(gitignore).toContain(".npmrc")
		expect(log.info).toHaveBeenCalledWith(expect.stringContaining(".gitignore"))
	})

	it("appends .npmrc to existing .gitignore", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-npmrc-"))
		writeFileSync(join(tmpDir, "package.json"), '{"name":"test-project"}')
		writeFileSync(join(tmpDir, ".gitignore"), "node_modules\n.env\n")
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetToken.mockResolvedValueOnce("lpm_token")
		mockTokenResponse()

		await npmrc({})

		const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf8")
		expect(gitignore).toContain("node_modules")
		expect(gitignore).toContain(".npmrc")
	})

	it("does not duplicate .npmrc in .gitignore", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-npmrc-"))
		writeFileSync(join(tmpDir, "package.json"), '{"name":"test-project"}')
		writeFileSync(join(tmpDir, ".gitignore"), "node_modules\n.npmrc\n")
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetToken.mockResolvedValueOnce("lpm_token")
		mockTokenResponse()

		await npmrc({})

		const gitignore = readFileSync(join(tmpDir, ".gitignore"), "utf8")
		const matches = gitignore.match(/\.npmrc/g)
		expect(matches).toHaveLength(1)
	})

	it("replaces existing LPM config in .npmrc", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-npmrc-"))
		writeFileSync(join(tmpDir, "package.json"), '{"name":"test-project"}')
		writeFileSync(
			join(tmpDir, ".npmrc"),
			"other-config=true\n# LPM Registry\n@lpm.dev:registry=https://old.url\n//old.url/:_authToken=lpm_old\n",
		)
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetToken.mockResolvedValueOnce("lpm_token")
		mockTokenResponse("lpm_new_token")

		await npmrc({})

		const content = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(content).toContain("other-config=true")
		expect(content).toContain("lpm_new_token")
		expect(content).not.toContain("lpm_old")
		expect(content).not.toContain("https://old.url")
	})

	it("preserves non-LPM config in existing .npmrc", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-npmrc-"))
		writeFileSync(join(tmpDir, "package.json"), '{"name":"test-project"}')
		writeFileSync(
			join(tmpDir, ".npmrc"),
			"//npm.pkg.github.com/:_authToken=ghp_xxx\n@myorg:registry=https://npm.pkg.github.com\n",
		)
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetToken.mockResolvedValueOnce("lpm_token")
		mockTokenResponse()

		await npmrc({})

		const content = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(content).toContain("ghp_xxx")
		expect(content).toContain("@myorg:registry=https://npm.pkg.github.com")
		expect(content).toContain("registry=https://lpm.dev/api/registry")
	})

	it("uses scoped mode even when custom default registry exists", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-npmrc-"))
		writeFileSync(join(tmpDir, "package.json"), '{"name":"test-project"}')
		writeFileSync(
			join(tmpDir, ".npmrc"),
			"registry=https://artifactory.company.com/npm\n",
		)
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetToken.mockResolvedValueOnce("lpm_token")
		mockTokenResponse()

		await npmrc({})

		const content = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(content).toContain("registry=https://artifactory.company.com/npm")
		expect(content).toContain("@lpm.dev:registry=https://lpm.dev/api/registry")
		// No warning needed — scoped is the default, no conflict with custom registry
	})

	it("sends correct token name with project name", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-npmrc-"))
		writeFileSync(join(tmpDir, "package.json"), '{"name":"my-cool-app"}')
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetToken.mockResolvedValueOnce("lpm_token")
		mockTokenResponse()

		await npmrc({})

		expect(mockRequest).toHaveBeenCalledWith(
			"/-/token/create",
			expect.objectContaining({
				method: "POST",
				body: expect.stringContaining("my-cool-app"),
			}),
		)
	})

	it("passes custom expiry days", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-npmrc-"))
		writeFileSync(join(tmpDir, "package.json"), '{"name":"test"}')
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetToken.mockResolvedValueOnce("lpm_token")
		mockTokenResponse()

		await npmrc({ days: "7" })

		expect(mockRequest).toHaveBeenCalledWith(
			"/-/token/create",
			expect.objectContaining({
				body: expect.stringContaining('"expiryDays":7'),
			}),
		)
	})

	it("exits on API error", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-npmrc-"))
		writeFileSync(join(tmpDir, "package.json"), '{"name":"test"}')
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetToken.mockResolvedValueOnce("lpm_token")
		mockRequest.mockResolvedValueOnce({
			ok: false,
			status: 500,
			text: () => Promise.resolve("Internal error"),
		})
		const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit")
		})

		await expect(npmrc({})).rejects.toThrow("process.exit")
		expect(mockExit).toHaveBeenCalledWith(1)
		expect(mockSpinner.fail).toHaveBeenCalled()
	})

	it("shows expiry date in output", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-npmrc-"))
		writeFileSync(join(tmpDir, "package.json"), '{"name":"test"}')
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetToken.mockResolvedValueOnce("lpm_token")
		mockTokenResponse("lpm_tok", "2026-04-18T00:00:00.000Z")

		await npmrc({})

		expect(log.info).toHaveBeenCalledWith(expect.stringContaining("April"))
	})

	it("works without package.json (warns but continues)", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-npmrc-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetToken.mockResolvedValueOnce("lpm_token")
		mockTokenResponse()

		await npmrc({})

		expect(log.warn).toHaveBeenCalledWith(
			expect.stringContaining("No package.json"),
		)
		expect(existsSync(join(tmpDir, ".npmrc"))).toBe(true)
	})
})
