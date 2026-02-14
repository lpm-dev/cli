import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks – vi.hoisted() so they're available inside vi.mock() factories
// ---------------------------------------------------------------------------

const { mockConfInstance, secureStoreMock } = vi.hoisted(() => {
	const mockConfInstance = {
		get: vi.fn(),
		set: vi.fn(),
		delete: vi.fn(),
	}
	const secureStoreMock = {
		getToken: vi.fn().mockResolvedValue(null),
		setToken: vi.fn().mockResolvedValue(undefined),
		clearToken: vi.fn().mockResolvedValue(undefined),
		isUsingKeychain: vi.fn().mockResolvedValue(false),
	}
	return { mockConfInstance, secureStoreMock }
})

vi.mock('conf', () => {
	return { default: function Conf() { return mockConfInstance } }
})

vi.mock('../secure-store.js', () => secureStoreMock)
import {
	clearToken,
	deleteConfigValue,
	getAllConfig,
	getConfigValue,
	getRegistryUrl,
	getRetries,
	getTimeout,
	getToken,
	setConfigValue,
	setRegistryUrl,
	setRetries,
	setTimeout,
	setToken,
} from '../config.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('config.js – getToken()', () => {
	const originalEnv = process.env.LPM_TOKEN

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.LPM_TOKEN
		} else {
			process.env.LPM_TOKEN = originalEnv
		}
		vi.clearAllMocks()
	})

	it('returns LPM_TOKEN env var if set', async () => {
		process.env.LPM_TOKEN = 'env-token-123'
		const token = await getToken()
		expect(token).toBe('env-token-123')
	})

	it('returns token from secure store', async () => {
		delete process.env.LPM_TOKEN
		secureStoreMock.getToken.mockResolvedValueOnce('secure-token-456')

		const token = await getToken()
		expect(token).toBe('secure-token-456')
	})

	it('migrates legacy token from conf to secure store', async () => {
		delete process.env.LPM_TOKEN
		secureStoreMock.getToken.mockResolvedValueOnce(null)
		mockConfInstance.get.mockReturnValueOnce('legacy-token-789')

		const token = await getToken()
		expect(token).toBe('legacy-token-789')
		expect(secureStoreMock.setToken).toHaveBeenCalledWith('legacy-token-789')
		expect(mockConfInstance.delete).toHaveBeenCalledWith('token')
	})

	it('returns null when no token exists', async () => {
		delete process.env.LPM_TOKEN
		secureStoreMock.getToken.mockResolvedValueOnce(null)
		mockConfInstance.get.mockReturnValueOnce(undefined)

		const token = await getToken()
		expect(token).toBeNull()
	})
})

describe('config.js – setToken()', () => {
	afterEach(() => vi.clearAllMocks())

	it('stores token in secure store and clears legacy', async () => {
		await setToken('new-token')
		expect(secureStoreMock.setToken).toHaveBeenCalledWith('new-token')
		expect(mockConfInstance.delete).toHaveBeenCalledWith('token')
	})

	it('clears token when null passed', async () => {
		await setToken(null)
		expect(secureStoreMock.clearToken).toHaveBeenCalled()
		expect(mockConfInstance.delete).toHaveBeenCalledWith('token')
	})
})

describe('config.js – clearToken()', () => {
	it('clears both secure store and legacy', async () => {
		await clearToken()
		expect(secureStoreMock.clearToken).toHaveBeenCalled()
		expect(mockConfInstance.delete).toHaveBeenCalledWith('token')
	})
})

describe('config.js – getRegistryUrl()', () => {
	const originalEnv = process.env.LPM_REGISTRY_URL

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.LPM_REGISTRY_URL
		} else {
			process.env.LPM_REGISTRY_URL = originalEnv
		}
	})

	it('returns LPM_REGISTRY_URL env var if set', () => {
		process.env.LPM_REGISTRY_URL = 'https://custom.registry.dev'
		expect(getRegistryUrl()).toBe('https://custom.registry.dev')
	})

	it('returns config value when no env var', () => {
		delete process.env.LPM_REGISTRY_URL
		mockConfInstance.get.mockReturnValueOnce('https://lpm.dev')
		expect(getRegistryUrl()).toBe('https://lpm.dev')
	})
})

describe('config.js – timeout and retries', () => {
	afterEach(() => vi.clearAllMocks())

	it('getTimeout() reads from config', () => {
		mockConfInstance.get.mockReturnValueOnce(5000)
		expect(getTimeout()).toBe(5000)
	})

	it('setTimeout() writes to config', () => {
		setTimeout(15000)
		expect(mockConfInstance.set).toHaveBeenCalledWith('timeout', 15000)
	})

	it('getRetries() reads from config', () => {
		mockConfInstance.get.mockReturnValueOnce(5)
		expect(getRetries()).toBe(5)
	})

	it('setRetries() writes to config', () => {
		setRetries(10)
		expect(mockConfInstance.set).toHaveBeenCalledWith('retries', 10)
	})
})

describe('config.js – setRegistryUrl()', () => {
	afterEach(() => vi.clearAllMocks())

	it('writes registryUrl to config', () => {
		setRegistryUrl('https://other.registry')
		expect(mockConfInstance.set).toHaveBeenCalledWith(
			'registryUrl',
			'https://other.registry',
		)
	})
})

describe('config.js – getAllConfig()', () => {
	afterEach(() => vi.clearAllMocks())

	it('returns full config object', async () => {
		delete process.env.LPM_TOKEN
		delete process.env.LPM_REGISTRY_URL
		secureStoreMock.getToken.mockResolvedValueOnce('some-token')
		secureStoreMock.isUsingKeychain.mockResolvedValueOnce(true)
		mockConfInstance.get
			.mockReturnValueOnce('https://lpm.dev')   // registryUrl
			.mockReturnValueOnce(30000)                  // timeout
			.mockReturnValueOnce(3)                      // retries

		const all = await getAllConfig()
		expect(all.authenticated).toBe(true)
		expect(all.secureStorage).toBe('keychain')
	})
})

describe('config.js – getConfigValue / setConfigValue / deleteConfigValue', () => {
	afterEach(() => vi.clearAllMocks())

	it('getConfigValue("timeout") returns timeout', () => {
		mockConfInstance.get.mockReturnValueOnce(30000)
		expect(getConfigValue('timeout')).toBe(30000)
	})

	it('getConfigValue falls back to raw conf.get for unknown keys', () => {
		mockConfInstance.get.mockReturnValueOnce('custom-value')
		expect(getConfigValue('customKey')).toBe('custom-value')
	})

	it('setConfigValue("timeout") coerces to number', () => {
		setConfigValue('timeout', '5000')
		expect(mockConfInstance.set).toHaveBeenCalledWith('timeout', 5000)
	})

	it('setConfigValue for arbitrary key', () => {
		setConfigValue('myKey', 'myVal')
		expect(mockConfInstance.set).toHaveBeenCalledWith('myKey', 'myVal')
	})

	it('deleteConfigValue resets protected keys to default', () => {
		deleteConfigValue('timeout')
		expect(mockConfInstance.set).toHaveBeenCalledWith('timeout', 30000)
	})

	it('deleteConfigValue deletes non-protected keys', () => {
		deleteConfigValue('customKey')
		expect(mockConfInstance.delete).toHaveBeenCalledWith('customKey')
	})
})
