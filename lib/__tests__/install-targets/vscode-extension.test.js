import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// Mocks
// ============================================================================

const { mockConfirm, mockIsCancel } = vi.hoisted(() => ({
	mockConfirm: vi.fn(),
	mockIsCancel: vi.fn().mockReturnValue(false),
}))

vi.mock('@clack/prompts', () => ({
	confirm: mockConfirm,
	isCancel: mockIsCancel,
	cancel: vi.fn(),
}))
vi.mock('chalk', () => {
	const p = (str) => str
	p.dim = p
	p.red = p
	return { default: p }
})

// Mock os.homedir to use temp directory
let tmpDir
let homeDir

vi.mock('node:os', async () => {
	const actual = await vi.importActual('node:os')
	return {
		...actual,
		default: {
			...actual,
			homedir: () => homeDir,
		},
		homedir: () => homeDir,
	}
})

import { installVscodeExtension, removeVscodeExtension } from '../../install-targets/vscode-extension.js'

// ============================================================================
// Helpers
// ============================================================================

function createTmpDir() {
	tmpDir = mkdtempSync(join(tmpdir(), 'lpm-vscode-'))
	homeDir = tmpDir
	return tmpDir
}

function createVscodeDir() {
	const vscodeDir = join(tmpDir, '.vscode', 'extensions')
	mkdirSync(vscodeDir, { recursive: true })
	return vscodeDir
}

function createExtractDir() {
	const extractDir = join(tmpDir, 'extracted')
	mkdirSync(extractDir, { recursive: true })
	writeFileSync(
		join(extractDir, 'package.json'),
		JSON.stringify({ name: 'test', version: '1.0.0' }),
	)
	writeFileSync(join(extractDir, 'extension.js'), 'module.exports = {}')
	return extractDir
}

// ============================================================================
// Tests
// ============================================================================

