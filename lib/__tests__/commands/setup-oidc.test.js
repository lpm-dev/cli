import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockGetRegistryUrl, mockExchangeOidcInstallToken, mockPrompts } =
	vi.hoisted(() => ({
		mockGetRegistryUrl: vi.fn().mockReturnValue("https://lpm.dev"),
		mockExchangeOidcInstallToken: vi.fn(),
		mockPrompts: {
			intro: vi.fn(),
			confirm: vi.fn(),
			isCancel: vi.fn().mockReturnValue(false),
			note: vi.fn(),
			outro: vi.fn(),
		},
	}))

vi.mock("../../config.js", () => ({ getRegistryUrl: mockGetRegistryUrl }))
vi.mock("../../oidc.js", () => ({
	exchangeOidcInstallToken: mockExchangeOidcInstallToken,
}))
vi.mock("@clack/prompts", () => mockPrompts)
vi.mock("chalk", () => {
	const p = str => str
	p.bgCyan = p
	p.black = p
	p.cyan = p
	p.dim = p
	return { default: p }
})
vi.mock("../../ui.js", () => ({
	log: {
		success: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
	printHeader: vi.fn(),
}))

import { setup } from "../../commands/setup.js"
import { log } from "../../ui.js"

let tmpDir

describe("lpm setup --oidc", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		mockExchangeOidcInstallToken.mockReset()
		mockPrompts.confirm.mockReset()
		mockPrompts.isCancel.mockReturnValue(false)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	it("writes real OIDC token to .npmrc in proxy mode when exchange succeeds", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-oidc-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockExchangeOidcInstallToken.mockResolvedValueOnce("lpm_oidc_abc123")

		await setup({ oidc: true })

		const npmrc = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(npmrc).toContain("_authToken=lpm_oidc_abc123")
		expect(npmrc).toContain("registry=https://lpm.dev/api/registry")
		expect(npmrc).not.toContain("@lpm.dev:registry=")
		expect(npmrc).toContain("OIDC")
		// biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal npm token placeholder
		expect(npmrc).not.toContain("${LPM_TOKEN}")
		expect(log.success).toHaveBeenCalledWith(expect.stringContaining("OIDC"))
	})

	it("writes scoped OIDC token when --scoped is used", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-oidc-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockExchangeOidcInstallToken.mockResolvedValueOnce("lpm_oidc_abc123")

		await setup({ oidc: true, scoped: true })

		const npmrc = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(npmrc).toContain("@lpm.dev:registry=https://lpm.dev/api/registry")
		expect(npmrc).toContain("_authToken=lpm_oidc_abc123")
	})

	it("falls back to placeholder when OIDC exchange fails", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-oidc-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockExchangeOidcInstallToken.mockRejectedValueOnce(
			new Error("OIDC is not available"),
		)

		await setup({ oidc: true })

		const npmrc = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		// biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal npm token placeholder
		expect(npmrc).toContain("_authToken=${LPM_TOKEN}")
		expect(npmrc).not.toContain("lpm_oidc")
		expect(log.warn).toHaveBeenCalledWith(
			expect.stringContaining("OIDC exchange failed"),
		)
	})

	it("replaces existing LPM config in .npmrc with OIDC token", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-oidc-"))
		writeFileSync(
			join(tmpDir, ".npmrc"),
			// biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal npm token placeholder
			"other=true\n# LPM Registry\n@lpm.dev:registry=https://old\n//old/:_authToken=${LPM_TOKEN}\n",
		)
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockExchangeOidcInstallToken.mockResolvedValueOnce("lpm_fresh")

		await setup({ oidc: true })

		const npmrc = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(npmrc).toContain("other=true")
		expect(npmrc).toContain("lpm_fresh")
		expect(npmrc).not.toContain("https://old")
		// biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal npm token placeholder
		expect(npmrc).not.toContain("${LPM_TOKEN}")
	})

	it("without --oidc flag, default behavior is unchanged", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-oidc-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		await setup({})

		const npmrc = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		// biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal npm token placeholder
		expect(npmrc).toContain("_authToken=${LPM_TOKEN}")
		expect(mockExchangeOidcInstallToken).not.toHaveBeenCalled()
	})

	it("does not prompt for overwrite in OIDC mode", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-oidc-"))
		writeFileSync(join(tmpDir, ".npmrc"), "@lpm.dev:registry=https://old\n")
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockExchangeOidcInstallToken.mockResolvedValueOnce("lpm_tok")

		await setup({ oidc: true })

		expect(mockPrompts.confirm).not.toHaveBeenCalled()
		const npmrc = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(npmrc).toContain("lpm_tok")
	})

	it("mentions lpm npmrc in default mode help text", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-oidc-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		await setup({})

		expect(log.info).toHaveBeenCalledWith(expect.stringContaining("lpm npmrc"))
		expect(log.info).toHaveBeenCalledWith(expect.stringContaining("--oidc"))
	})
})
