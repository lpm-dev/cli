import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockGetRegistryUrl, mockGetToken, mockFetch } = vi.hoisted(() => ({
	mockGetRegistryUrl: vi.fn().mockReturnValue("https://lpm.dev"),
	mockGetToken: vi.fn().mockResolvedValue("test-token"),
	mockFetch: vi.fn(),
}))

vi.mock("../../config.js", () => ({
	getRegistryUrl: mockGetRegistryUrl,
	getToken: mockGetToken,
}))
vi.mock("../../ui.js", () => ({
	createSpinner: () => ({
		start: vi.fn().mockReturnThis(),
		succeed: vi.fn(),
		fail: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		text: "",
	}),
	log: { info: vi.fn() },
	printHeader: vi.fn(),
}))
vi.mock("chalk", () => {
	const p = str => str
	p.red = p
	p.green = p
	p.blue = p
	p.yellow = p
	return { default: p }
})

vi.stubGlobal("fetch", mockFetch)

import { doctor } from "../../commands/doctor.js"

let tmpDir
let consoleLogs = []

describe("doctor command", () => {
	beforeEach(() => {
		consoleLogs = []
		vi.spyOn(console, "log").mockImplementation((...args) =>
			consoleLogs.push(args.join(" ")),
		)
		vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit")
		})
		mockFetch.mockReset()
		mockGetToken.mockResolvedValue("test-token")
	})

	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	it("runs all checks and shows summary", async () => {
		// Health check
		mockFetch.mockResolvedValueOnce({ ok: true })
		// Whoami check
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					plan_tier: "pro",
					usage: { storage_bytes: 1000, private_packages: 1 },
					limits: { storageBytes: 100_000_000, privatePackages: 10 },
				}),
		})

		tmpDir = mkdtempSync(join(tmpdir(), "lpm-doctor-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		await doctor()

		const output = consoleLogs.join("\n")
		expect(output).toContain("Summary:")
	})

	it("fails when no auth token", async () => {
		mockGetToken.mockResolvedValueOnce(null)
		mockFetch.mockResolvedValueOnce({ ok: true })

		tmpDir = mkdtempSync(join(tmpdir(), "lpm-doctor-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		await expect(doctor()).rejects.toThrow("process.exit")

		const output = consoleLogs.join("\n")
		expect(output).toContain("Auth Token")
	})

	it("handles registry unreachable", async () => {
		mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"))
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					plan_tier: "free",
					usage: { storage_bytes: 0, private_packages: 0 },
					limits: {},
				}),
		})

		tmpDir = mkdtempSync(join(tmpdir(), "lpm-doctor-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		await expect(doctor()).rejects.toThrow("process.exit")
	})

	it("detects .npmrc configuration", async () => {
		mockFetch.mockResolvedValueOnce({ ok: true })
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					plan_tier: "pro",
					usage: { storage_bytes: 0, private_packages: 0 },
					limits: {},
				}),
		})

		tmpDir = mkdtempSync(join(tmpdir(), "lpm-doctor-"))
		writeFileSync(
			join(tmpDir, ".npmrc"),
			"registry=https://lpm.dev/api/registry",
		)
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		await doctor()

		const output = consoleLogs.join("\n")
		expect(output).toContain(".npmrc")
	})
})
