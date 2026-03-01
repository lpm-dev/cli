import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { mockGetToken, mockGetRegistryUrl, mockFetch, mockSpinner, mockParseLpmPackageReference,
	mockReadLpmConfig, mockDetectFramework, mockGetDefaultPath, mockValidateComponentPath,
	mockValidateTarballPaths, mockGetProjectAliases, mockGetUserImportPrefix,
	mockResolveAliasForDirectory, mockIsSwiftProject, mockGetSpmTargets,
	mockExpandSrcGlob, mockFilterFiles, mockResolveConditionalDependencies,
	mockClackSelect, mockClackText, mockClackConfirm, mockClackIsCancel,
	mockExecAsync,
} = vi.hoisted(() => {
	const spinner = {
		start: vi.fn(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		text: '',
	}
	spinner.start.mockReturnValue(spinner)
	return {
		mockGetToken: vi.fn().mockResolvedValue('test-token'),
		mockGetRegistryUrl: vi.fn().mockReturnValue('https://lpm.dev'),
		mockFetch: vi.fn(),
		mockSpinner: spinner,
		mockParseLpmPackageReference: vi.fn().mockReturnValue({
			name: '@lpm.dev/test.button',
			version: 'latest',
			inlineConfig: {},
			providedParams: new Set(),
		}),
		mockReadLpmConfig: vi.fn().mockReturnValue(null),
		mockDetectFramework: vi.fn().mockReturnValue('nextjs'),
		mockGetDefaultPath: vi.fn().mockReturnValue('./components'),
		mockValidateComponentPath: vi.fn().mockReturnValue({ valid: true, resolvedPath: '/tmp/test' }),
		mockValidateTarballPaths: vi.fn().mockReturnValue({ valid: true }),
		mockGetProjectAliases: vi.fn().mockReturnValue({}),
		mockGetUserImportPrefix: vi.fn().mockReturnValue('@'),
		mockResolveAliasForDirectory: vi.fn().mockReturnValue(null),
		mockIsSwiftProject: vi.fn().mockReturnValue(false),
		mockGetSpmTargets: vi.fn().mockResolvedValue([]),
		mockExpandSrcGlob: vi.fn().mockReturnValue([]),
		mockFilterFiles: vi.fn().mockReturnValue([]),
		mockResolveConditionalDependencies: vi.fn().mockReturnValue({ npm: [], lpm: [] }),
		mockClackSelect: vi.fn(),
		mockClackText: vi.fn(),
		mockClackConfirm: vi.fn(),
		mockClackIsCancel: vi.fn().mockReturnValue(false),
		mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
	}
})

vi.mock('../../config.js', () => ({
	getToken: mockGetToken,
	getRegistryUrl: mockGetRegistryUrl,
}))
vi.stubGlobal('fetch', mockFetch)
vi.mock('chalk', () => {
	const p = str => str
	p.cyan = p; p.green = p; p.dim = p; p.bold = p; p.blue = p; p.yellow = p; p.red = p; p.grey = p
	return { default: p }
})
vi.mock('ora', () => ({ default: () => mockSpinner }))
vi.mock('tar', () => ({ t: vi.fn(), x: vi.fn() }))
vi.mock('diff', () => ({ diffLines: vi.fn() }))
vi.mock('../../integrity.js', () => ({
	verifyIntegrity: vi.fn().mockReturnValue({ valid: true }),
}))
vi.mock('../../lpm-config.js', () => ({
	parseLpmPackageReference: mockParseLpmPackageReference,
	readLpmConfig: mockReadLpmConfig,
	filterFiles: mockFilterFiles,
	expandSrcGlob: mockExpandSrcGlob,
	resolveConditionalDependencies: mockResolveConditionalDependencies,
}))
vi.mock('../../lpm-config-prompts.js', () => ({
	promptForMissingConfig: vi.fn().mockResolvedValue({}),
}))
vi.mock('../../project-utils.js', () => ({
	detectFramework: mockDetectFramework,
	getDefaultPath: mockGetDefaultPath,
	getProjectAliases: mockGetProjectAliases,
	getUserImportPrefix: mockGetUserImportPrefix,
	isSwiftProject: mockIsSwiftProject,
	resolveAliasForDirectory: mockResolveAliasForDirectory,
}))
vi.mock('../../safe-path.js', () => ({
	validateComponentPath: mockValidateComponentPath,
	validateTarballPaths: mockValidateTarballPaths,
}))
vi.mock('../../install-targets.js', () => ({
	hasCustomHandler: vi.fn().mockReturnValue(false),
	getHandler: vi.fn(),
	getDefaultTarget: vi.fn().mockReturnValue(null),
}))
vi.mock('../../swift-project.js', () => ({
	ensureXcodeLocalPackage: vi.fn().mockReturnValue({ created: false, installPath: '/tmp/swift' }),
	getSpmTargets: mockGetSpmTargets,
	printSwiftDependencyInstructions: vi.fn(),
	printXcodeSetupInstructions: vi.fn(),
}))
vi.mock('../../import-rewriter.js', () => ({
	rewriteImports: vi.fn().mockImplementation(content => content),
}))
vi.mock('@clack/prompts', () => ({
	text: mockClackText,
	select: mockClackSelect,
	confirm: mockClackConfirm,
	isCancel: mockClackIsCancel,
	cancel: vi.fn(),
}))
vi.mock('node:child_process', () => ({
	exec: vi.fn((cmd, cb) => cb(null, { stdout: '', stderr: '' })),
}))

import { add } from '../../commands/add.js'

/**
 * Helper: mock successful metadata + tarball download flow
 */
function setupSuccessfulDownload(opts = {}) {
	const tarballBuffer = Buffer.from('fake-tarball')
	const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-test-'))

	// Create a fake source file in the extract dir so legacy flow has something to copy
	if (opts.createSourceFile !== false) {
		fs.writeFileSync(path.join(extractDir, 'index.js'), 'export default {}')
	}

	// Metadata response
	mockFetch.mockResolvedValueOnce({
		ok: true,
		json: () => Promise.resolve({
			name: '@lpm.dev/test.button',
			'dist-tags': { latest: '1.0.0' },
			versions: {
				'1.0.0': {
					version: '1.0.0',
					dist: { tarball: 'https://example.com/t.tgz' },
					dependencies: opts.dependencies || {},
					peerDependencies: opts.peerDependencies || {},
				},
			},
		}),
	})

	// Tarball download response
	mockFetch.mockResolvedValueOnce({
		ok: true,
		arrayBuffer: () => Promise.resolve(tarballBuffer.buffer),
	})

	// Mock fs operations for temp dir
	const origMkdtempSync = fs.mkdtempSync
	const origWriteFileSync = fs.writeFileSync
	const origRmSync = fs.rmSync

	return { extractDir }
}

describe('add command - --yes mode', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		mockGetToken.mockReset().mockResolvedValue('test-token')
		mockFetch.mockReset()
		mockParseLpmPackageReference.mockReturnValue({
			name: '@lpm.dev/test.button',
			version: 'latest',
			inlineConfig: {},
			providedParams: new Set(),
		})
		mockSpinner.start.mockClear().mockReturnValue(mockSpinner)
		mockSpinner.stop.mockClear()
		mockSpinner.succeed.mockClear()
		mockSpinner.fail.mockClear()
		mockClackSelect.mockReset()
		mockClackText.mockReset()
		mockClackConfirm.mockReset()
		mockDetectFramework.mockReturnValue('nextjs')
		mockGetDefaultPath.mockReturnValue('./components')
		mockIsSwiftProject.mockReturnValue(false)
		mockReadLpmConfig.mockReturnValue(null)
		mockGetSpmTargets.mockResolvedValue([])
		mockValidateComponentPath.mockReturnValue({ valid: true, resolvedPath: '/tmp/test-target' })
	})

	afterEach(() => { vi.restoreAllMocks() })

	it('--yes uses framework-detected default path without prompting (JS)', async () => {
		setupSuccessfulDownload()
		mockGetDefaultPath.mockReturnValue('./components')

		await add('@lpm.dev/test.button', { yes: true })

		// Should not have called clack text for path prompt
		expect(mockClackText).not.toHaveBeenCalled()
		// Should have validated with default path
		expect(mockValidateComponentPath).toHaveBeenCalledWith(
			expect.any(String),
			'./components',
		)
	})

	it('--yes with --path overrides default path', async () => {
		setupSuccessfulDownload()

		await add('@lpm.dev/test.button', { yes: true, path: './my-custom-path' })

		expect(mockClackText).not.toHaveBeenCalled()
		expect(mockValidateComponentPath).toHaveBeenCalledWith(
			expect.any(String),
			'./my-custom-path',
		)
	})

	it('--yes uses auto-detected import alias', async () => {
		setupSuccessfulDownload()
		mockResolveAliasForDirectory.mockReturnValue('@/components')

		await add('@lpm.dev/test.button', { yes: true })

		// Should not prompt for alias
		expect(mockClackText).not.toHaveBeenCalled()
	})

	it('--yes with --alias overrides auto-detected alias', async () => {
		setupSuccessfulDownload()
		mockResolveAliasForDirectory.mockReturnValue('@/components')

		await add('@lpm.dev/test.button', { yes: true, alias: '~/ui' })

		// Should not prompt for alias
		expect(mockClackText).not.toHaveBeenCalled()
	})

	it('--yes defaults source selection to copy everything (legacy flow)', async () => {
		setupSuccessfulDownload()

		await add('@lpm.dev/test.button', { yes: true })

		// Should not call select for source choice
		expect(mockClackSelect).not.toHaveBeenCalled()
	})

	it('--yes skips conflicting files without overwriting', async () => {
		setupSuccessfulDownload()

		await add('@lpm.dev/test.button', { yes: true })

		// Should not prompt for conflict resolution
		expect(mockClackSelect).not.toHaveBeenCalled()
	})

	it('--yes + --force overwrites conflicting files', async () => {
		setupSuccessfulDownload()

		await add('@lpm.dev/test.button', { yes: true, force: true })

		// Should not prompt for conflict resolution
		expect(mockClackSelect).not.toHaveBeenCalled()
	})
})

