import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { configMocks } = vi.hoisted(() => {
	const configMocks = {
		getAllConfig: vi.fn().mockResolvedValue({
			registryUrl: 'https://lpm.dev',
			timeout: 30000,
			retries: 3,
			secureStorage: 'encrypted-file',
			authenticated: true,
		}),
		getConfigValue: vi.fn(),
		setConfigValue: vi.fn().mockReturnValue(true),
		deleteConfigValue: vi.fn().mockReturnValue(true),
	}
	return { configMocks }
})

vi.mock('../../config.js', () => configMocks)
vi.mock('chalk', () => {
	const p = str => str
	p.red = p; p.green = p; p.cyan = p; p.dim = p; p.yellow = p; p.bold = p
	return { default: p }
})

import { config } from '../../commands/config.js'

let consoleLogs = []

describe('config command', () => {
	beforeEach(() => {
		consoleLogs = []
		vi.spyOn(console, 'log').mockImplementation((...args) => consoleLogs.push(args.join(' ')))
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
	})

	afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

	it('config("list") shows all config values', async () => {
		await config('list')
		const output = consoleLogs.join('\n')
		expect(output).toContain('https://lpm.dev')
		expect(output).toContain('30000')
	})

	it('config(undefined) defaults to list', async () => {
		await config(undefined)
		expect(configMocks.getAllConfig).toHaveBeenCalled()
	})

	it('config("get", "timeout") shows value', async () => {
		configMocks.getConfigValue.mockReturnValueOnce(30000)
		await config('get', 'timeout')
		expect(consoleLogs.some(l => l.includes('30000'))).toBe(true)
	})

	it('config("get") without key exits', async () => {
		await expect(config('get')).rejects.toThrow('process.exit')
	})

	it('config("set", "timeout", "5000") sets value', async () => {
		await config('set', 'timeout', '5000')
		expect(configMocks.setConfigValue).toHaveBeenCalledWith('timeout', '5000')
	})

	it('config("set") without key and value exits', async () => {
		await expect(config('set')).rejects.toThrow('process.exit')
	})

	it('config("set", "registry", "invalid") validates URL', async () => {
		await expect(config('set', 'registry', 'not-a-url')).rejects.toThrow('process.exit')
	})

	it('config("delete", "customKey") deletes value', async () => {
		await config('delete', 'customKey')
		expect(configMocks.deleteConfigValue).toHaveBeenCalledWith('customKey')
	})

	it('config("rm") is alias for delete', async () => {
		await config('rm', 'someKey')
		expect(configMocks.deleteConfigValue).toHaveBeenCalledWith('someKey')
	})

	it('config("delete") without key exits', async () => {
		await expect(config('delete')).rejects.toThrow('process.exit')
	})

	it('rejects unknown action', async () => {
		await expect(config('unknown')).rejects.toThrow('process.exit')
	})
})
