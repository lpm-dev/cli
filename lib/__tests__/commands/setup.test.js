import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockGetRegistryUrl, mockPrompts } = vi.hoisted(() => ({
	mockGetRegistryUrl: vi.fn().mockReturnValue("https://lpm.dev"),
	mockPrompts: {
		intro: vi.fn(),
		confirm: vi.fn(),
		isCancel: vi.fn().mockReturnValue(false),
		note: vi.fn(),
		outro: vi.fn(),
	},
}))

vi.mock("../../config.js", () => ({ getRegistryUrl: mockGetRegistryUrl }))
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
	log: { success: vi.fn(), info: vi.fn(), warn: vi.fn() },
	printHeader: vi.fn(),
}))

import { setup } from "../../commands/setup.js"

let tmpDir

describe("setup command", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
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

	it("creates .npmrc with scoped mode by default", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-setup-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		await setup({})

		const npmrc = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(npmrc).toContain("@lpm.dev:registry=https://lpm.dev/api/registry")
		// biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal npm token placeholder
		expect(npmrc).toContain("_authToken=${LPM_TOKEN}")
	})

	it("creates .npmrc with scoped config when --scoped is used", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-setup-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		await setup({ scoped: true })

		const npmrc = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(npmrc).toContain("@lpm.dev:registry=https://lpm.dev/api/registry")
	})

	it("appends to existing .npmrc without LPM config", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-setup-"))
		writeFileSync(join(tmpDir, ".npmrc"), "some-existing-config=true\n")
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		await setup({})

		const npmrc = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(npmrc).toContain("some-existing-config=true")
		expect(npmrc).toContain("registry=https://lpm.dev/api/registry")
	})

	it("prompts to overwrite existing LPM config", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-setup-"))
		writeFileSync(join(tmpDir, ".npmrc"), "@lpm.dev:registry=https://old.url\n")
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		mockPrompts.confirm.mockResolvedValueOnce(true)

		await setup({})

		const npmrc = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(npmrc).toContain("registry=https://lpm.dev/api/registry")
	})

	it("cancels when user declines overwrite", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-setup-"))
		writeFileSync(join(tmpDir, ".npmrc"), "@lpm.dev:registry=https://old.url\n")
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		mockPrompts.confirm.mockResolvedValueOnce(false)

		await setup({})

		const npmrc = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(npmrc).toContain("https://old.url")
	})

	it("uses custom registry URL from options", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-setup-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		await setup({ registry: "https://custom.registry.dev" })

		const npmrc = readFileSync(join(tmpDir, ".npmrc"), "utf8")
		expect(npmrc).toContain("https://custom.registry.dev/api/registry")
	})
})
