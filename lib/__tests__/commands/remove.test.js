import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
	mockGetToken,
	mockGetRegistryUrl,
	mockFetch,
	mockPrompts,
	mockRemoveMcpServer,
} = vi.hoisted(() => ({
	mockGetToken: vi.fn().mockResolvedValue("test-token"),
	mockGetRegistryUrl: vi.fn().mockReturnValue("https://lpm.dev"),
	mockFetch: vi.fn(),
	mockPrompts: {
		intro: vi.fn(),
		outro: vi.fn(),
		cancel: vi.fn(),
		isCancel: vi.fn().mockReturnValue(false),
		log: {
			success: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
	},
	mockRemoveMcpServer: vi.fn().mockResolvedValue({
		success: true,
		message: "Removed from 2 editors.",
	}),
}))

vi.mock("../../config.js", () => ({
	getToken: mockGetToken,
	getRegistryUrl: mockGetRegistryUrl,
}))
vi.stubGlobal("fetch", mockFetch)
vi.mock("@clack/prompts", () => mockPrompts)
vi.mock("chalk", () => {
	const p = str => str
	p.bgCyan = p
	p.black = p
	p.cyan = p
	p.dim = p
	return { default: p }
})
vi.mock("../../install-targets.js", () => ({
	hasCustomHandler: vi.fn(type => type === "mcp-server"),
	getHandler: vi.fn(() => ({
		remove: mockRemoveMcpServer,
	})),
}))

import { remove } from "../../commands/remove.js"

describe("remove command", () => {
	beforeEach(() => {
		mockGetToken.mockReset().mockResolvedValue("test-token")
		mockFetch.mockReset()
		mockPrompts.log.success.mockReset()
		mockPrompts.log.info.mockReset()
		mockPrompts.log.error.mockReset()
		mockRemoveMcpServer.mockReset().mockResolvedValue({
			success: true,
			message: "Removed from 2 editors.",
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("fails when not logged in", async () => {
		mockGetToken.mockResolvedValueOnce(null)
		await remove("@lpm.dev/test.mcp", {})
		expect(mockPrompts.log.error).toHaveBeenCalledWith(
			expect.stringContaining("Not logged in"),
		)
	})

	it("handles package not found (404)", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 404,
			statusText: "Not Found",
		})
		await remove("@lpm.dev/test.mcp", {})
		expect(mockPrompts.log.error).toHaveBeenCalledWith(
			expect.stringContaining("not found"),
		)
	})

	it("normalizes short package names", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					"dist-tags": { latest: "1.0.0" },
					versions: {
						"1.0.0": {
							lpmConfig: { type: "mcp-server" },
						},
					},
					packageType: "mcp-server",
				}),
		})
		await remove("test.mcp", {})
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("@lpm.dev%2ftest.mcp"),
			expect.any(Object),
		)
	})

	it("calls handler remove for MCP server type", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					"dist-tags": { latest: "1.0.0" },
					versions: {
						"1.0.0": {
							lpmConfig: { type: "mcp-server" },
						},
					},
					packageType: "mcp-server",
				}),
		})
		await remove("@lpm.dev/test.mcp", {})
		expect(mockRemoveMcpServer).toHaveBeenCalledWith({
			name: "@lpm.dev/test.mcp",
		})
		expect(mockPrompts.log.success).toHaveBeenCalledWith(
			"Removed from 2 editors.",
		)
	})

	it("shows manual removal message for source packages", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					"dist-tags": { latest: "1.0.0" },
					versions: {
						"1.0.0": {
							lpmConfig: null,
						},
					},
					packageType: "source",
				}),
		})
		await remove("@lpm.dev/test.button", {})
		expect(mockPrompts.log.info).toHaveBeenCalledWith(
			expect.stringContaining("source files"),
		)
	})

	it("handles handler returning failure", async () => {
		mockRemoveMcpServer.mockResolvedValueOnce({
			success: false,
			message: "Failed to remove.",
		})
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					"dist-tags": { latest: "1.0.0" },
					versions: {
						"1.0.0": {
							lpmConfig: { type: "mcp-server" },
						},
					},
					packageType: "mcp-server",
				}),
		})
		await remove("@lpm.dev/test.mcp", {})
		expect(mockPrompts.log.error).toHaveBeenCalledWith("Failed to remove.")
	})
})
