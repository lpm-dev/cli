import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const { mockSpawn } = vi.hoisted(() => ({
	mockSpawn: vi.fn(),
}))

vi.mock('node:child_process', () => ({ spawn: mockSpawn }))
vi.mock('../../ui.js', () => ({
	log: { error: vi.fn() },
}))

import { run } from '../../commands/run.js'

describe('run command', () => {
	beforeEach(() => {
		mockSpawn.mockReset()
		vi.spyOn(process, 'exit').mockImplementation(() => {})
	})

	afterEach(() => { vi.restoreAllMocks() })

	it('spawns npm with correct script and args', async () => {
		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		await run('test', {}, { args: ['--watch'] })

		expect(mockSpawn).toHaveBeenCalledWith(
			'npm',
			['run', 'test', '--watch'],
			{ stdio: 'inherit' },
		)
	})

	it('exits with child process exit code on close', async () => {
		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		await run('build', {}, { args: [] })
		child.emit('close', 0)

		expect(process.exit).toHaveBeenCalledWith(0)
	})

	it('exits with code 1 on spawn error', async () => {
		const child = new EventEmitter()
		mockSpawn.mockReturnValue(child)

		await run('test', {}, { args: [] })
		child.emit('error', new Error('ENOENT'))

		expect(process.exit).toHaveBeenCalledWith(1)
	})
})
