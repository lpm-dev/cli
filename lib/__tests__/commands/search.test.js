import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }))

vi.mock('../../api.js', () => ({ get: mockGet }))
vi.mock('chalk', () => {
	const passthrough = str => str
	passthrough.red = passthrough
	passthrough.green = passthrough
	passthrough.cyan = passthrough
	passthrough.dim = passthrough
	passthrough.yellow = passthrough
	passthrough.bold = passthrough
	return { default: passthrough }
})

vi.mock('ora', () => ({
	default: () => ({
		start: vi.fn().mockReturnThis(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		text: '',
	}),
}))

import { search } from '../../commands/search.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
	}
}

// Capture console output
let consoleLogs = []
let consoleErrors = []

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('search command', () => {
	beforeEach(() => {
		consoleLogs = []
		consoleErrors = []
		vi.spyOn(console, 'log').mockImplementation((...args) => consoleLogs.push(args.join(' ')))
		vi.spyOn(console, 'error').mockImplementation((...args) => consoleErrors.push(args.join(' ')))
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit')
		})
		mockGet.mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('exits with error for empty query', async () => {
		await expect(search('', {})).rejects.toThrow('process.exit')
		expect(consoleErrors.some(l => l.includes('Search query required'))).toBe(true)
	})

	it('displays packages from API response', async () => {
		mockGet.mockResolvedValueOnce(
			jsonResponse({
				packages: [
					{
						name: 'ui-button',
						owner: 'acme',
						version: '1.2.0',
						downloads: 1500,
						description: 'A nice button component',
					},
				],
			}),
		)

		await search('button', {})

		const output = consoleLogs.join('\n')
		expect(output).toContain('Found 1 package')
		expect(output).toContain('@lpm.dev/acme.ui-button')
		expect(output).toContain('A nice button component')
	})

	it('outputs JSON when --json flag is set', async () => {
		const packages = [{ name: 'test-pkg', owner: 'user', version: '1.0.0', downloads: 0 }]
		mockGet.mockResolvedValueOnce(jsonResponse({ packages }))

		await search('test', { json: true })

		const jsonOutput = consoleLogs.join('')
		const parsed = JSON.parse(jsonOutput)
		expect(parsed).toHaveLength(1)
		expect(parsed[0].name).toBe('test-pkg')
	})

	it('shows "no packages found" for empty results', async () => {
		mockGet.mockResolvedValueOnce(jsonResponse({ packages: [] }))

		await search('nonexistent', {})

		expect(consoleLogs.some(l => l.includes('No packages found'))).toBe(true)
	})

	it('passes limit option to API', async () => {
		mockGet.mockResolvedValueOnce(jsonResponse({ packages: [] }))

		await search('test', { limit: 5 })

		const [url] = mockGet.mock.calls[0]
		expect(url).toContain('limit=5')
	})

	it('encodes special characters in query', async () => {
		mockGet.mockResolvedValueOnce(jsonResponse({ packages: [] }))

		await search('@lpm.dev/test', {})

		const [url] = mockGet.mock.calls[0]
		expect(url).toContain(encodeURIComponent('@lpm.dev/test'))
	})

	it('formats download counts (K, M)', async () => {
		mockGet.mockResolvedValueOnce(
			jsonResponse({
				packages: [
					{ name: 'popular', owner: 'big', version: '1.0.0', downloads: 2500000 },
				],
			}),
		)

		await search('popular', {})

		const output = consoleLogs.join('\n')
		expect(output).toContain('2.5M')
	})

	it('exits on API error', async () => {
		mockGet.mockResolvedValueOnce(jsonResponse({ error: 'Server error' }, 500))

		await expect(search('fail', {})).rejects.toThrow('process.exit')
	})
})
