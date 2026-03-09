import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }))

vi.mock("../../api.js", () => ({ post: mockPost }))
vi.mock("chalk", () => {
	const passthrough = str => str
	passthrough.red = passthrough
	passthrough.green = passthrough
	passthrough.cyan = passthrough
	passthrough.dim = passthrough
	passthrough.yellow = passthrough
	passthrough.bold = passthrough
	return { default: passthrough }
})
vi.mock("ora", () => ({
	default: () => ({
		start: vi.fn().mockReturnThis(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		text: "",
	}),
}))

import { outdated } from "../../commands/outdated.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir

function createTmpProject(files = {}) {
	tmpDir = mkdtempSync(join(tmpdir(), "lpm-outdated-"))
	for (const [filePath, content] of Object.entries(files)) {
		const fullPath = join(tmpDir, filePath)
		mkdirSync(join(tmpDir), { recursive: true })
		writeFileSync(
			fullPath,
			typeof content === "string" ? content : JSON.stringify(content),
		)
	}
	vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
}

function jsonResponse(body, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
	}
}

let consoleLogs = []

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("outdated command", () => {
	beforeEach(() => {
		consoleLogs = []
		vi.spyOn(console, "log").mockImplementation((...args) =>
			consoleLogs.push(args.join(" ")),
		)
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit")
		})
		mockPost.mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	it("exits when no package.json", async () => {
		createTmpProject({})
		await expect(outdated({})).rejects.toThrow("process.exit")
	})

	it("reports all up to date when no outdated packages", async () => {
		createTmpProject({
			"package.json": {
				dependencies: { lodash: "^4.17.21" },
			},
		})

		mockPost.mockResolvedValueOnce(
			jsonResponse({
				packages: {
					lodash: { latest: "4.17.21" },
				},
			}),
		)

		await outdated({})

		expect(consoleLogs.some(l => l.includes("up to date"))).toBe(true)
	})

	it("shows outdated packages with update type", async () => {
		createTmpProject({
			"package.json": {
				dependencies: {
					lodash: "^4.17.0",
					react: "^17.0.0",
				},
			},
		})

		mockPost.mockResolvedValueOnce(
			jsonResponse({
				packages: {
					lodash: { latest: "4.17.21" },
					react: { latest: "18.2.0" },
				},
			}),
		)

		await outdated({})

		const output = consoleLogs.join("\n")
		expect(output).toContain("outdated")
	})

	it("outputs JSON when --json flag is set", async () => {
		createTmpProject({
			"package.json": {
				dependencies: { lodash: "4.17.0" },
			},
		})

		mockPost.mockResolvedValueOnce(
			jsonResponse({
				packages: { lodash: { latest: "4.17.21" } },
			}),
		)

		await outdated({ json: true })

		const jsonStr = consoleLogs.join("")
		const parsed = JSON.parse(jsonStr)
		expect(Array.isArray(parsed)).toBe(true)
		expect(parsed[0].name).toBe("lodash")
	})

	it("handles API error gracefully", async () => {
		createTmpProject({
			"package.json": { dependencies: { foo: "1.0.0" } },
		})

		mockPost.mockResolvedValueOnce(jsonResponse({ error: "fail" }, 500))

		await expect(outdated({})).rejects.toThrow("process.exit")
	})
})