describe('add command - --yes with SPM targets', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		mockGetToken.mockReset().mockResolvedValue('test-token')
		mockFetch.mockReset()
		mockParseLpmPackageReference.mockReturnValue({
			name: '@lpm.dev/test.button',
			version: 'latest',
			inlineConfig: {},
			providedParams: new Set(),
		})
		mockSpinner.start.mockClear().mockReturnValue(mockSpinner)
		mockSpinner.stop.mockClear()
		mockSpinner.succeed.mockClear()
		mockSpinner.fail.mockClear()
		mockClackSelect.mockReset()
		mockClackText.mockReset()
		mockClackConfirm.mockReset()
		mockReadLpmConfig.mockReturnValue(null)
		mockValidateComponentPath.mockReturnValue({ valid: true, resolvedPath: '/tmp/swift-target' })
	})

	afterEach(() => { vi.restoreAllMocks() })

	it('--yes auto-selects first SPM target when multiple exist', async () => {
		setupSuccessfulDownload()
		mockDetectFramework.mockReturnValue('swift-spm')
		mockIsSwiftProject.mockReturnValue(true)
		mockGetSpmTargets.mockResolvedValue(['MyApp', 'MyFramework'])
		mockGetDefaultPath.mockReturnValue('Sources/MyApp')

		await add('@lpm.dev/test.button', { yes: true })

		// Should auto-select first target, not prompt
		expect(mockClackSelect).not.toHaveBeenCalled()
		expect(mockGetDefaultPath).toHaveBeenCalledWith('swift-spm', 'MyApp')
	})

	it('--target selects the specified SPM target', async () => {
		setupSuccessfulDownload()
		mockDetectFramework.mockReturnValue('swift-spm')
		mockIsSwiftProject.mockReturnValue(true)
		mockGetSpmTargets.mockResolvedValue(['MyApp', 'MyFramework'])
		mockGetDefaultPath.mockReturnValue('Sources/MyFramework')

		await add('@lpm.dev/test.button', { yes: true, target: 'MyFramework' })

		expect(mockClackSelect).not.toHaveBeenCalled()
		expect(mockGetDefaultPath).toHaveBeenCalledWith('swift-spm', 'MyFramework')
	})

	it('--target errors when target not found', async () => {
		setupSuccessfulDownload()
		mockDetectFramework.mockReturnValue('swift-spm')
		mockIsSwiftProject.mockReturnValue(true)
		mockGetSpmTargets.mockResolvedValue(['MyApp', 'MyFramework'])

		await add('@lpm.dev/test.button', { yes: true, target: 'NonExistent' })

		expect(mockSpinner.fail).toHaveBeenCalledWith(
			expect.stringContaining('NonExistent'),
		)
	})
})

