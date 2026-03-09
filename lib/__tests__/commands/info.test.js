import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))

vi.mock("../../api.js", () => ({ get: mockGet }))
vi.mock("chalk", () => {
	const p = str => str
	p.red = p
	p.green = p
	p.cyan = p
	p.dim = p
	p.yellow = p
	p.bold = p
	p.white = p
	p.bold.cyan = p
	return { default: p }
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

import { info } from "../../commands/info.js"

function jsonResponse(body, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
	}
}

let consoleLogs = []

describe("info command", () => {
	beforeEach(() => {
		consoleLogs = []
		vi.spyOn(console, "log").mockImplementation((...args) =>
			consoleLogs.push(args.join(" ")),
		)
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit")
		})
		mockGet.mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("exits when no package name provided", async () => {
		await expect(info("", {})).rejects.toThrow("process.exit")
	})

	it("displays package info from API", async () => {
		mockGet.mockResolvedValueOnce(
			jsonResponse({
				name: "@lpm.dev/acme.utils",
				description: "Utility library",
				latestVersion: "2.1.0",
				downloads: 1500,
				"dist-tags": { latest: "2.1.0" },
				versions: { "2.1.0": { license: "MIT" } },
			}),
		)

		await info("@lpm.dev/acme.utils", {})

		const output = consoleLogs.join("\n")
		expect(output).toContain("@lpm.dev/acme.utils")
		expect(output).toContain("Utility library")
		expect(output).toContain("2.1.0")
	})

	it("outputs JSON when --json flag is set", async () => {
		const pkg = { name: "test", version: "1.0.0", "dist-tags": {} }
		mockGet.mockResolvedValueOnce(jsonResponse(pkg))

		await info("test", { json: true })

		const parsed = JSON.parse(consoleLogs.join(""))
		expect(parsed.name).toBe("test")
	})

	it("shows 404 error for missing package", async () => {
		mockGet.mockResolvedValueOnce(jsonResponse({}, 404))

		await expect(info("nonexistent", {})).rejects.toThrow("process.exit")
	})

	it("encodes package name in URL", async () => {
		mockGet.mockResolvedValueOnce(
			jsonResponse({
				name: "@lpm.dev/test.pkg",
				"dist-tags": {},
				versions: {},
			}),
		)

		await info("@lpm.dev/test.pkg", {})

		const [url] = mockGet.mock.calls[0]
		expect(url).toContain(encodeURIComponent("@lpm.dev/test.pkg"))
	})

	it("handles version specifier", async () => {
		mockGet.mockResolvedValueOnce(
			jsonResponse({
				name: "@lpm.dev/test.pkg",
				"dist-tags": {},
				versions: {},
			}),
		)

		await info("@lpm.dev/test.pkg@1.2.3", {})

		const [url] = mockGet.mock.calls[0]
		expect(url).toContain("1.2.3")
	})

	it("shows all versions when --allVersions flag is set", async () => {
		mockGet.mockResolvedValueOnce(
			jsonResponse({
				name: "test",
				"dist-tags": { latest: "2.0.0" },
				versions: { "1.0.0": {}, "2.0.0": {} },
				time: { "1.0.0": "2024-01-01", "2.0.0": "2024-06-01" },
			}),
		)

		await info("test", { allVersions: true })

		const output = consoleLogs.join("\n")
		expect(output).toContain("Versions:")
		expect(output).toContain("2.0.0")
		expect(output).toContain("1.0.0")
	})
})
