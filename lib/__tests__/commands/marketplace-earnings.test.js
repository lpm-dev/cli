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

import { marketplaceEarnings } from "../../commands/marketplace-earnings.js"

const MOCK_EARNINGS = {
	totalSales: 12,
	grossRevenueCents: 15000,
	platformFeesCents: 1500,
	netRevenueCents: 13500,
}

describe("marketplace earnings command", () => {
	let _mockExit

	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
		_mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit")
		})
		mockGet.mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("calls the marketplace earnings endpoint", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_EARNINGS),
		})

		await marketplaceEarnings({ json: true })

		expect(mockGet).toHaveBeenCalledWith(
			"/marketplace/earnings",
			expect.anything(),
		)
	})

	it("returns earnings as JSON", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_EARNINGS),
		})

		await marketplaceEarnings({ json: true })

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.totalSales).toBe(12)
		expect(output.grossRevenueCents).toBe(15000)
		expect(output.netRevenueCents).toBe(13500)
	})

	it("displays pretty output with revenue", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_EARNINGS),
		})

		await marketplaceEarnings()

		const allOutput = console.log.mock.calls.map(c => c[0]).join("\n")
		expect(allOutput).toContain("Marketplace Earnings")
		expect(allOutput).toContain("Total Sales")
	})

	it("handles no sales gracefully", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					totalSales: 0,
					grossRevenueCents: 0,
					platformFeesCents: 0,
					netRevenueCents: 0,
				}),
		})

		await marketplaceEarnings()

		const allOutput = console.log.mock.calls.map(c => c[0]).join("\n")
		expect(allOutput).toContain("No marketplace sales yet")
	})

	it("handles 401 errors", async () => {
		mockGet.mockResolvedValueOnce({
			ok: false,
			status: 401,
			json: () => Promise.resolve({ error: "Unauthorized" }),
		})

		await expect(marketplaceEarnings({ json: true })).rejects.toThrow(
			"process.exit",
		)

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.error).toBe("Unauthorized")
	})

	it("handles network errors", async () => {
		mockGet.mockRejectedValueOnce(new Error("fetch failed"))

		await expect(marketplaceEarnings({ json: true })).rejects.toThrow(
			"process.exit",
		)

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.error).toBe("fetch failed")
	})
})