describe('add command - --yes with dependencies', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		mockGetToken.mockReset().mockResolvedValue('test-token')
		mockFetch.mockReset()
		mockParseLpmPackageReference.mockReturnValue({
			name: '@lpm.dev/test.button',
			version: 'latest',
			inlineConfig: {},
			providedParams: new Set(),
		})
		mockSpinner.start.mockClear().mockReturnValue(mockSpinner)
		mockSpinner.stop.mockClear()
		mockSpinner.succeed.mockClear()
		mockSpinner.fail.mockClear()
		mockClackSelect.mockReset()
		mockClackText.mockReset()
		mockClackConfirm.mockReset()
		mockDetectFramework.mockReturnValue('nextjs')
		mockGetDefaultPath.mockReturnValue('./components')
		mockIsSwiftProject.mockReturnValue(false)
		mockReadLpmConfig.mockReturnValue(null)
		mockValidateComponentPath.mockReturnValue({ valid: true, resolvedPath: '/tmp/test-target' })
	})

	afterEach(() => { vi.restoreAllMocks() })

	it('--yes auto-installs npm dependencies by default', async () => {
		setupSuccessfulDownload({ dependencies: { react: '^18.0.0' } })

		await add('@lpm.dev/test.button', { yes: true })

		// Should not prompt for dependency install
		expect(mockClackConfirm).not.toHaveBeenCalled()
	})

	it('--no-install-deps skips npm dependency installation', async () => {
		setupSuccessfulDownload({ dependencies: { react: '^18.0.0' } })

		await add('@lpm.dev/test.button', { yes: true, installDeps: false })

		// Should not prompt for dependency install
		expect(mockClackConfirm).not.toHaveBeenCalled()
	})
})

