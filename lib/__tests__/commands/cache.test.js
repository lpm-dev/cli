import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Override homedir to control cache directory
const { testHome } = vi.hoisted(() => {
	const os = require("node:os")
	const path = require("node:path")
	return { testHome: path.join(os.tmpdir(), `lpm-test-cache-${Date.now()}`) }
})

vi.mock("node:os", async () => {
	const actual = await vi.importActual("node:os")
	return { ...actual, homedir: () => testHome }
})

vi.mock("chalk", () => {
	const p = str => str
	p.red = p
	p.green = p
	p.cyan = p
	p.dim = p
	p.yellow = p
	p.bold = p
	return { default: p }
})
vi.mock("ora", () => ({
	default: () => ({
		start: vi.fn().mockReturnThis(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		info: vi.fn(),
		text: "",
	}),
}))

import { cache, clearCache } from "../../commands/cache.js"
import { CACHE_DIR_NAME } from "../../constants.js"

let consoleLogs = []

describe("cache command", () => {
	beforeEach(() => {
		consoleLogs = []
		mkdirSync(testHome, { recursive: true })
		vi.spyOn(console, "log").mockImplementation((...args) =>
			consoleLogs.push(args.join(" ")),
		)
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit")
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
		try {
			rmSync(join(testHome, CACHE_DIR_NAME), { recursive: true, force: true })
		} catch {}
	})

	it('cache("path") prints cache directory', async () => {
		await cache("path")
		expect(consoleLogs[0]).toContain(CACHE_DIR_NAME)
	})

	it('cache("list") shows "no packages cached" when empty', async () => {
		await cache("list")
		expect(consoleLogs.some(l => l.includes("No packages cached"))).toBe(true)
	})

	it('cache("list") lists cached packages', async () => {
		const cacheDir = join(testHome, CACHE_DIR_NAME, "my-pkg")
		mkdirSync(cacheDir, { recursive: true })
		writeFileSync(join(cacheDir, "my-pkg-1.0.0.tgz"), "fake tarball")

		await cache("list")

		const output = consoleLogs.join("\n")
		expect(output).toContain("my-pkg")
	})

	it("clearCache removes cache directory", async () => {
		const cacheDir = join(testHome, CACHE_DIR_NAME, "test-pkg")
		mkdirSync(cacheDir, { recursive: true })
		writeFileSync(join(cacheDir, "test-1.0.0.tgz"), "data")

		await clearCache()

		expect(existsSync(join(testHome, CACHE_DIR_NAME))).toBe(false)
	})

	it('cache("dir") is alias for path', async () => {
		await cache("dir")
		expect(consoleLogs[0]).toContain(CACHE_DIR_NAME)
	})

	it('cache("clean") is alias for clearCache', async () => {
		await cache("clean")
		// Should not throw
	})

	it("rejects unknown action", async () => {
		await expect(cache("unknown")).rejects.toThrow("process.exit")
	})
})
