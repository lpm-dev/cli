import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequest, mockGetRegistryUrl } = vi.hoisted(() => ({
	mockRequest: vi.fn(),
	mockGetRegistryUrl: vi.fn().mockReturnValue('https://lpm.dev'),
}))

vi.mock('../../api.js', () => ({ request: mockRequest }))
vi.mock('../../config.js', () => ({ getRegistryUrl: mockGetRegistryUrl }))
vi.mock('../../ui.js', () => ({
	log: {
		success: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
	printHeader: vi.fn(),
}))

import { whoami } from '../../commands/whoami.js'
import { log } from '../../ui.js'

describe('whoami command', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		mockRequest.mockReset()
		log.success.mockClear()
		log.info.mockClear()
		log.warn.mockClear()
		log.error.mockClear()
	})

	afterEach(() => { vi.restoreAllMocks() })

	it('displays username on success', async () => {
		mockRequest.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ username: 'alice' }),
		})

		await whoami()

		expect(log.success).toHaveBeenCalledWith(expect.stringContaining('alice'))
	})

	it('displays plan tier and usage', async () => {
		mockRequest.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({
				username: 'alice',
				plan_tier: 'pro',
				has_pool_access: true,
				usage: { storage_bytes: 1024 * 1024 * 5, private_packages: 3 },
				limits: { storageBytes: 1024 * 1024 * 100, privatePackages: 10 },
				profile_username: 'alice',
				organizations: [{ slug: 'acme', role: 'admin' }],
			}),
		})

		await whoami()

		expect(log.info).toHaveBeenCalledWith(expect.stringContaining('PRO'))
		expect(log.success).toHaveBeenCalledWith(expect.stringContaining('Pool: Active'))
		expect(log.info).toHaveBeenCalledWith(expect.stringContaining('@lpm.dev/alice.*'))
		expect(log.info).toHaveBeenCalledWith(expect.stringContaining('@lpm.dev/acme.*'))
	})

	it('warns when over limit', async () => {
		mockRequest.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({
				username: 'bob',
				plan_tier: 'free',
				usage: { storage_bytes: 200_000_000, private_packages: 5 },
				limits: { storageBytes: 100_000_000, privatePackages: 3 },
			}),
		})

		await whoami()

		expect(log.error).toHaveBeenCalledWith(expect.stringContaining('OVER LIMIT'))
		expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('over its plan limits'))
	})

	it('warns when personal username not set', async () => {
		mockRequest.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ username: 'charlie' }),
		})

		await whoami()

		expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Not set'))
	})

	it('handles API error gracefully', async () => {
		mockRequest.mockRejectedValueOnce(new Error('Network error'))

		await whoami()

		expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Network error'))
	})

	it('handles non-ok response', async () => {
		mockRequest.mockResolvedValueOnce({
			ok: false,
			status: 401,
		})

		await whoami()

		expect(log.error).toHaveBeenCalled()
	})

	it('outputs structured JSON with --json flag', async () => {
		mockRequest.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({
				username: 'alice',
				profile_username: 'alice',
				email: 'alice@example.com',
				plan_tier: 'pro',
				has_pool_access: true,
				usage: { storage_bytes: 1024 * 1024, private_packages: 2 },
				limits: { storageBytes: 1024 * 1024 * 100, privatePackages: 10 },
				organizations: [
					{ slug: 'acme', name: 'Acme Corp', role: 'owner' },
				],
			}),
		})

		await whoami({ json: true })

		const output = console.log.mock.calls[0][0]
		const parsed = JSON.parse(output)

		expect(parsed.username).toBe('alice')
		expect(parsed.profileUsername).toBe('alice')
		expect(parsed.email).toBe('alice@example.com')
		expect(parsed.plan).toBe('pro')
		expect(parsed.hasPoolAccess).toBe(true)
		expect(parsed.orgs).toHaveLength(1)
		expect(parsed.orgs[0].slug).toBe('acme')
		expect(parsed.orgs[0].role).toBe('owner')
		// Should not print header or log.success in JSON mode
		expect(log.success).not.toHaveBeenCalled()
	})
})