describe('add command - --json output', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		mockGetToken.mockReset().mockResolvedValue('test-token')
		mockFetch.mockReset()
		mockParseLpmPackageReference.mockReturnValue({
			name: '@lpm.dev/test.button',
			version: 'latest',
			inlineConfig: {},
			providedParams: new Set(),
		})
		mockSpinner.start.mockClear().mockReturnValue(mockSpinner)
		mockSpinner.stop.mockClear()
		mockSpinner.succeed.mockClear()
		mockSpinner.fail.mockClear()
		mockClackSelect.mockReset()
		mockClackText.mockReset()
		mockClackConfirm.mockReset()
		mockDetectFramework.mockReturnValue('nextjs')
		mockGetDefaultPath.mockReturnValue('./components')
		mockIsSwiftProject.mockReturnValue(false)
		mockReadLpmConfig.mockReturnValue(null)
		mockValidateComponentPath.mockReturnValue({ valid: true, resolvedPath: '/tmp/test-target' })
	})

	afterEach(() => { vi.restoreAllMocks() })

	it('--json implies --yes (no interactive prompts)', async () => {
		setupSuccessfulDownload()

		await add('@lpm.dev/test.button', { json: true })

		// Should not call any interactive prompts
		expect(mockClackText).not.toHaveBeenCalled()
		expect(mockClackSelect).not.toHaveBeenCalled()
		expect(mockClackConfirm).not.toHaveBeenCalled()
	})

	it('--json writes structured JSON to stdout on success', async () => {
		setupSuccessfulDownload()

		await add('@lpm.dev/test.button', { json: true })

		const writeCall = process.stdout.write.mock.calls.find(call =>
			typeof call[0] === 'string' && call[0].includes('"success"'),
		)
		expect(writeCall).toBeDefined()
		const output = JSON.parse(writeCall[0])
		expect(output.success).toBe(true)
		expect(output.package).toBeDefined()
		expect(output.package.name).toContain('test.button')
	})

	it('--json writes structured JSON to stdout on error', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 404,
			statusText: 'Not Found',
		})

		await add('@lpm.dev/test.button', { json: true })

		const writeCall = process.stdout.write.mock.calls.find(call =>
			typeof call[0] === 'string' && call[0].includes('"success"'),
		)
		expect(writeCall).toBeDefined()
		const output = JSON.parse(writeCall[0])
		expect(output.success).toBe(false)
		expect(output.errors.length).toBeGreaterThan(0)
	})

	it('--json output includes required fields', async () => {
		setupSuccessfulDownload()

		await add('@lpm.dev/test.button', { json: true })

		const writeCall = process.stdout.write.mock.calls.find(call =>
			typeof call[0] === 'string' && call[0].includes('"success"'),
		)
		const output = JSON.parse(writeCall[0])
		expect(output).toHaveProperty('success')
		expect(output).toHaveProperty('package')
		expect(output).toHaveProperty('files')
		expect(output).toHaveProperty('dependencies')
		expect(output).toHaveProperty('installPath')
		expect(output).toHaveProperty('alias')
	})

	it('--json suppresses spinner output', async () => {
		setupSuccessfulDownload()

		await add('@lpm.dev/test.button', { json: true })

		// spinner.succeed should not be called in JSON mode (we return before it)
		// The success path writes JSON instead
		const writeCall = process.stdout.write.mock.calls.find(call =>
			typeof call[0] === 'string' && call[0].includes('"success": true'),
		)
		expect(writeCall).toBeDefined()
	})
})

