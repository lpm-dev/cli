import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks – vi.hoisted() so they're available inside vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, configMocks } = vi.hoisted(() => {
	const mockFetch = vi.fn()
	const configMocks = {
		getToken: vi.fn().mockResolvedValue('test-token'),
		getRegistryUrl: vi.fn().mockReturnValue('https://lpm.dev'),
		getTimeout: vi.fn().mockReturnValue(30_000),
		getRetries: vi.fn().mockReturnValue(2),
	}
	return { mockFetch, configMocks }
})

vi.mock('../config.js', () => configMocks)

// Mock global fetch (native, no longer node-fetch)
vi.stubGlobal('fetch', mockFetch)

import { checkToken, get, post, put, request, verifyTokenScope } from '../api.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body, status = 200, headers = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: {
			get: key => headers[key] ?? null,
		},
		json: () => Promise.resolve(body),
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api.js – request()', () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		mockFetch.mockReset()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('sends GET request to correct URL with auth header', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }))

		const res = await request('/test')
		expect(mockFetch).toHaveBeenCalledOnce()

		const [url, opts] = mockFetch.mock.calls[0]
		expect(url).toBe('https://lpm.dev/api/registry/test')
		expect(opts.headers.Authorization).toBe('Bearer test-token')
	})

	it('omits Authorization header when no token', async () => {
		configMocks.getToken.mockResolvedValueOnce(null)
		mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }))

		await request('/no-auth')

		const [, opts] = mockFetch.mock.calls[0]
		expect(opts.headers.Authorization).toBeUndefined()
	})

	it('throws on 401 without retrying', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({}, 401))

		await expect(request('/protected')).rejects.toThrow(/Not authenticated/)
		expect(mockFetch).toHaveBeenCalledOnce()
	})

	it('throws on 403 with error message from body', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ error: 'Forbidden resource' }, 403),
		)

		await expect(request('/forbidden')).rejects.toThrow('Forbidden resource')
	})

	it('handles 403 purchase-required with registry link', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse(
				{ error: 'Package @lpm.dev/acme.ui requires purchase' },
				403,
			),
		)

		await expect(request('/purchase')).rejects.toThrow(/Purchase:/)
	})

	it('retries on 500 with exponential backoff', async () => {
		mockFetch
			.mockResolvedValueOnce(jsonResponse({}, 500))
			.mockResolvedValueOnce(jsonResponse({}, 500))
			.mockResolvedValueOnce(jsonResponse({ ok: true }))

		const res = await request('/retry-me')
		expect(res.status).toBe(200)
		expect(mockFetch).toHaveBeenCalledTimes(3)
	})

	it('calls onRetry callback during retries', async () => {
		mockFetch
			.mockResolvedValueOnce(jsonResponse({}, 502))
			.mockResolvedValueOnce(jsonResponse({ ok: true }))

		const onRetry = vi.fn()
		await request('/with-callback', { onRetry })

		expect(onRetry).toHaveBeenCalledWith(1, 2)
	})

	it('skips retry when skipRetry is true', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({}, 500))

		const res = await request('/no-retry', { skipRetry: true })
		expect(res.status).toBe(500)
		expect(mockFetch).toHaveBeenCalledOnce()
	})

	it('handles rate limiting (429) with Retry-After header', async () => {
		mockFetch
			.mockResolvedValueOnce(
				jsonResponse({}, 429, { 'Retry-After': '1' }),
			)
			.mockResolvedValueOnce(jsonResponse({ ok: true }))

		const onRateLimited = vi.fn()
		const res = await request('/rate-limited', { onRateLimited })

		expect(onRateLimited).toHaveBeenCalledWith(1)
		expect(res.status).toBe(200)
	})

	it('throws rate limited error when no retries left', async () => {
		configMocks.getRetries.mockReturnValue(0)
		mockFetch.mockResolvedValueOnce(jsonResponse({}, 429))

		await expect(request('/rate-limited-no-retry')).rejects.toThrow(
			/Rate limited/,
		)
		configMocks.getRetries.mockReturnValue(2)
	})

	it('retries on network error (ECONNREFUSED)', async () => {
		const connError = new Error('connect ECONNREFUSED')
		connError.code = 'ECONNREFUSED'

		mockFetch
			.mockRejectedValueOnce(connError)
			.mockResolvedValueOnce(jsonResponse({ ok: true }))

		const res = await request('/network-retry')
		expect(res.status).toBe(200)
		expect(mockFetch).toHaveBeenCalledTimes(2)
	})

	it('throws network error after all retries exhausted', async () => {
		const connError = new Error('connect ECONNREFUSED')
		connError.code = 'ECONNREFUSED'

		mockFetch
			.mockRejectedValueOnce(connError)
			.mockRejectedValueOnce(connError)
			.mockRejectedValueOnce(connError)

		await expect(request('/network-fail')).rejects.toThrow(
			/Network error/,
		)
		expect(mockFetch).toHaveBeenCalledTimes(3)
	})

	it('throws timeout error on AbortError', async () => {
		const abortError = new Error('The operation was aborted')
		abortError.name = 'AbortError'

		mockFetch
			.mockRejectedValueOnce(abortError)
			.mockRejectedValueOnce(abortError)
			.mockRejectedValueOnce(abortError)

		await expect(request('/timeout', { timeout: 1 })).rejects.toThrow(
			/timed out/,
		)
	})

	it('re-throws non-network/abort errors immediately', async () => {
		mockFetch.mockRejectedValueOnce(new Error('Some unknown error'))

		await expect(request('/unknown-error')).rejects.toThrow(
			'Some unknown error',
		)
		expect(mockFetch).toHaveBeenCalledOnce()
	})
})

