import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { mockExecAsync, mockExec, mockRequest, mockVerifyTokenScope, mockGetRegistryUrl, mockRunQualityChecks, mockDisplayQualityReport } = vi.hoisted(() => {
	const mockExecAsync = vi.fn()
	const mockExec = vi.fn()
	mockExec[Symbol.for('nodejs.util.promisify.custom')] = mockExecAsync
	return {
		mockExecAsync,
		mockExec,
		mockRequest: vi.fn(),
		mockVerifyTokenScope: vi.fn(),
		mockGetRegistryUrl: vi.fn().mockReturnValue('https://lpm.dev'),
		mockRunQualityChecks: vi.fn().mockReturnValue({
			score: 72,
			checks: [],
			meta: { tier: 'good', score: 72, maxScore: 100, categories: {} },
		}),
		mockDisplayQualityReport: vi.fn(),
	}
})

vi.mock('node:child_process', () => ({ exec: mockExec }))
vi.mock('../../api.js', () => ({ request: mockRequest, verifyTokenScope: mockVerifyTokenScope }))
vi.mock('../../config.js', () => ({ getRegistryUrl: mockGetRegistryUrl }))
vi.mock('../../quality/score.js', () => ({ runQualityChecks: mockRunQualityChecks }))
vi.mock('../../quality/display.js', () => ({ displayQualityReport: mockDisplayQualityReport }))
vi.mock('../../ui.js', () => ({
	createSpinner: () => ({
		start: vi.fn().mockReturnThis(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		text: '',
	}),
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), success: vi.fn() },
	printHeader: vi.fn(),
}))
vi.mock('@clack/prompts', () => ({
	confirm: vi.fn().mockResolvedValue(true),
	isCancel: vi.fn().mockReturnValue(false),
	cancel: vi.fn(),
}))

import { publish } from '../../commands/publish.js'

let tmpDir

describe('publish command', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
		mockRequest.mockReset()
		mockVerifyTokenScope.mockReset()
		mockExecAsync.mockReset()
		mockRunQualityChecks.mockReturnValue({
			score: 72,
			checks: [],
			meta: { tier: 'good', score: 72, maxScore: 100, categories: {} },
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) { rmSync(tmpDir, { recursive: true, force: true }); tmpDir = null }
	})

	it('exits when no package.json found', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'lpm-publish-'))
		vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
		await expect(publish({ check: true })).rejects.toThrow('process.exit')
	})

	it('exits with invalid package name', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'lpm-publish-'))
		writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
			name: 'invalid-name',
			version: '1.0.0',
		}))
		vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
		await expect(publish({ check: true })).rejects.toThrow('process.exit')
	})

	it('runs quality checks in --check mode', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'lpm-publish-'))
		writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
			name: '@lpm.dev/test.my-package',
			version: '1.0.0',
		}))
		vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)

		mockExecAsync.mockResolvedValue({
			stdout: JSON.stringify([{
				filename: 'lpm.dev-test.my-package-1.0.0.tgz',
				files: [{ path: 'index.js' }],
				unpackedSize: 1000,
			}]),
		})

		await expect(publish({ check: true })).rejects.toThrow('process.exit')
		expect(mockRunQualityChecks).toHaveBeenCalled()
		expect(mockDisplayQualityReport).toHaveBeenCalled()
	})

	it('blocks publish when quality score below --min-score', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'lpm-publish-'))
		writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
			name: '@lpm.dev/test.my-package',
			version: '1.0.0',
		}))
		vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)

		mockRunQualityChecks.mockReturnValueOnce({
			score: 40,
			checks: [],
			meta: { tier: 'fair', score: 40, maxScore: 100, categories: {} },
		})

		mockExecAsync.mockResolvedValue({
			stdout: JSON.stringify([{
				filename: 'lpm.dev-test.my-package-1.0.0.tgz',
				files: [],
				unpackedSize: 1000,
			}]),
		})

		await expect(publish({ check: true, minScore: '80' })).rejects.toThrow('process.exit')
	})

	it('accepts legacy @scope/name format in --check mode', async () => {
		tmpDir = mkdtempSync(join(tmpdir(), 'lpm-publish-'))
		writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
			name: '@test/my-package',
			version: '1.0.0',
		}))
		vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)

		mockExecAsync.mockResolvedValue({
			stdout: JSON.stringify([{
				filename: 'test-my-package-1.0.0.tgz',
				files: [],
				unpackedSize: 1000,
			}]),
		})

		await expect(publish({ check: true })).rejects.toThrow('process.exit')
		expect(mockDisplayQualityReport).toHaveBeenCalled()
	})
})
