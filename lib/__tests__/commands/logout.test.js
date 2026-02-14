import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequest, mockConfig } = vi.hoisted(() => ({
	mockRequest: vi.fn(),
	mockConfig: {
		getToken: vi.fn().mockResolvedValue('test-token'),
		clearToken: vi.fn().mockResolvedValue(undefined),
	},
}))

vi.mock('../../api.js', () => ({ request: mockRequest }))
vi.mock('../../config.js', () => mockConfig)
vi.mock('chalk', () => {
	const p = str => str
	p.red = p; p.green = p; p.dim = p
	return { default: p }
})
vi.mock('ora', () => ({
	default: () => ({
		start: vi.fn().mockReturnThis(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		info: vi.fn(),
		text: '',
	}),
}))

import { logout } from '../../commands/logout.js'

describe('logout command', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
		mockRequest.mockReset()
		mockConfig.getToken.mockReset().mockResolvedValue('test-token')
		mockConfig.clearToken.mockReset().mockResolvedValue(undefined)
	})

	afterEach(() => { vi.restoreAllMocks() })

	it('clears token on basic logout', async () => {
		await logout({})
		expect(mockConfig.clearToken).toHaveBeenCalled()
	})

	it('reports not logged in when no token', async () => {
		mockConfig.getToken.mockResolvedValueOnce(null)
		await logout({})
		expect(mockConfig.clearToken).not.toHaveBeenCalled()
	})

	it('revokes token on server when --revoke', async () => {
		mockRequest.mockResolvedValueOnce({ ok: true })
		await logout({ revoke: true })
		expect(mockRequest).toHaveBeenCalledWith('/tokens/revoke', expect.objectContaining({
			method: 'POST',
			skipRetry: true,
		}))
		expect(mockConfig.clearToken).toHaveBeenCalled()
	})

	it('continues logout even if revoke fails', async () => {
		mockRequest.mockRejectedValueOnce(new Error('network'))
		await logout({ revoke: true })
		expect(mockConfig.clearToken).toHaveBeenCalled()
	})
})