describe('api.js – convenience methods', () => {
	beforeEach(() => {
		mockFetch.mockReset()
	})

	it('get() sends GET method', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({}))

		await get('/pkg')

		const [, opts] = mockFetch.mock.calls[0]
		expect(opts.method).toBe('GET')
	})

	it('post() sends POST with JSON body', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({}))

		await post('/publish', { name: 'pkg' })

		const [, opts] = mockFetch.mock.calls[0]
		expect(opts.method).toBe('POST')
		expect(opts.headers['Content-Type']).toBe('application/json')
		expect(opts.body).toBe(JSON.stringify({ name: 'pkg' }))
	})

	it('put() sends PUT with JSON body', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({}))

		await put('/update', { version: '2.0.0' })

		const [, opts] = mockFetch.mock.calls[0]
		expect(opts.method).toBe('PUT')
		expect(opts.headers['Content-Type']).toBe('application/json')
	})
})

describe('api.js – checkToken()', () => {
	beforeEach(() => {
		mockFetch.mockReset()
	})

	it('returns valid with scopes on success', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ scopes: ['read', 'publish'], user: 'alice' }),
		)

		const result = await checkToken()
		expect(result.valid).toBe(true)
		expect(result.scopes).toEqual(['read', 'publish'])
		expect(result.user).toBe('alice')
	})

	it('returns invalid on non-ok response', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ error: 'Token expired' }, 401),
		)

		const result = await checkToken()
		expect(result.valid).toBe(false)
	})

	it('returns invalid on network error', async () => {
		const connError = new Error('connect ECONNREFUSED')
		connError.code = 'ECONNREFUSED'
		mockFetch.mockRejectedValueOnce(connError)

		const result = await checkToken()
		expect(result.valid).toBe(false)
		expect(result.error).toBeDefined()
	})
})

describe('api.js – verifyTokenScope()', () => {
	beforeEach(() => {
		mockFetch.mockReset()
	})

	it('returns valid when scope is present', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ scopes: ['read', 'publish'] }),
		)

		const result = await verifyTokenScope('publish')
		expect(result.valid).toBe(true)
	})

	it('returns valid when user has "full" scope', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ scopes: ['full'] }),
		)

		const result = await verifyTokenScope('publish')
		expect(result.valid).toBe(true)
	})

	it('returns invalid when scope is missing', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ scopes: ['read'] }),
		)

		const result = await verifyTokenScope('publish')
		expect(result.valid).toBe(false)
		expect(result.error).toMatch(/missing required scope/)
	})
})