describe('add command - --dry-run', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		mockGetToken.mockReset().mockResolvedValue('test-token')
		mockFetch.mockReset()
		mockParseLpmPackageReference.mockReturnValue({
			name: '@lpm.dev/test.button',
			version: 'latest',
			inlineConfig: {},
			providedParams: new Set(),
		})
		mockSpinner.start.mockClear().mockReturnValue(mockSpinner)
		mockSpinner.stop.mockClear()
		mockSpinner.succeed.mockClear()
		mockSpinner.fail.mockClear()
		mockClackSelect.mockReset()
		mockClackText.mockReset()
		mockClackConfirm.mockReset()
		mockDetectFramework.mockReturnValue('nextjs')
		mockGetDefaultPath.mockReturnValue('./components')
		mockIsSwiftProject.mockReturnValue(false)
		mockReadLpmConfig.mockReturnValue(null)
		mockValidateComponentPath.mockReturnValue({ valid: true, resolvedPath: '/tmp/test-target' })
	})

	afterEach(() => { vi.restoreAllMocks() })

	it('--dry-run does not install npm dependencies', async () => {
		setupSuccessfulDownload({ dependencies: { react: '^18.0.0' } })

		await add('@lpm.dev/test.button', { yes: true, dryRun: true })

		// Should not prompt or install
		expect(mockClackConfirm).not.toHaveBeenCalled()
	})

	it('--dry-run + --json returns machine-readable output with dryRun field', async () => {
		setupSuccessfulDownload()

		await add('@lpm.dev/test.button', { json: true, dryRun: true })

		const writeCall = process.stdout.write.mock.calls.find(call =>
			typeof call[0] === 'string' && call[0].includes('"dryRun"'),
		)
		expect(writeCall).toBeDefined()
		const output = JSON.parse(writeCall[0])
		expect(output.dryRun).toBe(true)
		expect(output.success).toBe(true)
	})

	it('--dry-run returns correct target directory', async () => {
		setupSuccessfulDownload()
		mockValidateComponentPath.mockReturnValue({ valid: true, resolvedPath: '/my/project/components' })

		await add('@lpm.dev/test.button', { json: true, dryRun: true })

		const writeCall = process.stdout.write.mock.calls.find(call =>
			typeof call[0] === 'string' && call[0].includes('"installPath"'),
		)
		const output = JSON.parse(writeCall[0])
		expect(output.installPath).toBe('/my/project/components')
	})
})

describe('add command - new flags parsing', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		mockGetToken.mockReset().mockResolvedValue('test-token')
		mockFetch.mockReset()
		mockParseLpmPackageReference.mockReturnValue({
			name: '@lpm.dev/test.button',
			version: 'latest',
			inlineConfig: {},
			providedParams: new Set(),
		})
		mockSpinner.start.mockClear().mockReturnValue(mockSpinner)
		mockSpinner.stop.mockClear()
		mockSpinner.succeed.mockClear()
		mockSpinner.fail.mockClear()
		mockClackSelect.mockReset()
		mockClackText.mockReset()
		mockClackConfirm.mockReset()
		mockDetectFramework.mockReturnValue('nextjs')
		mockGetDefaultPath.mockReturnValue('./components')
		mockIsSwiftProject.mockReturnValue(false)
		mockReadLpmConfig.mockReturnValue(null)
		mockValidateComponentPath.mockReturnValue({ valid: true, resolvedPath: '/tmp/test-target' })
	})

	afterEach(() => { vi.restoreAllMocks() })

	it('--alias flag is accepted and used', async () => {
		setupSuccessfulDownload()

		await add('@lpm.dev/test.button', { yes: true, alias: '@/ui' })

		// Should not prompt for alias since flag was provided
		expect(mockClackText).not.toHaveBeenCalled()
	})

	it('--target flag is accepted and used', async () => {
		setupSuccessfulDownload()
		mockDetectFramework.mockReturnValue('swift-spm')
		mockIsSwiftProject.mockReturnValue(true)
		mockGetSpmTargets.mockResolvedValue(['MyApp'])
		mockGetDefaultPath.mockReturnValue('Sources/MyApp')

		await add('@lpm.dev/test.button', { yes: true, target: 'MyApp' })

		expect(mockClackSelect).not.toHaveBeenCalled()
	})

	it('--install-deps flag is accepted (boolean true)', async () => {
		setupSuccessfulDownload({ dependencies: { react: '^18.0.0' } })

		await add('@lpm.dev/test.button', { yes: true, installDeps: true })

		expect(mockClackConfirm).not.toHaveBeenCalled()
	})

	it('--no-install-deps flag is accepted (boolean false)', async () => {
		setupSuccessfulDownload({ dependencies: { react: '^18.0.0' } })

		await add('@lpm.dev/test.button', { yes: true, installDeps: false })

		expect(mockClackConfirm).not.toHaveBeenCalled()
	})
})
