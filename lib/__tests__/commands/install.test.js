import { EventEmitter } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockSpawn, mockGetToken, mockGetRegistryUrl, mockSkillsInstall } =
	vi.hoisted(() => ({
		mockSpawn: vi.fn(),
		mockGetToken: vi.fn().mockResolvedValue("test-token"),
		mockGetRegistryUrl: vi.fn().mockReturnValue("https://lpm.dev"),
		mockSkillsInstall: vi.fn().mockResolvedValue(undefined),
	}))

vi.mock("node:child_process", () => ({ spawn: mockSpawn }))
vi.mock("../../commands/skills.js", () => ({
	skillsInstall: mockSkillsInstall,
}))
vi.mock("../../config.js", () => ({
	getToken: mockGetToken,
	getRegistryUrl: mockGetRegistryUrl,
}))
vi.mock("../../ui.js", () => ({
	createSpinner: () => ({
		start: vi.fn().mockReturnThis(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		text: "",
	}),
	log: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
	printHeader: vi.fn(),
}))

import { install } from "../../commands/install.js"

let tmpDir

describe("install command", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit")
		})
		mockSpawn.mockReset()
		mockGetToken.mockReset().mockResolvedValue("test-token")
		mockSkillsInstall.mockReset().mockResolvedValue(undefined)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	it("exits when no auth token", async () => {
		mockGetToken.mockResolvedValueOnce(null)
		await expect(install([], {})).rejects.toThrow("process.exit")
	})

	it("exits when no packages and no package.json", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-install-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		await expect(install([], {})).rejects.toThrow("process.exit")
	})

	it("exits when no LPM packages in package.json", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-install-"))
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				dependencies: { lodash: "^4.17.21", express: "^4.18.0" },
			}),
		)
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		await expect(install([], {})).rejects.toThrow("process.exit")
	})

	it("filters LPM packages from package.json", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-install-"))
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				dependencies: {
					"@lpm.dev/test.button": "^1.0.0",
					lodash: "^4.17.21",
				},
				devDependencies: {
					"@lpm.dev/test.icons": "^0.5.0",
				},
			}),
		)
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		await install([], {})

		expect(mockSpawn).toHaveBeenCalledWith(
			"npm",
			expect.arrayContaining([
				"install",
				"@lpm.dev/test.button",
				"@lpm.dev/test.icons",
			]),
			expect.any(Object),
		)
	})

	it("spawns npm with explicit packages", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-install-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		await install(["@lpm.dev/test.button"], {})

		expect(mockSpawn).toHaveBeenCalledWith(
			"npm",
			expect.arrayContaining(["install", "@lpm.dev/test.button"]),
			expect.any(Object),
		)
	})

	it("passes LPM_TOKEN as environment variable", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-install-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		await install(["@lpm.dev/test.pkg"], {})

		expect(mockSpawn).toHaveBeenCalledWith(
			"npm",
			expect.any(Array),
			expect.objectContaining({
				env: expect.objectContaining({ LPM_TOKEN: "test-token" }),
			}),
		)
	})

	it("fetches skills by default after successful install", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-install-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		const promise = install(["@lpm.dev/test.pkg"], {})
		// Simulate successful npm install
		await new Promise(r => setTimeout(r, 0))
		child.emit("close", 0)
		await promise

		expect(mockSkillsInstall).toHaveBeenCalled()
	})

	it("skips skills when --no-skills is passed", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-install-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		const promise = install(["@lpm.dev/test.pkg"], { skills: false })
		await new Promise(r => setTimeout(r, 0))
		child.emit("close", 0)
		await promise

		expect(mockSkillsInstall).not.toHaveBeenCalled()
	})
})
