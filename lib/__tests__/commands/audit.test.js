import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }))

vi.mock('../../api.js', () => ({ post: mockPost }))
vi.mock('chalk', () => {
	const p = str => str
	p.red = p; p.green = p; p.cyan = p; p.dim = p; p.yellow = p; p.bold = p; p.blue = p
	p.bgRed = { white: p }
	return { default: p }
})
vi.mock('ora', () => ({
	default: () => ({
		start: vi.fn().mockReturnThis(),
		stop: vi.fn(),
		succeed: vi.fn(),
		fail: vi.fn(),
		text: '',
	}),
}))

import { audit } from '../../commands/audit.js'

let tmpDir
let consoleLogs = []

function createProject(files = {}) {
	tmpDir = mkdtempSync(join(tmpdir(), 'lpm-audit-'))
	for (const [p, content] of Object.entries(files)) {
		writeFileSync(join(tmpDir, p), typeof content === 'string' ? content : JSON.stringify(content))
	}
	vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
}

function jsonResponse(body, status = 200) {
	return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }
}

describe('audit command', () => {
	beforeEach(() => {
		consoleLogs = []
		vi.spyOn(console, 'log').mockImplementation((...args) => consoleLogs.push(args.join(' ')))
		vi.spyOn(console, 'error').mockImplementation(() => {})
		vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
		mockPost.mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
		if (tmpDir) { rmSync(tmpDir, { recursive: true, force: true }); tmpDir = null }
	})

	it('exits when no package.json', async () => {
		createProject({})
		await expect(audit(undefined, {})).rejects.toThrow('process.exit')
	})

	it('reports no vulnerabilities', async () => {
		createProject({
			'package.json': { dependencies: { lodash: '^4.17.21' } },
		})
		mockPost.mockResolvedValueOnce(jsonResponse({ vulnerabilities: [], counts: {} }))

		await audit(undefined, {})

		expect(consoleLogs.some(l => l.includes('No vulnerabilities'))).toBe(true)
	})

	it('displays vulnerabilities grouped by package', async () => {
		createProject({
			'package.json': { dependencies: { lodash: '^4.17.0' } },
		})
		mockPost.mockResolvedValueOnce(jsonResponse({
			vulnerabilities: [
				{ package: 'lodash', severity: 'high', title: 'Prototype Pollution' },
			],
			counts: { high: 1 },
		}))

		await expect(audit(undefined, {})).rejects.toThrow('process.exit')
		expect(consoleLogs.some(l => l.includes('Prototype Pollution'))).toBe(true)
	})

	it('filters by severity level', async () => {
		createProject({
			'package.json': { dependencies: { foo: '1.0.0' } },
		})
		mockPost.mockResolvedValueOnce(jsonResponse({
			vulnerabilities: [
				{ package: 'foo', severity: 'low', title: 'Low issue' },
				{ package: 'foo', severity: 'critical', title: 'Critical issue' },
			],
			counts: { low: 1, critical: 1 },
		}))

		await expect(audit(undefined, { level: 'high' })).rejects.toThrow('process.exit')
		const output = consoleLogs.join('\n')
		expect(output).toContain('Critical issue')
	})

	it('outputs JSON format', async () => {
		createProject({
			'package.json': { dependencies: { foo: '1.0.0' } },
		})
		mockPost.mockResolvedValueOnce(jsonResponse({ vulnerabilities: [], counts: {} }))

		await audit(undefined, { json: true })

		const parsed = JSON.parse(consoleLogs.join(''))
		expect(parsed.scanned).toBe(1)
		expect(parsed.vulnerabilities).toEqual([])
	})

	it('succeeds with no dependencies', async () => {
		createProject({ 'package.json': {} })
		await audit(undefined, {})
		// Should not throw, reports no deps to audit
	})
})
