import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequest, mockSetToken } = vi.hoisted(() => ({
	mockRequest: vi.fn(),
	mockSetToken: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../api.js', () => ({ request: mockRequest }))
vi.mock('../../config.js', () => ({ setToken: mockSetToken }))
vi.mock('../../ui.js', () => ({
	createSpinner: () => ({
		start: vi.fn().mockReturnThis(),
		succeed: vi.fn(),
		fail: vi.fn(),
	}),
	printHeader: vi.fn(),
}))

import { rotateToken } from '../../commands/token-rotate.js'

describe('token-rotate command', () => {
	beforeEach(() => {
		mockRequest.mockReset()
		mockSetToken.mockReset()
	})

	afterEach(() => { vi.restoreAllMocks() })

	it('rotates token and stores new one', async () => {
		mockRequest.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ token: 'new-token-abc' }),
		})

		await rotateToken()

		expect(mockRequest).toHaveBeenCalledWith('/-/token/rotate', { method: 'POST' })
		expect(mockSetToken).toHaveBeenCalledWith('new-token-abc')
	})

	it('handles API error gracefully', async () => {
		mockRequest.mockResolvedValueOnce({
			ok: false,
			status: 500,
		})

		// Should not throw, handles error internally
		await rotateToken()
		expect(mockSetToken).not.toHaveBeenCalled()
	})

	it('handles network error gracefully', async () => {
		mockRequest.mockRejectedValueOnce(new Error('Network down'))

		await rotateToken()
		expect(mockSetToken).not.toHaveBeenCalled()
	})
})
