import {
	mkdtempSync,
	rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// Mocks — must use vi.hoisted() so mock factories can reference them
// ============================================================================

const {
	mockText,
	mockMultiselect,
	mockIsCancel,
	mockCancel,
	mockAddMcpServer,
	mockRemoveMcpServerEntry,
	mockHasMcpServer,
	mockDetectEditors,
	mockShortPath,
	mockEditors,
} = vi.hoisted(() => ({
	mockText: vi.fn(),
	mockMultiselect: vi.fn(),
	mockIsCancel: vi.fn().mockReturnValue(false),
	mockCancel: vi.fn(),
	mockAddMcpServer: vi.fn(),
	mockRemoveMcpServerEntry: vi.fn().mockReturnValue(false),
	mockHasMcpServer: vi.fn().mockReturnValue(false),
	mockDetectEditors: vi.fn().mockReturnValue([]),
	mockShortPath: vi.fn((p) => p),
	mockEditors: [],
}))

vi.mock('@clack/prompts', () => ({
	text: mockText,
	multiselect: mockMultiselect,
	isCancel: mockIsCancel,
	cancel: mockCancel,
}))
vi.mock('chalk', () => {
	const p = (str) => str
	p.dim = p
	p.red = p
	return { default: p }
})
vi.mock('../../editors.js', () => ({
	EDITORS: mockEditors,
	addMcpServer: mockAddMcpServer,
	removeMcpServerEntry: mockRemoveMcpServerEntry,
	hasMcpServer: mockHasMcpServer,
	detectEditors: mockDetectEditors,
	shortPath: mockShortPath,
}))

import { installMcpServer, removeMcpServer } from '../../install-targets/mcp-server.js'

// ============================================================================
// Helpers
// ============================================================================

let tmpDir

function createTmpDir() {
	tmpDir = mkdtempSync(join(tmpdir(), 'lpm-mcp-target-'))
	return tmpDir
}

// ============================================================================
// Tests
// ============================================================================

describe('mcp-server install target', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockEditors.length = 0
	})

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true })
			tmpDir = null
		}
	})

	describe('installMcpServer', () => {
		it('returns failure when no editors detected', async () => {
			mockDetectEditors.mockReturnValueOnce([])

			const result = await installMcpServer({
				name: '@lpm.dev/test.mcp',
				version: '1.0.0',
				lpmConfig: { type: 'mcp-server' },
				extractDir: '/tmp/fake',
				options: { yes: true },
			})

			expect(result.success).toBe(false)
			expect(result.message).toContain('No supported AI editors')
		})

		it('configures detected editors with --yes flag', async () => {
			const dir = createTmpDir()
			const configPath = join(dir, 'claude.json')

			mockDetectEditors.mockReturnValueOnce([
				{
					id: 'claude-code',
					name: 'Claude Code',
					globalPath: configPath,
					serverKey: 'mcpServers',
				},
			])

			const result = await installMcpServer({
				name: '@lpm.dev/test.mcp',
				version: '1.0.0',
				lpmConfig: {
					type: 'mcp-server',
					mcpConfig: {
						command: 'node',
						args: ['server.js'],
					},
				},
				extractDir: '/tmp/fake',
				options: { yes: true },
			})

			expect(result.success).toBe(true)
			expect(result.message).toContain('Claude Code')
			expect(mockAddMcpServer).toHaveBeenCalledWith(
				configPath,
				'mcpServers',
				'lpm-test-mcp',
				{ command: 'node', args: ['server.js'] },
			)
		})

		it('uses npx fallback when no command in mcpConfig', async () => {
			const dir = createTmpDir()
			const configPath = join(dir, 'claude.json')

			mockDetectEditors.mockReturnValueOnce([
				{
					id: 'claude-code',
					name: 'Claude Code',
					globalPath: configPath,
					serverKey: 'mcpServers',
				},
			])

			await installMcpServer({
				name: '@lpm.dev/test.mcp',
				version: '1.0.0',
				lpmConfig: { type: 'mcp-server' },
				extractDir: '/tmp/fake',
				options: { yes: true },
			})

			expect(mockAddMcpServer).toHaveBeenCalledWith(
				configPath,
				'mcpServers',
				'lpm-test-mcp',
				{ command: 'npx', args: ['@lpm.dev/test.mcp'] },
			)
		})

		it('derives correct server name from package name', async () => {
			const dir = createTmpDir()
			const configPath = join(dir, 'claude.json')

			mockDetectEditors.mockReturnValueOnce([
				{
					id: 'claude-code',
					name: 'Claude Code',
					globalPath: configPath,
					serverKey: 'mcpServers',
				},
			])

			await installMcpServer({
				name: '@lpm.dev/acme.stripe-mcp',
				version: '1.0.0',
				lpmConfig: { type: 'mcp-server' },
				extractDir: '/tmp/fake',
				options: { yes: true },
			})

			// @lpm.dev/acme.stripe-mcp → lpm-acme-stripe-mcp
			expect(mockAddMcpServer).toHaveBeenCalledWith(
				configPath,
				'mcpServers',
				'lpm-acme-stripe-mcp',
				expect.any(Object),
			)
		})

		it('configures multiple editors', async () => {
			const dir = createTmpDir()
			const claudePath = join(dir, 'claude.json')
			const cursorPath = join(dir, 'cursor.json')

			mockDetectEditors.mockReturnValueOnce([
				{
					id: 'claude-code',
					name: 'Claude Code',
					globalPath: claudePath,
					serverKey: 'mcpServers',
				},
				{
					id: 'cursor',
					name: 'Cursor',
					globalPath: cursorPath,
					serverKey: 'mcpServers',
				},
			])

			const result = await installMcpServer({
				name: '@lpm.dev/test.mcp',
				version: '1.0.0',
				lpmConfig: {
					type: 'mcp-server',
					mcpConfig: { command: 'node', args: ['server.js'] },
				},
				extractDir: '/tmp/fake',
				options: { yes: true },
			})

			expect(result.success).toBe(true)
			expect(result.message).toContain('Claude Code')
			expect(result.message).toContain('Cursor')
			expect(mockAddMcpServer).toHaveBeenCalledTimes(2)
		})

		it('skips env var prompting with --yes flag', async () => {
			const dir = createTmpDir()
			const configPath = join(dir, 'claude.json')

			mockDetectEditors.mockReturnValueOnce([
				{
					id: 'claude-code',
					name: 'Claude Code',
					globalPath: configPath,
					serverKey: 'mcpServers',
				},
			])

			await installMcpServer({
				name: '@lpm.dev/test.mcp',
				version: '1.0.0',
				lpmConfig: {
					type: 'mcp-server',
					mcpConfig: {
						command: 'node',
						args: ['server.js'],
						env: {
							API_KEY: { prompt: 'Enter API key', required: true },
						},
					},
				},
				extractDir: '/tmp/fake',
				options: { yes: true },
			})

			// Should not have prompted for env vars
			expect(mockText).not.toHaveBeenCalled()
		})

		it('prompts for env vars when not using --yes', async () => {
			const dir = createTmpDir()
			const configPath = join(dir, 'claude.json')

			mockDetectEditors.mockReturnValueOnce([
				{
					id: 'claude-code',
					name: 'Claude Code',
					globalPath: configPath,
					serverKey: 'mcpServers',
				},
			])

			mockText.mockResolvedValueOnce('sk-test-key')

			await installMcpServer({
				name: '@lpm.dev/test.mcp',
				version: '1.0.0',
				lpmConfig: {
					type: 'mcp-server',
					mcpConfig: {
						command: 'node',
						args: ['server.js'],
						env: {
							API_KEY: { prompt: 'Enter API key', required: true },
						},
					},
				},
				extractDir: '/tmp/fake',
				options: {},
			})

			expect(mockText).toHaveBeenCalledTimes(1)
			expect(mockAddMcpServer).toHaveBeenCalledWith(
				configPath,
				'mcpServers',
				'lpm-test-mcp',
				{
					command: 'node',
					args: ['server.js'],
					env: { API_KEY: 'sk-test-key' },
				},
			)
		})

		it('handles addMcpServer throwing an error', async () => {
			const dir = createTmpDir()
			const configPath = join(dir, 'claude.json')

			mockDetectEditors.mockReturnValueOnce([
				{
					id: 'claude-code',
					name: 'Claude Code',
					globalPath: configPath,
					serverKey: 'mcpServers',
				},
			])
			mockAddMcpServer.mockImplementationOnce(() => {
				throw new Error('Write failed')
			})

			vi.spyOn(console, 'error').mockImplementation(() => {})

			const result = await installMcpServer({
				name: '@lpm.dev/test.mcp',
				version: '1.0.0',
				lpmConfig: { type: 'mcp-server' },
				extractDir: '/tmp/fake',
				options: { yes: true },
			})

			expect(result.success).toBe(false)
			expect(result.message).toContain('Failed to configure')
		})
	})

	describe('removeMcpServer', () => {
		it('returns success message when no editors had it configured', async () => {
			mockRemoveMcpServerEntry.mockReturnValue(false)

			const result = await removeMcpServer({
				name: '@lpm.dev/test.mcp',
			})

			expect(result.success).toBe(true)
			expect(result.message).toContain('not configured')
		})

		it('returns count of editors it was removed from', async () => {
			mockRemoveMcpServerEntry
				.mockReturnValueOnce(true)
				.mockReturnValueOnce(false)
				.mockReturnValueOnce(true)
				.mockReturnValueOnce(false)
				.mockReturnValueOnce(false)

			mockEditors.push(
				{ id: 'claude-code', globalPath: '/a', serverKey: 'mcpServers' },
				{ id: 'cursor', globalPath: '/b', serverKey: 'mcpServers' },
				{ id: 'vscode', globalPath: '/c', serverKey: 'servers' },
				{ id: 'claude-desktop', globalPath: '/d', serverKey: 'mcpServers' },
				{ id: 'windsurf', globalPath: '/e', serverKey: 'mcpServers' },
			)

			const result = await removeMcpServer({
				name: '@lpm.dev/test.mcp',
			})

			expect(result.success).toBe(true)
			expect(result.message).toContain('2 editors')
		})

		it('uses correct derived server name for removal', async () => {
			mockEditors.push({
				id: 'claude-code',
				globalPath: '/fake/path',
				serverKey: 'mcpServers',
			})
			mockRemoveMcpServerEntry.mockReturnValue(false)

			await removeMcpServer({
				name: '@lpm.dev/acme.stripe-mcp',
			})

			expect(mockRemoveMcpServerEntry).toHaveBeenCalledWith(
				'/fake/path',
				'mcpServers',
				'lpm-acme-stripe-mcp',
			)
		})

		it('returns singular form for 1 editor', async () => {
			mockRemoveMcpServerEntry.mockReturnValueOnce(true)
			mockEditors.push({
				id: 'claude-code',
				globalPath: '/a',
				serverKey: 'mcpServers',
			})

			const result = await removeMcpServer({
				name: '@lpm.dev/test.mcp',
			})

			expect(result.message).toMatch(/1 editor[^s]/)
		})
	})
})
