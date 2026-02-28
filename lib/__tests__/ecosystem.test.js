import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	collectPackageFiles,
	detectEcosystem,
	detectXCFramework,
	extractSwiftMetadata,
	mapSwiftDependencies,
} from '../ecosystem.js'

// ============================================================================
// detectEcosystem
// ============================================================================

describe('detectEcosystem', () => {
	let tmpDir

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.test-ecosystem-'))
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it('detects Swift from Package.swift', () => {
		fs.writeFileSync(path.join(tmpDir, 'Package.swift'), '// swift')
		const result = detectEcosystem(tmpDir)
		expect(result.ecosystem).toBe('swift')
		expect(result.manifestFile).toBe('Package.swift')
	})

	it('detects Rust from Cargo.toml', () => {
		fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]')
		const result = detectEcosystem(tmpDir)
		expect(result.ecosystem).toBe('rust')
		expect(result.manifestFile).toBe('Cargo.toml')
	})

	it('detects Python from pyproject.toml', () => {
		fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[project]')
		const result = detectEcosystem(tmpDir)
		expect(result.ecosystem).toBe('python')
		expect(result.manifestFile).toBe('pyproject.toml')
	})

	it('detects JS from package.json', () => {
		fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}')
		const result = detectEcosystem(tmpDir)
		expect(result.ecosystem).toBe('js')
		expect(result.manifestFile).toBe('package.json')
	})

	it('returns null ecosystem when no manifest found', () => {
		const result = detectEcosystem(tmpDir)
		expect(result.ecosystem).toBeNull()
		expect(result.manifestFile).toBeNull()
	})

	it('prioritizes Package.swift over package.json', () => {
		fs.writeFileSync(path.join(tmpDir, 'Package.swift'), '// swift')
		fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}')
		const result = detectEcosystem(tmpDir)
		expect(result.ecosystem).toBe('swift')
	})

	it('prioritizes Cargo.toml over pyproject.toml', () => {
		fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]')
		fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[project]')
		const result = detectEcosystem(tmpDir)
		expect(result.ecosystem).toBe('rust')
	})
})

// ============================================================================
// extractSwiftMetadata
// ============================================================================

describe('extractSwiftMetadata', () => {
	it('extracts toolsVersion', () => {
		const manifest = {
			toolsVersion: { _version: '5.10.0' },
		}
		const meta = extractSwiftMetadata(manifest)
		expect(meta.toolsVersion).toBe('5.10.0')
	})

	it('extracts platforms', () => {
		const manifest = {
			platforms: [
				{ platformName: 'ios', version: '16.0' },
				{ platformName: 'macos', version: '13.0' },
			],
		}
		const meta = extractSwiftMetadata(manifest)
		expect(meta.platforms).toEqual([
			{ name: 'ios', version: '16.0' },
			{ name: 'macos', version: '13.0' },
		])
	})

	it('extracts products', () => {
		const manifest = {
			products: [
				{
					name: 'MyLib',
					type: { library: {} },
					targets: ['MyLib'],
				},
			],
		}
		const meta = extractSwiftMetadata(manifest)
		expect(meta.products).toEqual([
			{ name: 'MyLib', type: 'library', targets: ['MyLib'] },
		])
	})

	it('extracts targets with dependencies', () => {
		const manifest = {
			targets: [
				{
					name: 'MyLib',
					type: 'regular',
					dependencies: [
						{ byName: ['Foundation'] },
						{ product: ['Alamofire'] },
					],
				},
				{
					name: 'MyLibTests',
					type: 'test',
					dependencies: [{ byName: ['MyLib'] }],
				},
			],
		}
		const meta = extractSwiftMetadata(manifest)
		expect(meta.targets).toHaveLength(2)
		expect(meta.targets[0].name).toBe('MyLib')
		expect(meta.targets[0].type).toBe('regular')
		expect(meta.targets[0].dependencies).toEqual([
			{ type: 'byName', name: 'Foundation' },
			{ type: 'product', name: 'Alamofire' },
		])
		expect(meta.targets[1].type).toBe('test')
	})

	it('extracts sourceControl dependencies', () => {
		const manifest = {
			dependencies: [
				{
					sourceControl: [
						{
							identity: 'alamofire',
							location: {
								remote: ['https://github.com/Alamofire/Alamofire.git'],
							},
							requirement: {
								range: [{ lowerBound: '5.0.0', upperBound: '6.0.0' }],
							},
						},
					],
				},
			],
		}
		const meta = extractSwiftMetadata(manifest)
		expect(meta.dependencies).toHaveLength(1)
		expect(meta.dependencies[0].type).toBe('sourceControl')
		expect(meta.dependencies[0].identity).toBe('alamofire')
		expect(meta.dependencies[0].location).toBe(
			'https://github.com/Alamofire/Alamofire.git',
		)
	})

	it('extracts fileSystem dependencies', () => {
		const manifest = {
			dependencies: [
				{
					fileSystem: [
						{
							identity: 'local-lib',
							path: '../local-lib',
						},
					],
				},
			],
		}
		const meta = extractSwiftMetadata(manifest)
		expect(meta.dependencies).toHaveLength(1)
		expect(meta.dependencies[0].type).toBe('fileSystem')
		expect(meta.dependencies[0].identity).toBe('local-lib')
	})

	it('handles empty manifest gracefully', () => {
		const meta = extractSwiftMetadata({})
		expect(meta.toolsVersion).toBeNull()
		expect(meta.platforms).toEqual([])
		expect(meta.products).toEqual([])
		expect(meta.targets).toEqual([])
		expect(meta.dependencies).toEqual([])
	})
})

