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
		text: '',
	}),
}))

import { checkName } from '../../commands/check-name.js'

describe('check-name command', () => {
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

	it('calls the check-name API endpoint with correct query param', async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({
				name: '@lpm.dev/alice.my-utils',
				available: true,
				ownerExists: true,
				ownerType: 'user',
			}),
		})

		await checkName('alice.my-utils', { json: true })

		expect(mockGet).toHaveBeenCalledWith(
			'/check-name?name=alice.my-utils',
			expect.anything(),
		)
	})

	it('reports available when API returns available: true', async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({
				name: '@lpm.dev/alice.my-utils',
				available: true,
				ownerExists: true,
				ownerType: 'user',
			}),
		})

		await checkName('alice.my-utils', { json: true })

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.available).toBe(true)
		expect(output.name).toBe('@lpm.dev/alice.my-utils')
		expect(output.ownerExists).toBe(true)
	})

	it('reports taken when API returns available: false', async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({
				name: '@lpm.dev/alice.my-utils',
				available: false,
				ownerExists: true,
				ownerType: 'user',
			}),
		})

		await checkName('alice.my-utils', { json: true })

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.available).toBe(false)
	})

	it('strips @lpm.dev/ prefix from input', async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({
				name: '@lpm.dev/bob.cool-lib',
				available: true,
				ownerExists: true,
				ownerType: 'user',
			}),
		})

		await checkName('@lpm.dev/bob.cool-lib', { json: true })

		expect(mockGet).toHaveBeenCalledWith(
			'/check-name?name=bob.cool-lib',
			expect.anything(),
		)
	})

	it('exits with error for empty input', async () => {
		await expect(checkName('', { json: true })).rejects.toThrow('process.exit')
		expect(mockExit).toHaveBeenCalledWith(1)

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.error).toBe('Package name required.')
	})

	it('exits with error for invalid format (no dot)', async () => {
		await expect(checkName('no-dot-here', { json: true })).rejects.toThrow('process.exit')
		expect(mockExit).toHaveBeenCalledWith(1)

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.error).toContain('Invalid package name format')
	})

	it('exits with error for name starting with dot', async () => {
		await expect(checkName('.leading-dot', { json: true })).rejects.toThrow('process.exit')
		expect(mockExit).toHaveBeenCalledWith(1)
	})

	it('exits with error for name ending with dot', async () => {
		await expect(checkName('trailing.', { json: true })).rejects.toThrow('process.exit')
		expect(mockExit).toHaveBeenCalledWith(1)
	})

	it('handles API errors gracefully', async () => {
		mockGet.mockResolvedValueOnce({
			ok: false,
			status: 401,
			json: () => Promise.resolve({ error: 'Unauthorized' }),
		})

		await expect(checkName('alice.my-utils', { json: true })).rejects.toThrow('process.exit')
		expect(mockExit).toHaveBeenCalledWith(1)

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.error).toBe('Unauthorized')
	})

	it('handles network errors gracefully', async () => {
		mockGet.mockRejectedValueOnce(new Error('fetch failed'))

		await expect(checkName('alice.my-utils', { json: true })).rejects.toThrow('process.exit')
		expect(mockExit).toHaveBeenCalledWith(1)

		const output = JSON.parse(console.log.mock.calls[0][0])
		expect(output.error).toBe('fetch failed')
	})

	it('shows pretty output for available name', async () => {
		mockGet.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({
				name: '@lpm.dev/alice.my-utils',
				available: true,
				ownerExists: true,
				ownerType: 'user',
			}),
		})

		await checkName('alice.my-utils')

		// In non-JSON mode, uses ora spinner — no console.log for result
		expect(console.log).not.toHaveBeenCalled()
	})
})
