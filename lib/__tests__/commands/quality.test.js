import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockGet } = vi.hoisted(() => ({
	mockGet: vi.fn(),
}))

vi.mock("../../api.js", () => ({ get: mockGet }))
vi.mock("ora", () => ({
	default: () => ({
		start: vi.fn().mockReturnThis(),
		succeed: vi.fn().mockReturnThis(),
		fail: vi.fn().mockReturnThis(),
		stop: vi.fn().mockReturnThis(),
		text: "",
	}),
}))

import { quality } from "../../commands/quality.js"

const MOCK_QUALITY_RESPONSE = {
	name: "@lpm.dev/alice.my-utils",
	score: 85,
	maxScore: 100,
	tier: "excellent",
	categories: {
		documentation: { score: 22, max: 25 },
		code: { score: 25, max: 30 },
		testing: { score: 12, max: 15 },
		health: { score: 26, max: 30 },
	},
	checks: [
		{
			id: "has-readme",
			category: "documentation",
			label: "Has README",
			passed: true,
			points: 8,
			max_points: 8,
			detail: "README found (2345 chars)",
		},
		{
			id: "has-types",
			category: "code",
			label: "Has Types",
			passed: true,
			points: 6,
			max_points: 6,
			detail: "TypeScript types found",
		},
		{
			id: "has-test-files",
			category: "testing",
			label: "Has Tests",
			passed: false,
			points: 0,
			max_points: 7,
			detail: "No test files found",
		},
	],
	publishedAt: "2025-01-15T12:00:00Z",
}

describe("quality command", () => {
	let mockExit

	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
		mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit")
		})
		mockGet.mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("calls the quality API endpoint with correct query param", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_QUALITY_RESPONSE),
		})

		await quality("alice.my-utils", { json: true })

		expect(mockGet).toHaveBeenCalledWith(
			"/quality?name=alice.my-utils",
			expect.anything(),
		)
	})

	it("returns full quality report as JSON", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_QUALITY_RESPONSE),
		})

		await quality("alice.my-utils", { json: true })

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.name).toBe("@lpm.dev/alice.my-utils")
		expect(output.score).toBe(85)
		expect(output.tier).toBe("excellent")
		expect(output.categories.documentation.score).toBe(22)
		expect(output.checks).toHaveLength(3)
	})

	it("strips @lpm.dev/ prefix from input", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_QUALITY_RESPONSE),
		})

		await quality("@lpm.dev/alice.my-utils", { json: true })

		expect(mockGet).toHaveBeenCalledWith(
			"/quality?name=alice.my-utils",
			expect.anything(),
		)
	})

	it("displays pretty output with score and checks", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_QUALITY_RESPONSE),
		})

		await quality("alice.my-utils")

		// Pretty mode writes to console.log
		const allOutput = console.log.mock.calls.map(c => c[0]).join("\n")
		expect(allOutput).toContain("85/100")
		expect(allOutput).toContain("Excellent")
	})

	it("handles no quality data gracefully", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					name: "@lpm.dev/alice.old-pkg",
					score: null,
					message: "No quality data available.",
				}),
		})

		await quality("alice.old-pkg")

		const allOutput = console.log.mock.calls.map(c => c[0]).join("\n")
		expect(allOutput).toContain("No quality data available")
	})

	it("exits with error for empty input", async () => {
		await expect(quality("", { json: true })).rejects.toThrow("process.exit")
		expect(mockExit).toHaveBeenCalledWith(1)
	})

	it("exits with error for invalid format", async () => {
		await expect(quality("no-dot", { json: true })).rejects.toThrow(
			"process.exit",
		)
		expect(mockExit).toHaveBeenCalledWith(1)
	})

	it("handles 404 errors", async () => {
		mockGet.mockResolvedValueOnce({
			ok: false,
			status: 404,
			json: () => Promise.resolve({ error: "Package not found" }),
		})

		await expect(quality("alice.no-exist", { json: true })).rejects.toThrow(
			"process.exit",
		)

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.error).toBe("Package not found")
	})

	it("handles 403 errors for private packages", async () => {
		mockGet.mockResolvedValueOnce({
			ok: false,
			status: 403,
			json: () =>
				Promise.resolve({
					error: "Authentication required for private packages",
				}),
		})

		await expect(quality("alice.private-pkg", { json: true })).rejects.toThrow(
			"process.exit",
		)

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.error).toBe("Authentication required for private packages")
	})

	it("handles network errors gracefully", async () => {
		mockGet.mockRejectedValueOnce(new Error("fetch failed"))

		await expect(quality("alice.my-utils", { json: true })).rejects.toThrow(
			"process.exit",
		)

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.error).toBe("fetch failed")
	})

	it("shows tips for failed checks in pretty mode", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_QUALITY_RESPONSE),
		})

		await quality("alice.my-utils")

		const allOutput = console.log.mock.calls.map(c => c[0]).join("\n")
		expect(allOutput).toContain("Tip:")
		expect(allOutput).toContain("+7 points")
	})
})