describe('vscode-extension install target', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		createTmpDir()
	})

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	describe('installVscodeExtension', () => {
		it('returns failure when VS Code not detected', async () => {
			// No .vscode directory
			const result = await installVscodeExtension({
				name: '@lpm.dev/test.my-ext',
				version: '1.0.0',
				lpmConfig: { type: 'vscode-extension' },
				extractDir: '/tmp/fake',
				options: { yes: true },
			})

			expect(result.success).toBe(false)
			expect(result.message).toContain('VS Code not detected')
		})

		it('installs extension to correct directory', async () => {
			createVscodeDir()
			const extractDir = createExtractDir()

			const result = await installVscodeExtension({
				name: '@lpm.dev/test.my-ext',
				version: '1.0.0',
				lpmConfig: { type: 'vscode-extension' },
				extractDir,
				options: { yes: true },
			})

			expect(result.success).toBe(true)
			expect(result.message).toContain('installed')

			// Check files were copied
			const extDir = join(tmpDir, '.vscode', 'extensions', 'test.my-ext-1.0.0')
			expect(existsSync(extDir)).toBe(true)
			expect(existsSync(join(extDir, 'package.json'))).toBe(true)
			expect(existsSync(join(extDir, 'extension.js'))).toBe(true)
		})

		it('derives correct folder name from package name', async () => {
			createVscodeDir()
			const extractDir = createExtractDir()

			await installVscodeExtension({
				name: '@lpm.dev/acme.monokai-pro',
				version: '2.5.0',
				lpmConfig: { type: 'vscode-extension' },
				extractDir,
				options: { yes: true },
			})

			// @lpm.dev/acme.monokai-pro → acme.monokai-pro-2.5.0
			const extDir = join(tmpDir, '.vscode', 'extensions', 'acme.monokai-pro-2.5.0')
			expect(existsSync(extDir)).toBe(true)
		})

		it('overwrites existing extension with --force', async () => {
			createVscodeDir()
			const extractDir = createExtractDir()

			// Create existing extension
			const extDir = join(tmpDir, '.vscode', 'extensions', 'test.my-ext-1.0.0')
			mkdirSync(extDir, { recursive: true })
			writeFileSync(join(extDir, 'old-file.txt'), 'old')

			const result = await installVscodeExtension({
				name: '@lpm.dev/test.my-ext',
				version: '1.0.0',
				lpmConfig: { type: 'vscode-extension' },
				extractDir,
				options: { force: true },
			})

			expect(result.success).toBe(true)
			// Old file should be gone, new files present
			expect(existsSync(join(extDir, 'old-file.txt'))).toBe(false)
			expect(existsSync(join(extDir, 'package.json'))).toBe(true)
		})

		it('prompts before overwriting existing extension', async () => {
			createVscodeDir()
			const extractDir = createExtractDir()

			// Create existing extension
			const extDir = join(tmpDir, '.vscode', 'extensions', 'test.my-ext-1.0.0')
			mkdirSync(extDir, { recursive: true })
			writeFileSync(join(extDir, 'old-file.txt'), 'old')

			mockConfirm.mockResolvedValueOnce(false)

			const result = await installVscodeExtension({
				name: '@lpm.dev/test.my-ext',
				version: '1.0.0',
				lpmConfig: { type: 'vscode-extension' },
				extractDir,
				options: {},
			})

			expect(result.success).toBe(false)
			expect(result.message).toContain('cancelled')
			expect(mockConfirm).toHaveBeenCalled()
		})

		it('copies nested directory structure', async () => {
			createVscodeDir()
			const extractDir = createExtractDir()

			// Add a nested directory
			mkdirSync(join(extractDir, 'dist'), { recursive: true })
			writeFileSync(join(extractDir, 'dist', 'main.js'), 'code')

			const result = await installVscodeExtension({
				name: '@lpm.dev/test.my-ext',
				version: '1.0.0',
				lpmConfig: { type: 'vscode-extension' },
				extractDir,
				options: { yes: true },
			})

			expect(result.success).toBe(true)
			const extDir = join(tmpDir, '.vscode', 'extensions', 'test.my-ext-1.0.0')
			expect(existsSync(join(extDir, 'dist', 'main.js'))).toBe(true)
		})
	})

	describe('removeVscodeExtension', () => {
		it('returns message when extensions directory does not exist', async () => {
			const result = await removeVscodeExtension({
				name: '@lpm.dev/test.my-ext',
			})

			expect(result.success).toBe(true)
			expect(result.message).toContain('No VS Code extensions directory')
		})

		it('returns message when extension not found', async () => {
			createVscodeDir()

			const result = await removeVscodeExtension({
				name: '@lpm.dev/test.my-ext',
			})

			expect(result.success).toBe(true)
			expect(result.message).toContain('not installed')
		})

		it('removes matching extension folders', async () => {
			const extDir = createVscodeDir()

			// Create two versions
			mkdirSync(join(extDir, 'test.my-ext-1.0.0'))
			mkdirSync(join(extDir, 'test.my-ext-2.0.0'))
			mkdirSync(join(extDir, 'other.ext-1.0.0'))

			const result = await removeVscodeExtension({
				name: '@lpm.dev/test.my-ext',
			})

			expect(result.success).toBe(true)
			expect(result.message).toContain('2 extension versions')
			expect(existsSync(join(extDir, 'test.my-ext-1.0.0'))).toBe(false)
			expect(existsSync(join(extDir, 'test.my-ext-2.0.0'))).toBe(false)
			expect(existsSync(join(extDir, 'other.ext-1.0.0'))).toBe(true)
		})

		it('returns singular form for single version', async () => {
			const extDir = createVscodeDir()
			mkdirSync(join(extDir, 'test.my-ext-1.0.0'))

			const result = await removeVscodeExtension({
				name: '@lpm.dev/test.my-ext',
			})

			expect(result.message).toMatch(/1 extension version[^s]/)
		})
	})
})
