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

import { marketplaceCompare } from "../../commands/marketplace-compare.js"

const MOCK_COMPARABLES_RESPONSE = {
	comparables: [
		{
			name: "@lpm.dev/acme.ui-buttons",
			owner: "acme",
			packageName: "ui-buttons",
			description: "Beautiful button components",
			downloadCount: 5400,
			qualityScore: 88,
			distributionMode: "marketplace",
			category: "ui-components",
			tags: ["react", "ui"],
			pricing: {
				planCount: 2,
				minPriceCents: 999,
				maxPriceCents: 2999,
				currency: "usd",
				types: ["one_time"],
				licenseTypes: ["individual", "organization"],
			},
		},
		{
			name: "@lpm.dev/bob.react-kit",
			owner: "bob",
			packageName: "react-kit",
			description: "React component toolkit",
			downloadCount: 3200,
			qualityScore: 72,
			distributionMode: "pool",
			category: "ui-components",
			tags: ["react"],
			pricing: null,
		},
	],
	stats: {
		total: 2,
		priceRange: {
			minCents: 999,
			maxCents: 999,
			medianCents: 999,
		},
	},
}

describe("marketplace compare command", () => {
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

	it("calls comparables API with category", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_COMPARABLES_RESPONSE),
		})

		await marketplaceCompare("ui-components", { json: true })

		expect(mockGet).toHaveBeenCalledWith(
			expect.stringContaining("/marketplace/comparables?"),
			expect.anything(),
		)
		expect(mockGet.mock.calls[0][0]).toContain("category=ui-components")
	})

	it("calls comparables API with package name as query", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_COMPARABLES_RESPONSE),
		})

		await marketplaceCompare("acme.ui-buttons", { json: true })

		expect(mockGet.mock.calls[0][0]).toContain("q=ui-buttons")
	})

	it("returns comparables as JSON", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_COMPARABLES_RESPONSE),
		})

		await marketplaceCompare("ui-components", { json: true })

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.comparables).toHaveLength(2)
		expect(output.stats.total).toBe(2)
		expect(output.comparables[0].pricing.minPriceCents).toBe(999)
	})

	it("displays pretty output with table", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_COMPARABLES_RESPONSE),
		})

		await marketplaceCompare("ui-components")

		const allOutput = console.log.mock.calls.map(c => c[0]).join("\n")
		expect(allOutput).toContain("2 packages found")
	})

	it("handles empty results", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ comparables: [], stats: { total: 0 } }),
		})

		await marketplaceCompare("nonexistent-category")

		const allOutput = console.log.mock.calls.map(c => c[0]).join("\n")
		expect(allOutput).toContain("No comparable packages found")
	})

	it("exits with error for empty input", async () => {
		await expect(marketplaceCompare("", { json: true })).rejects.toThrow(
			"process.exit",
		)
		expect(mockExit).toHaveBeenCalledWith(1)
	})

	it("handles API errors", async () => {
		mockGet.mockResolvedValueOnce({
			ok: false,
			status: 400,
			json: () =>
				Promise.resolve({
					error:
						'At least one of "category" or "q" query parameter is required',
				}),
		})

		await expect(
			marketplaceCompare("some-input", { json: true }),
		).rejects.toThrow("process.exit")

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.error).toContain("query parameter is required")
	})

	it("handles network errors", async () => {
		mockGet.mockRejectedValueOnce(new Error("fetch failed"))

		await expect(
			marketplaceCompare("ui-components", { json: true }),
		).rejects.toThrow("process.exit")

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.error).toBe("fetch failed")
	})

	it("strips @lpm.dev/ prefix for package names", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_COMPARABLES_RESPONSE),
		})

		await marketplaceCompare("@lpm.dev/acme.ui-buttons", { json: true })

		expect(mockGet.mock.calls[0][0]).toContain("q=ui-buttons")
	})

	it("passes category option from CLI flag", async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_COMPARABLES_RESPONSE),
		})

		await marketplaceCompare("dummy", { json: true, category: "tools" })

		expect(mockGet.mock.calls[0][0]).toContain("category=tools")
	})
})
