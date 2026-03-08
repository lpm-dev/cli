import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
	mockRequest,
	mockSetToken,
	mockGetRegistryUrl,
	mockOpen,
	mockCreateServer,
	mockServerInstance,
} = vi.hoisted(() => {
	const mockServerInstance = {
		listen: vi.fn(),
		close: vi.fn((cb) => cb?.()),
		address: vi.fn().mockReturnValue({ port: 12345 }),
	}
	return {
		mockRequest: vi.fn(),
		mockSetToken: vi.fn().mockResolvedValue(undefined),
		mockGetRegistryUrl: vi.fn().mockReturnValue("https://lpm.dev"),
		mockOpen: vi.fn().mockResolvedValue(undefined),
		mockCreateServer: vi.fn().mockReturnValue(mockServerInstance),
		mockServerInstance,
	}
})

vi.mock("node:http", () => ({
	default: { createServer: mockCreateServer },
}))
vi.mock("open", () => ({ default: mockOpen }))
vi.mock("../../api.js", () => ({ request: mockRequest }))
vi.mock("../../config.js", () => ({
	getRegistryUrl: mockGetRegistryUrl,
	setToken: mockSetToken,
}))
vi.mock("../../ui.js", () => ({
	createSpinner: () => ({
		start: vi.fn().mockReturnThis(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		text: "",
	}),
	log: {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		success: vi.fn(),
	},
	printHeader: vi.fn(),
}))

import { login } from "../../commands/login.js"

// Helper to capture the HTTP server request handler
function getRequestHandler() {
	return mockCreateServer.mock.calls[0]?.[0]
}

// Helper to simulate an HTTP request to the server
function createMockReq(pathname, searchParams = {}) {
	const url = new URL(pathname, "http://localhost:12345")
	for (const [key, value] of Object.entries(searchParams)) {
		url.searchParams.set(key, value)
	}
	return {
		url: url.pathname + url.search,
		headers: { host: "localhost:12345" },
	}
}

function createMockRes() {
	const res = {
		setHeader: vi.fn(),
		end: vi.fn(),
		on: vi.fn((event, cb) => {
			// Immediately fire 'finish' for test purposes
			if (event === "finish") cb()
			return res
		}),
	}
	return res
}

describe("login command", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(process, "exit").mockImplementation(() => {})

		// Make server.listen immediately call the callback
		mockServerInstance.listen.mockImplementation((_port, cb) => cb?.())
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("creates HTTP server and opens browser with correct URL", async () => {
		await login()

		expect(mockCreateServer).toHaveBeenCalledTimes(1)
		expect(mockServerInstance.listen).toHaveBeenCalledWith(
			0,
			expect.any(Function),
		)
		expect(mockOpen).toHaveBeenCalledWith(
			"https://lpm.dev/cli/login?port=12345",
		)
	})

	it("uses custom registry URL for login", async () => {
		mockGetRegistryUrl.mockReturnValue("https://custom.registry.dev")
		await login()
		expect(mockOpen).toHaveBeenCalledWith(
			"https://custom.registry.dev/cli/login?port=12345",
		)
	})

	it("stores token and verifies via whoami on successful callback", async () => {
		await login()

		const handler = getRequestHandler()
		const req = createMockReq("/callback", { token: "abc-token-123" })
		const res = createMockRes()

		mockRequest.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					username: "testuser",
					profile_username: "testuser",
				}),
		})

		await handler(req, res)

		expect(mockSetToken).toHaveBeenCalledWith("abc-token-123")
		expect(mockRequest).toHaveBeenCalledWith("/-/whoami")
		expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/html")
		expect(res.end).toHaveBeenCalledTimes(1)

		// Should contain success HTML
		const html = res.end.mock.calls[0][0]
		expect(html).toContain("Access Granted")
		expect(html).toContain("testuser")
	})

	it("shows username warning when profile_username is not set", async () => {
		await login()

		const handler = getRequestHandler()
		const req = createMockReq("/callback", { token: "abc-token-123" })
		const res = createMockRes()

		mockRequest.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					username: "testuser",
					profile_username: null,
				}),
		})

		await handler(req, res)

		// Success still happens
		expect(res.end).toHaveBeenCalledTimes(1)
		const html = res.end.mock.calls[0][0]
		expect(html).toContain("Access Granted")
	})

	it("returns error HTML when token verification fails", async () => {
		await login()

		const handler = getRequestHandler()
		const req = createMockReq("/callback", { token: "bad-token" })
		const res = createMockRes()

		mockRequest.mockResolvedValueOnce({ ok: false, status: 401 })

		await handler(req, res)

		expect(mockSetToken).toHaveBeenCalledWith("bad-token")
		expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/html")

		const html = res.end.mock.calls[0][0]
		expect(html).toContain("Invalid Token")
	})

	it("returns error HTML when whoami request throws", async () => {
		await login()

		const handler = getRequestHandler()
		const req = createMockReq("/callback", { token: "err-token" })
		const res = createMockRes()

		mockRequest.mockRejectedValueOnce(new Error("Network error"))

		await handler(req, res)

		const html = res.end.mock.calls[0][0]
		expect(html).toContain("Verification Error")
	})

	it("returns error HTML when no token provided in callback", async () => {
		await login()

		const handler = getRequestHandler()
		const req = createMockReq("/callback")
		const res = createMockRes()

		await handler(req, res)

		expect(mockSetToken).not.toHaveBeenCalled()
		const html = res.end.mock.calls[0][0]
		expect(html).toContain("No Token")
	})

	it("returns plain text for non-callback paths", async () => {
		await login()

		const handler = getRequestHandler()
		const req = createMockReq("/")
		const res = createMockRes()

		await handler(req, res)

		expect(res.end).toHaveBeenCalledWith("LPM CLI Login Server")
	})

	it("sets CORS header on all responses", async () => {
		await login()

		const handler = getRequestHandler()
		const req = createMockReq("/anything")
		const res = createMockRes()

		await handler(req, res)

		expect(res.setHeader).toHaveBeenCalledWith(
			"Access-Control-Allow-Origin",
			"*",
		)
	})

	it("closes server after successful authentication", async () => {
		await login()

		const handler = getRequestHandler()
		const req = createMockReq("/callback", { token: "abc-token" })
		const res = createMockRes()

		mockRequest.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					username: "user",
					profile_username: "user",
				}),
		})

		await handler(req, res)

		// res.on('finish') triggers server.close
		expect(mockServerInstance.close).toHaveBeenCalled()
	})
})