// ============================================================================
// mapSwiftDependencies
// ============================================================================

describe('mapSwiftDependencies', () => {
	it('separates LPM and external dependencies', () => {
		const metadata = {
			dependencies: [
				{
					type: 'sourceControl',
					identity: 'my-lpm-dep',
					location: 'https://lpm.dev/packages/my-lpm-dep',
					requirement: { range: [{ lowerBound: '1.0.0' }] },
				},
				{
					type: 'sourceControl',
					identity: 'alamofire',
					location: 'https://github.com/Alamofire/Alamofire.git',
					requirement: { range: [{ lowerBound: '5.0.0' }] },
				},
			],
		}
		const result = mapSwiftDependencies(metadata)
		expect(result.lpm).toHaveLength(1)
		expect(result.lpm[0].name).toBe('my-lpm-dep')
		expect(result.external).toHaveLength(1)
		expect(result.external[0].name).toBe('alamofire')
	})

	it('skips fileSystem dependencies', () => {
		const metadata = {
			dependencies: [
				{
					type: 'fileSystem',
					identity: 'local-lib',
					path: '../local-lib',
				},
			],
		}
		const result = mapSwiftDependencies(metadata)
		expect(result.lpm).toHaveLength(0)
		expect(result.external).toHaveLength(0)
	})

	it('handles empty dependencies', () => {
		const result = mapSwiftDependencies({ dependencies: [] })
		expect(result.lpm).toEqual([])
		expect(result.external).toEqual([])
	})
})

// ============================================================================
// detectXCFramework
// ============================================================================

describe('detectXCFramework', () => {
	let tmpDir

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.test-xcf-'))
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it('detects .xcframework with Info.plist', () => {
		const xcfDir = path.join(tmpDir, 'MyLib.xcframework')
		fs.mkdirSync(xcfDir)
		fs.writeFileSync(path.join(xcfDir, 'Info.plist'), '<plist></plist>')
		const result = detectXCFramework(tmpDir)
		expect(result.found).toBe(true)
		expect(result.name).toBe('MyLib.xcframework')
		expect(result.hasInfoPlist).toBe(true)
	})

	it('detects .xcframework without Info.plist', () => {
		const xcfDir = path.join(tmpDir, 'MyLib.xcframework')
		fs.mkdirSync(xcfDir)
		const result = detectXCFramework(tmpDir)
		expect(result.found).toBe(true)
		expect(result.name).toBe('MyLib.xcframework')
		expect(result.hasInfoPlist).toBe(false)
	})

	it('returns not found when no .xcframework exists', () => {
		fs.writeFileSync(path.join(tmpDir, 'Package.swift'), '// swift')
		const result = detectXCFramework(tmpDir)
		expect(result.found).toBe(false)
		expect(result.name).toBeNull()
	})
})

// ============================================================================
// collectPackageFiles
// ============================================================================

