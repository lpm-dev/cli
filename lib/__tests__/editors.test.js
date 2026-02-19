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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	EDITORS,
	readJsonSafe,
	writeJson,
	addMcpServer,
	removeMcpServerEntry,
	hasMcpServer,
	shortPath,
} from '../editors.js'

let tmpDir

function createTmpDir() {
	tmpDir = mkdtempSync(join(tmpdir(), 'lpm-editors-'))
	return tmpDir
}

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, 'utf-8'))
}

describe('editors module', () => {
	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	describe('EDITORS', () => {
		it('has 5 editor definitions', () => {
			expect(EDITORS).toHaveLength(5)
		})

		it('each editor has required fields', () => {
			for (const editor of EDITORS) {
				expect(editor.id).toBeTypeOf('string')
				expect(editor.name).toBeTypeOf('string')
				expect(editor.globalPath).toBeTypeOf('string')
				expect(editor.serverKey).toBeTypeOf('string')
				expect(editor.detect).toBeTypeOf('function')
			}
		})

		it('VS Code uses "servers" key', () => {
			const vscode = EDITORS.find((e) => e.id === 'vscode')
			expect(vscode.serverKey).toBe('servers')
		})

		it('other editors use "mcpServers" key', () => {
			const nonVscode = EDITORS.filter((e) => e.id !== 'vscode')
			for (const editor of nonVscode) {
				expect(editor.serverKey).toBe('mcpServers')
			}
		})
	})

	describe('readJsonSafe', () => {
		it('reads valid JSON file', () => {
			const dir = createTmpDir()
			const filePath = join(dir, 'test.json')
			writeFileSync(filePath, '{"key":"value"}')
			expect(readJsonSafe(filePath)).toEqual({ key: 'value' })
		})

		it('returns empty object for non-existent file', () => {
			expect(readJsonSafe('/nonexistent/file.json')).toEqual({})
		})

		it('returns empty object for invalid JSON', () => {
			const dir = createTmpDir()
			const filePath = join(dir, 'bad.json')
			writeFileSync(filePath, 'not json')
			expect(readJsonSafe(filePath)).toEqual({})
		})
	})

	describe('writeJson', () => {
		it('writes JSON with 2-space indent and trailing newline', () => {
			const dir = createTmpDir()
			const filePath = join(dir, 'out.json')
			writeJson(filePath, { a: 1 })
			const content = readFileSync(filePath, 'utf-8')
			expect(content).toBe('{\n  "a": 1\n}\n')
		})

		it('creates parent directories if missing', () => {
			const dir = createTmpDir()
			const filePath = join(dir, 'deep', 'nested', 'out.json')
			writeJson(filePath, { ok: true })
			expect(existsSync(filePath)).toBe(true)
			expect(readJson(filePath)).toEqual({ ok: true })
		})
	})

	describe('addMcpServer', () => {
		it('creates config file with server entry', () => {
			const dir = createTmpDir()
			const filePath = join(dir, 'config.json')
			addMcpServer(filePath, 'mcpServers', 'test-server', {
				command: 'node',
				args: ['server.js'],
			})
			const result = readJson(filePath)
			expect(result.mcpServers['test-server']).toEqual({
				command: 'node',
				args: ['server.js'],
			})
		})

		it('merges with existing servers', () => {
			const dir = createTmpDir()
			const filePath = join(dir, 'config.json')
			writeFileSync(
				filePath,
				JSON.stringify({
					mcpServers: { existing: { command: 'echo', args: [] } },
				}),
			)
			addMcpServer(filePath, 'mcpServers', 'new-server', {
				command: 'node',
				args: ['new.js'],
			})
			const result = readJson(filePath)
			expect(result.mcpServers.existing).toBeDefined()
			expect(result.mcpServers['new-server']).toBeDefined()
		})

		it('uses correct server key for VS Code ("servers")', () => {
			const dir = createTmpDir()
			const filePath = join(dir, 'mcp.json')
			addMcpServer(filePath, 'servers', 'test-server', {
				command: 'node',
				args: ['server.js'],
			})
			const result = readJson(filePath)
			expect(result.servers['test-server']).toBeDefined()
			expect(result.mcpServers).toBeUndefined()
		})

		it('includes env vars in config', () => {
			const dir = createTmpDir()
			const filePath = join(dir, 'config.json')
			addMcpServer(filePath, 'mcpServers', 'test-server', {
				command: 'node',
				args: ['server.js'],
				env: { API_KEY: 'sk-123' },
			})
			const result = readJson(filePath)
			expect(result.mcpServers['test-server'].env).toEqual({
				API_KEY: 'sk-123',
			})
		})
	})

	describe('removeMcpServerEntry', () => {
		it('removes existing server entry', () => {
			const dir = createTmpDir()
			const filePath = join(dir, 'config.json')
			writeFileSync(
				filePath,
				JSON.stringify({
					mcpServers: {
						keep: { command: 'echo' },
						remove: { command: 'node' },
					},
				}),
			)
			const removed = removeMcpServerEntry(filePath, 'mcpServers', 'remove')
			expect(removed).toBe(true)
			const result = readJson(filePath)
			expect(result.mcpServers.remove).toBeUndefined()
			expect(result.mcpServers.keep).toBeDefined()
		})

		it('returns false when server not found', () => {
			const dir = createTmpDir()
			const filePath = join(dir, 'config.json')
			writeFileSync(
				filePath,
				JSON.stringify({ mcpServers: { other: { command: 'echo' } } }),
			)
			expect(
				removeMcpServerEntry(filePath, 'mcpServers', 'nonexistent'),
			).toBe(false)
		})

		it('returns false when file does not exist', () => {
			expect(
				removeMcpServerEntry('/nonexistent/file.json', 'mcpServers', 'any'),
			).toBe(false)
		})
	})

	describe('hasMcpServer', () => {
		it('returns true when server exists', () => {
			const dir = createTmpDir()
			const filePath = join(dir, 'config.json')
			writeFileSync(
				filePath,
				JSON.stringify({
					mcpServers: { myServer: { command: 'node' } },
				}),
			)
			expect(hasMcpServer(filePath, 'mcpServers', 'myServer')).toBe(true)
		})

		it('returns false when server does not exist', () => {
			const dir = createTmpDir()
			const filePath = join(dir, 'config.json')
			writeFileSync(
				filePath,
				JSON.stringify({ mcpServers: {} }),
			)
			expect(hasMcpServer(filePath, 'mcpServers', 'myServer')).toBe(false)
		})

		it('returns false when file does not exist', () => {
			expect(
				hasMcpServer('/nonexistent/file.json', 'mcpServers', 'any'),
			).toBe(false)
		})
	})

	describe('shortPath', () => {
		it('replaces home directory with ~', () => {
			const home = require('node:os').homedir()
			const result = shortPath(join(home, '.claude.json'))
			expect(result).toBe('~/.claude.json')
		})
	})
})
