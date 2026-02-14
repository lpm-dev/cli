import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	hasDangerousPatterns,
	resolveSafePath,
	sanitizeFilename,
	validateComponentPath,
	validateTarballPaths,
} from '../safe-path.js'

// ============================================================================
// resolveSafePath
// ============================================================================

describe('resolveSafePath', () => {
	const basePath = '/home/user/project'

	it('resolves a normal relative path', () => {
		const result = resolveSafePath(basePath, 'src/components/Button.jsx')
		expect(result.safe).toBe(true)
		expect(result.resolvedPath).toBe(
			join(basePath, 'src/components/Button.jsx'),
		)
	})

	it('resolves a deeply nested safe path', () => {
		const result = resolveSafePath(basePath, 'a/b/c/d/e/file.js')
		expect(result.safe).toBe(true)
		expect(result.resolvedPath).toBe(join(basePath, 'a/b/c/d/e/file.js'))
	})

	it('rejects paths with ../ that escape base', () => {
		const result = resolveSafePath(basePath, '../../etc/passwd')
		expect(result.safe).toBe(false)
		expect(result.error).toContain('path traversal')
	})

	it('rejects absolute user paths', () => {
		const result = resolveSafePath(basePath, '/etc/passwd')
		expect(result.safe).toBe(false)
		expect(result.error).toContain('path traversal')
	})

	it('rejects non-absolute base path', () => {
		const result = resolveSafePath('relative/path', 'file.js')
		expect(result.safe).toBe(false)
		expect(result.error).toContain('Base path must be absolute')
	})

	it('allows ../ that stays within base', () => {
		const result = resolveSafePath(basePath, 'src/../lib/utils.js')
		expect(result.safe).toBe(true)
		expect(result.resolvedPath).toBe(join(basePath, 'lib/utils.js'))
	})

	it('rejects ../ that goes one level above base', () => {
		const result = resolveSafePath(basePath, '../other-project/file.js')
		expect(result.safe).toBe(false)
	})
})

// ============================================================================
// hasDangerousPatterns
// ============================================================================

describe('hasDangerousPatterns', () => {
	it('detects null bytes', () => {
		expect(hasDangerousPatterns('file\0name.js')).toBe(true)
	})

	it('detects Windows drive letters', () => {
		expect(hasDangerousPatterns('C:/Windows/system32')).toBe(true)
	})

	it('detects UNC paths (backslash)', () => {
		expect(hasDangerousPatterns('\\\\server\\share')).toBe(true)
	})

	it('detects UNC paths (forward slash)', () => {
		expect(hasDangerousPatterns('//server/share')).toBe(true)
	})

	it('detects excessive parent traversal', () => {
		expect(hasDangerousPatterns('../../../etc/passwd')).toBe(true)
	})

	it('returns false for normal paths', () => {
		expect(hasDangerousPatterns('src/components/Button.jsx')).toBe(false)
	})

	it('returns false for single parent traversal', () => {
		expect(hasDangerousPatterns('../file.js')).toBe(false)
	})

	it('returns true for null input', () => {
		expect(hasDangerousPatterns(null)).toBe(true)
	})

	it('returns true for empty string', () => {
		expect(hasDangerousPatterns('')).toBe(true)
	})

	it('returns true for non-string input', () => {
		expect(hasDangerousPatterns(123)).toBe(true)
	})
})

// ============================================================================
// sanitizeFilename
// ============================================================================

describe('sanitizeFilename', () => {
	it('removes null bytes', () => {
		expect(sanitizeFilename('file\0name.js')).toBe('filename.js')
	})

	it('replaces forward slashes with dashes', () => {
		expect(sanitizeFilename('path/to/file.js')).toBe('path-to-file.js')
	})

	it('replaces backslashes with dashes', () => {
		expect(sanitizeFilename('path\\to\\file.js')).toBe('path-to-file.js')
	})

	it('removes special characters', () => {
		expect(sanitizeFilename('file<>:"|?*.js')).toBe('file.js')
	})

	it('collapses multiple dashes', () => {
		expect(sanitizeFilename('a///b')).toBe('a-b')
	})

	it('trims dashes from ends', () => {
		expect(sanitizeFilename('/leading')).toBe('leading')
	})

	it('limits length to 255 characters', () => {
		const longName = 'a'.repeat(300) + '.js'
		expect(sanitizeFilename(longName).length).toBeLessThanOrEqual(255)
	})

	it('returns empty string for null input', () => {
		expect(sanitizeFilename(null)).toBe('')
	})

	it('returns empty string for empty input', () => {
		expect(sanitizeFilename('')).toBe('')
	})

	it('returns empty string for non-string input', () => {
		expect(sanitizeFilename(123)).toBe('')
	})
})

// ============================================================================
// validateComponentPath
// ============================================================================

describe('validateComponentPath', () => {
	const projectRoot = '/home/user/my-project'

	it('validates a safe component path', () => {
		const result = validateComponentPath(projectRoot, 'src/components/Button')
		expect(result.valid).toBe(true)
		expect(result.resolvedPath).toBe(
			join(projectRoot, 'src/components/Button'),
		)
	})

	it('rejects path with traversal', () => {
		const result = validateComponentPath(projectRoot, '../../../etc')
		expect(result.valid).toBe(false)
		expect(result.error).toContain('path traversal')
	})

	it('rejects path with null bytes', () => {
		const result = validateComponentPath(projectRoot, 'src/\0malicious')
		expect(result.valid).toBe(false)
	})

	it('rejects absolute paths', () => {
		const result = validateComponentPath(projectRoot, '/etc/passwd')
		expect(result.valid).toBe(false)
	})
})

// ============================================================================
// validateTarballPaths
// ============================================================================

describe('validateTarballPaths', () => {
	const extractDir = '/tmp/lpm-extract'

	it('validates all safe paths', () => {
		const result = validateTarballPaths(extractDir, [
			'package/index.js',
			'package/lib/utils.js',
			'package/README.md',
		])
		expect(result.valid).toBe(true)
		expect(result.invalidPaths).toEqual([])
	})

	it('detects unsafe paths (zip-slip)', () => {
		const result = validateTarballPaths(extractDir, [
			'package/index.js',
			'../../etc/passwd',
			'package/lib/utils.js',
		])
		expect(result.valid).toBe(false)
		expect(result.invalidPaths).toContain('../../etc/passwd')
	})

	it('reports all invalid paths', () => {
		const result = validateTarballPaths(extractDir, [
			'../../etc/passwd',
			'../../../root/.ssh/id_rsa',
		])
		expect(result.valid).toBe(false)
		expect(result.invalidPaths).toHaveLength(2)
	})

	it('handles empty file list', () => {
		const result = validateTarballPaths(extractDir, [])
		expect(result.valid).toBe(true)
		expect(result.invalidPaths).toEqual([])
	})
})
