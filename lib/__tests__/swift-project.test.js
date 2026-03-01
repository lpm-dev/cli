import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureXcodeLocalPackage } from '../swift-project.js'
import {
	detectFramework,
	getDefaultPath,
	isSwiftProject,
} from '../project-utils.js'

// ============================================================================
// detectFramework — Swift project detection
// ============================================================================

describe('detectFramework — Swift projects', () => {
	let tmpDir
	let originalCwd

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.test-swift-detect-'))
		originalCwd = process.cwd()
		process.chdir(tmpDir)
	})

	afterEach(() => {
		process.chdir(originalCwd)
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it('detects swift-spm from Package.swift', () => {
		fs.writeFileSync(path.join(tmpDir, 'Package.swift'), '// swift')
		expect(detectFramework()).toBe('swift-spm')
	})

	it('detects swift-xcode from .xcodeproj', () => {
		fs.mkdirSync(path.join(tmpDir, 'MyApp.xcodeproj'))
		expect(detectFramework()).toBe('swift-xcode')
	})

	it('detects swift-xcode from .xcworkspace', () => {
		fs.mkdirSync(path.join(tmpDir, 'MyApp.xcworkspace'))
		expect(detectFramework()).toBe('swift-xcode')
	})

	it('prioritizes Package.swift over .xcodeproj', () => {
		fs.writeFileSync(path.join(tmpDir, 'Package.swift'), '// swift')
		fs.mkdirSync(path.join(tmpDir, 'MyApp.xcodeproj'))
		expect(detectFramework()).toBe('swift-spm')
	})

	it('returns unknown for empty directory', () => {
		expect(detectFramework()).toBe('unknown')
	})

	it('returns JS framework when package.json has next', () => {
		fs.writeFileSync(
			path.join(tmpDir, 'package.json'),
			JSON.stringify({ dependencies: { next: '^14' } }),
		)
		expect(detectFramework()).toBe('next-pages')
	})
})

// ============================================================================
// isSwiftProject
// ============================================================================

describe('isSwiftProject', () => {
	it('returns true for swift-spm', () => {
		expect(isSwiftProject('swift-spm')).toBe(true)
	})

	it('returns true for swift-xcode', () => {
		expect(isSwiftProject('swift-xcode')).toBe(true)
	})

	it('returns false for JS frameworks', () => {
		expect(isSwiftProject('next-app')).toBe(false)
		expect(isSwiftProject('vite')).toBe(false)
		expect(isSwiftProject('unknown')).toBe(false)
	})
})

// ============================================================================
// getDefaultPath — Swift
// ============================================================================

describe('getDefaultPath — Swift', () => {
	it('returns Sources/{target} for swift-spm with target', () => {
		expect(getDefaultPath('swift-spm', 'MyLib')).toBe('Sources/MyLib')
	})

	it('returns Sources for swift-spm without target', () => {
		expect(getDefaultPath('swift-spm')).toBe('Sources')
	})

	it('returns LPMComponents path for swift-xcode', () => {
		expect(getDefaultPath('swift-xcode')).toBe(
			'Packages/LPMComponents/Sources/LPMComponents',
		)
	})
})

// ============================================================================
// ensureXcodeLocalPackage
// ============================================================================

describe('ensureXcodeLocalPackage', () => {
	let tmpDir
	let originalCwd

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.test-xcode-pkg-'))
		originalCwd = process.cwd()
		process.chdir(tmpDir)
	})

	afterEach(() => {
		process.chdir(originalCwd)
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it('creates Package.swift and Sources directory on first run', () => {
		const result = ensureXcodeLocalPackage()
		expect(result.created).toBe(true)
		expect(result.installPath).toContain('LPMComponents')

		// Check files were created
		const manifestPath = path.join(
			tmpDir,
			'Packages',
			'LPMComponents',
			'Package.swift',
		)
		expect(fs.existsSync(manifestPath)).toBe(true)

		const manifest = fs.readFileSync(manifestPath, 'utf-8')
		expect(manifest).toContain('swift-tools-version')
		expect(manifest).toContain('LPMComponents')

		// Check Sources directory exists
		const sourcesDir = path.join(
			tmpDir,
			'Packages',
			'LPMComponents',
			'Sources',
			'LPMComponents',
		)
		expect(fs.existsSync(sourcesDir)).toBe(true)

		// Check placeholder file
		const placeholder = path.join(sourcesDir, 'LPMComponents.swift')
		expect(fs.existsSync(placeholder)).toBe(true)
	})

	it('returns created=false when Package.swift already exists', () => {
		// Create it first
		ensureXcodeLocalPackage()

		// Second call should not recreate
		const result = ensureXcodeLocalPackage()
		expect(result.created).toBe(false)
	})

	it('returns correct installPath', () => {
		const result = ensureXcodeLocalPackage()
		const expected = path.join(
			tmpDir,
			'Packages',
			'LPMComponents',
			'Sources',
			'LPMComponents',
		)
		expect(result.installPath).toBe(expected)
	})
})
