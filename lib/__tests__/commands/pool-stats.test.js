import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGet } = vi.hoisted(() => ({
	mockGet: vi.fn(),
}))

vi.mock('../../api.js', () => ({ get: mockGet }))
vi.mock('ora', () => ({
	default: () => ({
		start: vi.fn().mockReturnThis(),
		succeed: vi.fn().mockReturnThis(),
		fail: vi.fn().mockReturnThis(),
		stop: vi.fn().mockReturnThis(),
		text: '',
	}),
}))

import { poolStats } from '../../commands/pool-stats.js'

const MOCK_POOL_RESPONSE = {
	billingPeriod: '2026-02',
	totalWeightedDownloads: 5000,
	estimatedEarningsCents: 2450,
	packages: [
		{
			name: '@lpm.dev/alice.my-utils',
			owner: 'alice',
			packageName: 'my-utils',
			installCount: 120,
			weightedDownloads: 3200,
			sharePercentage: 1.85,
			estimatedEarningsCents: 1800,
		},
		{
			name: '@lpm.dev/alice.ui-kit',
			owner: 'alice',
			packageName: 'ui-kit',
			installCount: 45,
			weightedDownloads: 1800,
			sharePercentage: 0.65,
			estimatedEarningsCents: 650,
		},
	],
}

describe('pool stats command', () => {
	let mockExit

	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit')
		})
		mockGet.mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('calls the pool stats API endpoint', async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_POOL_RESPONSE),
		})

		await poolStats({ json: true })

		expect(mockGet).toHaveBeenCalledWith(
			'/pool/stats',
			expect.anything(),
		)
	})

	it('returns full pool stats as JSON', async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_POOL_RESPONSE),
		})

		await poolStats({ json: true })

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.billingPeriod).toBe('2026-02')
		expect(output.estimatedEarningsCents).toBe(2450)
		expect(output.packages).toHaveLength(2)
		expect(output.packages[0].name).toBe('@lpm.dev/alice.my-utils')
	})

	it('displays pretty output with table', async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(MOCK_POOL_RESPONSE),
		})

		await poolStats()

		const allOutput = console.log.mock.calls.map(c => c[0]).join('\n')
		expect(allOutput).toContain('Pool Earnings')
		expect(allOutput).toContain('2026-02')
	})

	it('handles empty packages gracefully', async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({
				...MOCK_POOL_RESPONSE,
				packages: [],
				estimatedEarningsCents: 0,
			}),
		})

		await poolStats()

		const allOutput = console.log.mock.calls.map(c => c[0]).join('\n')
		expect(allOutput).toContain('No pool packages found')
	})

	it('handles 401 errors', async () => {
		mockGet.mockResolvedValueOnce({
			ok: false,
			status: 401,
			json: () => Promise.resolve({ error: 'Unauthorized' }),
		})

		await expect(poolStats({ json: true })).rejects.toThrow('process.exit')

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.error).toBe('Unauthorized')
	})

	it('handles network errors', async () => {
		mockGet.mockRejectedValueOnce(new Error('fetch failed'))

		await expect(poolStats({ json: true })).rejects.toThrow('process.exit')

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.error).toBe('fetch failed')
	})
})
