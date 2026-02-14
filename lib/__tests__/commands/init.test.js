import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { mockGetRegistryUrl, mockPrompts, mockSetup } = vi.hoisted(() => ({
	mockGetRegistryUrl: vi.fn().mockReturnValue('https://lpm.dev'),
	mockPrompts: {
		intro: vi.fn(),
		text: vi.fn(),
		select: vi.fn(),
		confirm: vi.fn(),
		group: vi.fn(),
		note: vi.fn(),
		outro: vi.fn(),
		cancel: vi.fn(),
		isCancel: vi.fn().mockReturnValue(false),
	},
	mockSetup: vi.fn(),
}))

vi.mock('../../config.js', () => ({ getRegistryUrl: mockGetRegistryUrl }))
vi.mock('@clack/prompts', () => mockPrompts)
vi.mock('chalk', () => {
	const p = str => str
	p.bgCyan = p; p.black = p; p.cyan = p
	return { default: p }
})
vi.mock('../../ui.js', () => ({ printHeader: vi.fn() }))
vi.mock('../../commands/setup.js', () => ({ setup: mockSetup }))

import { init } from '../../commands/init.js'

let tmpDir

describe('init command', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		mockPrompts.group.mockReset()
		mockPrompts.confirm.mockReset()
		mockPrompts.isCancel.mockReturnValue(false)
		mockSetup.mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) { rmSync(tmpDir, { recursive: true, force: true }); tmpDir = null }
	})

	it('creates package.json with correct structure', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'lpm-init-'))
		vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)

		mockPrompts.group.mockResolvedValueOnce({
			name: '@lpm.dev/test.my-package',
			version: '1.0.0',
			description: 'Test package',
			entry: 'index.js',
			license: 'ISC',
			confirm: true,
		})
		mockPrompts.confirm.mockResolvedValueOnce(false) // decline .npmrc setup

		await init()

		const pkgJson = JSON.parse(readFileSync(join(tmpDir, 'package.json'), 'utf8'))
		expect(pkgJson.name).toBe('@lpm.dev/test.my-package')
		expect(pkgJson.version).toBe('1.0.0')
		expect(pkgJson.description).toBe('Test package')
		expect(pkgJson.main).toBe('index.js')
		expect(pkgJson.license).toBe('ISC')
		expect(pkgJson.publishConfig.registry).toContain('lpm.dev/api/registry')
	})

	it('does not create package.json when user declines', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'lpm-init-'))
		vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)

		mockPrompts.group.mockResolvedValueOnce({ confirm: false })

		await init()

		expect(existsSync(join(tmpDir, 'package.json'))).toBe(false)
	})

	it('offers .npmrc setup after creating package.json', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'lpm-init-'))
		vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)

		mockPrompts.group.mockResolvedValueOnce({
			name: '@lpm.dev/test.pkg',
			version: '0.1.0',
			description: '',
			entry: 'index.js',
			license: 'MIT',
			confirm: true,
		})
		mockPrompts.confirm.mockResolvedValueOnce(false)

		await init()

		expect(mockPrompts.confirm).toHaveBeenCalled()
	})

	it('runs setup when user accepts .npmrc creation', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'lpm-init-'))
		vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)

		mockPrompts.group.mockResolvedValueOnce({
			name: '@lpm.dev/test.pkg',
			version: '0.1.0',
			description: '',
			entry: 'index.js',
			license: 'MIT',
			confirm: true,
		})
		mockPrompts.confirm.mockResolvedValueOnce(true)

		await init()

		expect(mockSetup).toHaveBeenCalledWith({ registry: 'https://lpm.dev' })
	})
})
