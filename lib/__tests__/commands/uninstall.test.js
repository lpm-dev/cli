import { EventEmitter } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockSpawn, mockGetToken, mockGetRegistryUrl, mockGetPackageManager } =
	vi.hoisted(() => ({
		mockSpawn: vi.fn(),
		mockGetToken: vi.fn().mockResolvedValue("test-token"),
		mockGetRegistryUrl: vi.fn().mockReturnValue("https://lpm.dev"),
		mockGetPackageManager: vi.fn().mockReturnValue("npm"),
	}))

vi.mock("node:child_process", () => ({ spawn: mockSpawn }))
vi.mock("../../config.js", () => ({
	getToken: mockGetToken,
	getRegistryUrl: mockGetRegistryUrl,
	getPackageManager: mockGetPackageManager,
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

import { uninstall } from "../../commands/uninstall.js"
import { log } from "../../ui.js"

let tmpDir

describe("uninstall command", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit")
		})
		mockSpawn.mockReset()
		mockGetToken.mockReset().mockResolvedValue("test-token")
	})

	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	it("exits when no packages specified", async () => {
		await expect(uninstall([])).rejects.toThrow("process.exit")
		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining("specify at least one package"),
		)
	})

	it("exits when no auth token", async () => {
		mockGetToken.mockResolvedValueOnce(null)
		await expect(uninstall(["@lpm.dev/test.pkg"])).rejects.toThrow(
			"process.exit",
		)
		expect(log.error).toHaveBeenCalledWith(expect.stringContaining("lpm login"))
	})

	it("spawns npm uninstall with correct packages", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-uninstall-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		await uninstall(["@lpm.dev/test.button", "@lpm.dev/test.icons"])

		expect(mockSpawn).toHaveBeenCalledWith(
			"npm",
			expect.arrayContaining([
				"uninstall",
				"@lpm.dev/test.button",
				"@lpm.dev/test.icons",
			]),
			expect.any(Object),
		)
	})

	it("passes --userconfig with temp .npmrc", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-uninstall-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		await uninstall(["@lpm.dev/test.pkg"])

		expect(mockSpawn).toHaveBeenCalledWith(
			"npm",
			expect.arrayContaining([
				"--userconfig",
				expect.stringContaining(".npmrc.lpm-"),
			]),
			expect.any(Object),
		)
	})

	it("passes LPM_TOKEN as environment variable", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-uninstall-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		await uninstall(["@lpm.dev/test.pkg"])

		expect(mockSpawn).toHaveBeenCalledWith(
			"npm",
			expect.any(Array),
			expect.objectContaining({
				env: expect.objectContaining({ LPM_TOKEN: "test-token" }),
			}),
		)
	})

	it("shows success message on exit code 0", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-uninstall-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		const promise = uninstall(["@lpm.dev/test.pkg"])
		await new Promise(r => setTimeout(r, 0))
		child.emit("close", 0)
		await promise

		expect(log.success).toHaveBeenCalledWith(
			"Packages uninstalled successfully.",
		)
	})

	it("exits with error on non-zero exit code", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-uninstall-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		const promise = uninstall(["@lpm.dev/test.pkg"])
		await new Promise(r => setTimeout(r, 0))

		await expect(async () => {
			child.emit("close", 1)
			await promise
		}).rejects.toThrow("process.exit")

		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining("npm uninstall failed"),
		)
	})

	it("exits with error on spawn failure", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-uninstall-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		const promise = uninstall(["@lpm.dev/test.pkg"])
		await new Promise(r => setTimeout(r, 0))

		await expect(async () => {
			child.emit("error", new Error("spawn failed"))
			await promise
		}).rejects.toThrow("process.exit")

		expect(log.error).toHaveBeenCalledWith(
			expect.stringContaining("Failed to start npm"),
		)
	})

	it("uses pnpm when --pm pnpm is passed", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-uninstall-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		mockGetPackageManager.mockReturnValue("pnpm")

		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		await uninstall(["@lpm.dev/test.pkg"], { pm: "pnpm" })

		expect(mockGetPackageManager).toHaveBeenCalledWith("pnpm")
		expect(mockSpawn).toHaveBeenCalledWith(
			"pnpm",
			expect.arrayContaining(["uninstall", "@lpm.dev/test.pkg"]),
			expect.any(Object),
		)
	})
})
