import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	detectFramework,
	getDefaultPath,
	getProjectAliases,
	getUserImportPrefix,
	resolveAliasForDirectory,
} from '../project-utils.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir

function createTmpProject(files = {}) {
	tmpDir = mkdtempSync(join(tmpdir(), 'lpm-project-'))
	for (const [filePath, content] of Object.entries(files)) {
		const fullPath = join(tmpDir, filePath)
		mkdirSync(path.dirname(fullPath), { recursive: true })
		writeFileSync(fullPath, typeof content === 'string' ? content : JSON.stringify(content))
	}
	// Override cwd
	vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
	return tmpDir
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('project-utils.js – detectFramework()', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	it('returns "unknown" when no package.json', () => {
		createTmpProject({})
		expect(detectFramework()).toBe('unknown')
	})

	it('detects next-app when "next" dep and app/ dir exist', () => {
		createTmpProject({
			'package.json': { dependencies: { next: '^14.0.0' } },
			'app/.gitkeep': '',
		})
		expect(detectFramework()).toBe('next-app')
	})

	it('detects next-pages when "next" dep but no app/ dir', () => {
		createTmpProject({
			'package.json': { dependencies: { next: '^14.0.0' } },
		})
		expect(detectFramework()).toBe('next-pages')
	})

	it('detects remix framework', () => {
		createTmpProject({
			'package.json': {
				dependencies: { '@remix-run/react': '^2.0.0' },
			},
		})
		expect(detectFramework()).toBe('remix')
	})

	it('detects vite framework', () => {
		createTmpProject({
			'package.json': { devDependencies: { vite: '^5.0.0' } },
		})
		expect(detectFramework()).toBe('vite')
	})

	it('returns "unknown" for plain node project', () => {
		createTmpProject({
			'package.json': { dependencies: { express: '^4.0.0' } },
		})
		expect(detectFramework()).toBe('unknown')
	})

	it('returns "unknown" for malformed package.json', () => {
		createTmpProject({ 'package.json': 'not-valid-json{{{' })
		expect(detectFramework()).toBe('unknown')
	})
})

describe('project-utils.js – getDefaultPath()', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	it('returns components for next-app when components/ exists', () => {
		createTmpProject({ 'components/.gitkeep': '' })
		expect(getDefaultPath('next-app')).toBe('components')
	})

	it('returns src/components for next-app when no components/ dir', () => {
		createTmpProject({})
		expect(getDefaultPath('next-app')).toBe('src/components')
	})

	it('returns src/components for vite', () => {
		createTmpProject({})
		expect(getDefaultPath('vite')).toBe('src/components')
	})

	it('returns src/components for remix', () => {
		createTmpProject({})
		expect(getDefaultPath('remix')).toBe('src/components')
	})

	it('returns components for unknown framework', () => {
		createTmpProject({})
		expect(getDefaultPath('unknown')).toBe('components')
	})
})

describe('project-utils.js – getProjectAliases()', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	it('returns empty object when no config file', () => {
		createTmpProject({})
		expect(getProjectAliases()).toEqual({})
	})

	it('reads paths from tsconfig.json', () => {
		createTmpProject({
			'tsconfig.json': {
				compilerOptions: {
					paths: { '@/*': ['./src/*'] },
				},
			},
		})
		expect(getProjectAliases()).toEqual({ '@/*': ['./src/*'] })
	})

	it('reads paths from jsconfig.json when no tsconfig', () => {
		createTmpProject({
			'jsconfig.json': {
				compilerOptions: {
					paths: { '~/*': ['./src/*'] },
				},
			},
		})
		expect(getProjectAliases()).toEqual({ '~/*': ['./src/*'] })
	})

	it('prefers tsconfig.json over jsconfig.json', () => {
		createTmpProject({
			'tsconfig.json': {
				compilerOptions: { paths: { '@/*': ['./src/*'] } },
			},
			'jsconfig.json': {
				compilerOptions: { paths: { '~/*': ['./lib/*'] } },
			},
		})
		expect(getProjectAliases()).toEqual({ '@/*': ['./src/*'] })
	})

	it('handles config with comments (basic stripping)', () => {
		createTmpProject({
			'tsconfig.json':
				'{\n  // This is a comment\n  "compilerOptions": {\n    "paths": { "@/*": ["./src/*"] }\n  }\n}',
		})
		expect(getProjectAliases()).toEqual({ '@/*': ['./src/*'] })
	})

	it('returns empty for config without compilerOptions.paths', () => {
		createTmpProject({
			'tsconfig.json': { compilerOptions: { strict: true } },
		})
		expect(getProjectAliases()).toEqual({})
	})
})

describe('project-utils.js – getUserImportPrefix()', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	it('returns "@" as default when no config', () => {
		createTmpProject({})
		expect(getUserImportPrefix()).toBe('@')
	})

	it('extracts prefix from alias pointing to src/', () => {
		createTmpProject({
			'tsconfig.json': {
				compilerOptions: {
					paths: { '@/*': ['./src/*'] },
				},
			},
		})
		expect(getUserImportPrefix()).toBe('@')
	})

	it('extracts custom prefix', () => {
		createTmpProject({
			'tsconfig.json': {
				compilerOptions: {
					paths: { '~/*': ['src/*'] },
				},
			},
		})
		expect(getUserImportPrefix()).toBe('~')
	})

	it('returns "@" when alias does not point to src', () => {
		createTmpProject({
			'tsconfig.json': {
				compilerOptions: {
					paths: { '#utils/*': ['./lib/utils/*'] },
				},
			},
		})
		expect(getUserImportPrefix()).toBe('@')
	})
})

describe('project-utils.js – resolveAliasForDirectory()', () => {
	it('resolves when target is under alias mapping', () => {
		const result = resolveAliasForDirectory('src/components/design-system', {
			'@/*': ['./src/*'],
		})
		expect(result).toBe('@/components/design-system')
	})

	it('returns null when target is not under any alias', () => {
		const result = resolveAliasForDirectory('components/design-system', {
			'@/*': ['./src/*'],
		})
		expect(result).toBeNull()
	})

	it('handles tilde alias', () => {
		const result = resolveAliasForDirectory('src/components', {
			'~/*': ['src/*'],
		})
		expect(result).toBe('~/components')
	})

	it('handles exact alias root match', () => {
		const result = resolveAliasForDirectory('src', {
			'@/*': ['./src/*'],
		})
		expect(result).toBe('@')
	})

	it('ignores aliases without wildcard suffix', () => {
		const result = resolveAliasForDirectory('src/utils', {
			'@utils': ['./src/utils/index.js'],
		})
		expect(result).toBeNull()
	})

	it('handles leading ./ in target path', () => {
		const result = resolveAliasForDirectory('./src/components/ui', {
			'@/*': ['./src/*'],
		})
		expect(result).toBe('@/components/ui')
	})
})
