import { EventEmitter } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockSpawn, mockGetToken, mockGetRegistryUrl } = vi.hoisted(() => ({
	mockSpawn: vi.fn(),
	mockGetToken: vi.fn().mockResolvedValue("test-token"),
	mockGetRegistryUrl: vi.fn().mockReturnValue("https://lpm.dev"),
}))

vi.mock("node:child_process", () => ({ spawn: mockSpawn }))
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

describe("install command - --json mode", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(process.stdout, "write").mockImplementation(() => true)
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

	it("--json writes structured JSON on auth failure", async () => {
		mockGetToken.mockResolvedValueOnce(null)

		await expect(install([], { json: true })).rejects.toThrow("process.exit")

		const writeCall = process.stdout.write.mock.calls.find(
			call => typeof call[0] === "string" && call[0].includes('"success"'),
		)
		expect(writeCall).toBeDefined()
		const output = JSON.parse(writeCall[0])
		expect(output.success).toBe(false)
		expect(output.errors).toContain(
			'You must be logged in to install packages. Run "lpm login" first.',
		)
	})

	it("--json writes structured JSON when no package.json", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-install-json-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		await expect(install([], { json: true })).rejects.toThrow("process.exit")

		const writeCall = process.stdout.write.mock.calls.find(
			call => typeof call[0] === "string" && call[0].includes('"success"'),
		)
		expect(writeCall).toBeDefined()
		const output = JSON.parse(writeCall[0])
		expect(output.success).toBe(false)
		expect(output.errors[0]).toContain("No packages specified")
	})

	it("--json uses pipe stdio instead of inherit", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-install-json-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		child.stdout = new EventEmitter()
		child.stderr = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		// await to let async setup (getToken, etc.) complete before checking
		await install(["@lpm.dev/test.button"], { json: true })

		expect(mockSpawn).toHaveBeenCalledWith(
			"npm",
			expect.any(Array),
			expect.objectContaining({ stdio: "pipe" }),
		)
	})

	it("--json captures npm output on success", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-install-json-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		child.stdout = new EventEmitter()
		child.stderr = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		// await to set up event handlers
		await install(["@lpm.dev/test.button"], { json: true })

		// Now emit events — handlers are already attached
		child.stdout.emit("data", Buffer.from("added 1 package"))
		child.stderr.emit("data", Buffer.from(""))
		child.emit("close", 0)

		const writeCall = process.stdout.write.mock.calls.find(
			call => typeof call[0] === "string" && call[0].includes('"success"'),
		)
		expect(writeCall).toBeDefined()
		const output = JSON.parse(writeCall[0])
		expect(output.success).toBe(true)
		expect(output.packages).toEqual([{ name: "@lpm.dev/test.button" }])
		expect(output.npmOutput).toContain("added 1 package")
	})

	it("--json captures npm error on failure", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-install-json-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		child.stdout = new EventEmitter()
		child.stderr = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		await install(["@lpm.dev/test.button"], { json: true })

		// Emit failure stderr data
		child.stderr.emit("data", Buffer.from("ERR! package not found"))

		// The close handler is async, so process.exit (mocked to throw) causes
		// an unhandled rejection. Instead of throwing, track the exit call.
		let exitCode = null
		process.exit.mockImplementation(code => {
			exitCode = code
		})

		child.emit("close", 1)

		// Allow the async close handler to complete
		await new Promise(resolve => setTimeout(resolve, 0))

		expect(exitCode).toBe(1)

		const writeCall = process.stdout.write.mock.calls.find(
			call => typeof call[0] === "string" && call[0].includes('"success"'),
		)
		expect(writeCall).toBeDefined()
		const output = JSON.parse(writeCall[0])
		expect(output.success).toBe(false)
		expect(output.errors[0]).toContain("npm install failed")
	})

	it("--json includes resolved package names from package.json", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-install-json-"))
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				dependencies: {
					"@lpm.dev/test.button": "^1.0.0",
					"@lpm.dev/test.icons": "^0.5.0",
					lodash: "^4.17.21",
				},
			}),
		)
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		const child = new EventEmitter()
		child.stdout = new EventEmitter()
		child.stderr = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		await install([], { json: true })

		child.stdout.emit("data", Buffer.from("added 2 packages"))
		child.emit("close", 0)

		const writeCall = process.stdout.write.mock.calls.find(
			call => typeof call[0] === "string" && call[0].includes('"success"'),
		)
		expect(writeCall).toBeDefined()
		const output = JSON.parse(writeCall[0])
		expect(output.packages).toEqual(
			expect.arrayContaining([
				{ name: "@lpm.dev/test.button" },
				{ name: "@lpm.dev/test.icons" },
			]),
		)
		// Should NOT include lodash (non-LPM package)
		expect(output.packages).not.toEqual(
			expect.arrayContaining([{ name: "lodash" }]),
		)
	})
})
