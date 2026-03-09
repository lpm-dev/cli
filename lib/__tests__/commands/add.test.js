import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
	mockGetToken,
	mockGetRegistryUrl,
	mockFetch,
	mockSpinner,
	mockParseLpmPackageReference,
} = vi.hoisted(() => {
	const spinner = {
		start: vi.fn(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		text: "",
	}
	spinner.start.mockReturnValue(spinner)
	return {
		mockGetToken: vi.fn().mockResolvedValue("test-token"),
		mockGetRegistryUrl: vi.fn().mockReturnValue("https://lpm.dev"),
		mockFetch: vi.fn(),
		mockSpinner: spinner,
		mockParseLpmPackageReference: vi.fn().mockReturnValue({
			name: "@lpm.dev/test.button",
			version: "latest",
			inlineConfig: {},
			providedParams: new Set(),
		}),
	}
})

vi.mock("../../config.js", () => ({
	getToken: mockGetToken,
	getRegistryUrl: mockGetRegistryUrl,
}))
vi.stubGlobal("fetch", mockFetch)
vi.mock("chalk", () => {
	const p = str => str
	p.cyan = p
	p.green = p
	p.dim = p
	p.bold = p
	p.blue = p
	p.yellow = p
	p.red = p
	p.grey = p
	return { default: p }
})
vi.mock("ora", () => ({ default: () => mockSpinner }))
vi.mock("tar", () => ({ t: vi.fn(), x: vi.fn() }))
vi.mock("diff", () => ({ diffLines: vi.fn() }))
vi.mock("../../integrity.js", () => ({
	verifyIntegrity: vi.fn().mockReturnValue({ valid: true }),
}))
vi.mock("../../lpm-config.js", () => ({
	parseLpmPackageReference: mockParseLpmPackageReference,
	readLpmConfig: vi.fn().mockReturnValue(null),
	filterFiles: vi.fn(),
	expandSrcGlob: vi.fn(),
	resolveConditionalDependencies: vi.fn(),
}))
vi.mock("../../lpm-config-prompts.js", () => ({
	promptForMissingConfig: vi.fn(),
}))
vi.mock("../../project-utils.js", () => ({
	detectFramework: vi.fn().mockReturnValue("nextjs"),
	getDefaultPath: vi.fn().mockReturnValue("./components"),
	getUserImportPrefix: vi.fn().mockReturnValue("@"),
}))
vi.mock("../../safe-path.js", () => ({
	validateComponentPath: vi
		.fn()
		.mockReturnValue({ valid: true, resolvedPath: "/tmp/test" }),
	validateTarballPaths: vi.fn().mockReturnValue({ valid: true }),
}))
vi.mock("@clack/prompts", () => ({
	text: vi.fn(),
	select: vi.fn(),
	confirm: vi.fn(),
	isCancel: vi.fn().mockReturnValue(false),
	cancel: vi.fn(),
}))

import { add } from "../../commands/add.js"

describe("add command", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})
		mockGetToken.mockReset().mockResolvedValue("test-token")
		mockFetch.mockReset()
		mockParseLpmPackageReference.mockReturnValue({
			name: "@lpm.dev/test.button",
			version: "latest",
			inlineConfig: {},
			providedParams: new Set(),
		})
		mockSpinner.start.mockClear().mockReturnValue(mockSpinner)
		mockSpinner.stop.mockClear()
		mockSpinner.succeed.mockClear()
		mockSpinner.fail.mockClear()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("fails when not logged in", async () => {
		mockGetToken.mockResolvedValueOnce(null)
		await add("@lpm.dev/test.button", {})
		expect(mockSpinner.fail).toHaveBeenCalledWith(
			expect.stringContaining("Not logged in"),
		)
	})

	it("handles package not found (404)", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 404,
			statusText: "Not Found",
		})
		await add("@lpm.dev/test.button", {})
		expect(mockSpinner.fail).toHaveBeenCalledWith(
			expect.stringContaining("not found"),
		)
	})

	it("handles unauthorized access (403)", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 403,
			statusText: "Forbidden",
		})
		await add("@lpm.dev/test.button", {})
		expect(mockSpinner.fail).toHaveBeenCalledWith(
			expect.stringContaining("Unauthorized"),
		)
	})

	it("handles unauthorized access (401)", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
		})
		await add("@lpm.dev/test.button", {})
		expect(mockSpinner.fail).toHaveBeenCalledWith(
			expect.stringContaining("Unauthorized"),
		)
	})

	it("handles version not found", async () => {
		mockParseLpmPackageReference.mockReturnValueOnce({
			name: "@lpm.dev/test.button",
			version: "99.0.0",
			inlineConfig: {},
			providedParams: new Set(),
		})
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					"dist-tags": { latest: "1.0.0" },
					versions: {
						"1.0.0": { dist: { tarball: "https://example.com/t.tgz" } },
					},
				}),
		})
		await add("@lpm.dev/test.button@99.0.0", {})
		expect(mockSpinner.fail).toHaveBeenCalledWith(
			expect.stringContaining("not found"),
		)
	})
})