describe('collectPackageFiles', () => {
	let tmpDir

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.test-collect-'))
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it('collects all files in a directory', () => {
		fs.writeFileSync(path.join(tmpDir, 'Package.swift'), '// swift')
		fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Hello')
		fs.mkdirSync(path.join(tmpDir, 'Sources'))
		fs.writeFileSync(path.join(tmpDir, 'Sources', 'MyLib.swift'), 'struct MyLib {}')

		const files = collectPackageFiles('swift', tmpDir)
		const paths = files.map(f => f.path)
		expect(paths).toContain('Package.swift')
		expect(paths).toContain('README.md')
		expect(paths).toContain(path.join('Sources', 'MyLib.swift'))
	})

	it('skips .build directory for Swift', () => {
		fs.writeFileSync(path.join(tmpDir, 'Package.swift'), '// swift')
		fs.mkdirSync(path.join(tmpDir, '.build'))
		fs.writeFileSync(path.join(tmpDir, '.build', 'debug.yaml'), 'build artifact')

		const files = collectPackageFiles('swift', tmpDir)
		const paths = files.map(f => f.path)
		expect(paths).not.toContain(path.join('.build', 'debug.yaml'))
	})

	it('skips DerivedData for Swift', () => {
		fs.mkdirSync(path.join(tmpDir, 'DerivedData'))
		fs.writeFileSync(path.join(tmpDir, 'DerivedData', 'cache'), 'cached')

		const files = collectPackageFiles('swift', tmpDir)
		const paths = files.map(f => f.path)
		expect(paths).not.toContain(path.join('DerivedData', 'cache'))
	})

	it('skips .git directory', () => {
		fs.writeFileSync(path.join(tmpDir, 'file.swift'), 'code')
		fs.mkdirSync(path.join(tmpDir, '.git'))
		fs.writeFileSync(path.join(tmpDir, '.git', 'HEAD'), 'ref')

		const files = collectPackageFiles('swift', tmpDir)
		const paths = files.map(f => f.path)
		expect(paths).toContain('file.swift')
		expect(paths).not.toContain(path.join('.git', 'HEAD'))
	})

	it('skips node_modules for all ecosystems', () => {
		fs.mkdirSync(path.join(tmpDir, 'node_modules'))
		fs.writeFileSync(path.join(tmpDir, 'node_modules', 'dep.js'), 'module')
		fs.writeFileSync(path.join(tmpDir, 'src.swift'), 'code')

		const files = collectPackageFiles('swift', tmpDir)
		const paths = files.map(f => f.path)
		expect(paths).not.toContain(path.join('node_modules', 'dep.js'))
	})

	it('skips .DS_Store files', () => {
		fs.writeFileSync(path.join(tmpDir, '.DS_Store'), 'mac metadata')
		fs.writeFileSync(path.join(tmpDir, 'code.swift'), 'struct A {}')

		const files = collectPackageFiles('swift', tmpDir)
		const paths = files.map(f => f.path)
		expect(paths).toContain('code.swift')
		expect(paths).not.toContain('.DS_Store')
	})

	it('respects .gitignore patterns', () => {
		fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'secret.key\n*.log\n')
		fs.writeFileSync(path.join(tmpDir, 'secret.key'), 'private')
		fs.writeFileSync(path.join(tmpDir, 'app.log'), 'logs')
		fs.writeFileSync(path.join(tmpDir, 'code.swift'), 'struct A {}')

		const files = collectPackageFiles('swift', tmpDir)
		const paths = files.map(f => f.path)
		expect(paths).toContain('code.swift')
		expect(paths).not.toContain('secret.key')
		expect(paths).not.toContain('app.log')
	})

	it('includes file sizes', () => {
		const content = 'struct MyLib {}'
		fs.writeFileSync(path.join(tmpDir, 'MyLib.swift'), content)

		const files = collectPackageFiles('swift', tmpDir)
		const file = files.find(f => f.path === 'MyLib.swift')
		expect(file).toBeDefined()
		expect(file.size).toBe(Buffer.byteLength(content))
	})

	it('skips Rust target/ directory', () => {
		fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]')
		fs.mkdirSync(path.join(tmpDir, 'target'))
		fs.writeFileSync(path.join(tmpDir, 'target', 'debug'), 'binary')

		const files = collectPackageFiles('rust', tmpDir)
		const paths = files.map(f => f.path)
		expect(paths).not.toContain(path.join('target', 'debug'))
	})

	it('skips Python __pycache__ directory', () => {
		fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[project]')
		fs.mkdirSync(path.join(tmpDir, '__pycache__'))
		fs.writeFileSync(path.join(tmpDir, '__pycache__', 'mod.pyc'), 'bytecode')

		const files = collectPackageFiles('python', tmpDir)
		const paths = files.map(f => f.path)
		expect(paths).not.toContain(path.join('__pycache__', 'mod.pyc'))
	})
})
