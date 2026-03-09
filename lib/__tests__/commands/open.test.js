import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockRequest, mockGetRegistryUrl, mockOpen } = vi.hoisted(() => ({
	mockRequest: vi.fn(),
	mockGetRegistryUrl: vi.fn().mockReturnValue("https://lpm.dev"),
	mockOpen: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../api.js", () => ({ request: mockRequest }))
vi.mock("../../config.js", () => ({ getRegistryUrl: mockGetRegistryUrl }))
vi.mock("open", () => ({ default: mockOpen }))
vi.mock("../../ui.js", () => ({
	createSpinner: () => ({
		start: vi.fn().mockReturnThis(),
		succeed: vi.fn(),
		fail: vi.fn(),
		text: "",
	}),
}))

import { openDashboard } from "../../commands/open.js"

let tmpDir

describe("open command", () => {
	beforeEach(() => {
		mockRequest.mockReset()
		mockOpen.mockReset().mockResolvedValue(undefined)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	it("opens dashboard when not in a package directory", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-open-"))
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		await openDashboard()

		expect(mockOpen).toHaveBeenCalledWith("https://lpm.dev/dashboard")
	})

	it("opens personal packages dashboard for matching user", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-open-"))
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "@lpm.dev/alice.utils",
			}),
		)
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		mockRequest.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					profile_username: "alice",
					organizations: [],
				}),
		})

		await openDashboard()

		expect(mockOpen).toHaveBeenCalledWith("https://lpm.dev/dashboard/packages")
	})

	it("opens org dashboard for matching org", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-open-"))
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "@lpm.dev/acme.design-system",
			}),
		)
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		mockRequest.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					profile_username: "alice",
					organizations: [{ slug: "acme", role: "admin" }],
				}),
		})

		await openDashboard()

		expect(mockOpen).toHaveBeenCalledWith(
			"https://lpm.dev/dashboard/orgs/acme/packages",
		)
	})

	it("opens public page for unrecognized owner", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-open-"))
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "@lpm.dev/other.thing",
			}),
		)
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		mockRequest.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					profile_username: "alice",
					organizations: [],
				}),
		})

		await openDashboard()

		expect(mockOpen).toHaveBeenCalledWith("https://lpm.dev/other.thing")
	})

	it("opens public page when not authenticated", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-open-"))
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "@lpm.dev/test.pkg",
			}),
		)
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		mockRequest.mockResolvedValueOnce({ ok: false, status: 401 })

		await openDashboard()

		expect(mockOpen).toHaveBeenCalledWith("https://lpm.dev/test.pkg")
	})

	it("falls back to dashboard on API error", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "lpm-open-"))
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({
				name: "@lpm.dev/test.pkg",
			}),
		)
		vi.spyOn(process, "cwd").mockReturnValue(tmpDir)

		mockRequest.mockRejectedValueOnce(new Error("network"))

		await openDashboard()

		expect(mockOpen).toHaveBeenCalledWith("https://lpm.dev/dashboard")
	})
})
