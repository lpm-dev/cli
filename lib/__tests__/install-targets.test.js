import { describe, expect, it } from 'vitest'
import { hasCustomHandler, getHandler, getDefaultTarget } from '../install-targets.js'

describe('install-targets', () => {
	describe('hasCustomHandler', () => {
		it('returns true for mcp-server type', () => {
			expect(hasCustomHandler('mcp-server')).toBe(true)
		})

		it('returns true for vscode-extension type', () => {
			expect(hasCustomHandler('vscode-extension')).toBe(true)
		})

		it('returns false for unknown types', () => {
			expect(hasCustomHandler('unknown')).toBe(false)
		})

		it('returns false for standard source type', () => {
			expect(hasCustomHandler('source')).toBe(false)
		})

		it('returns false for standard package type', () => {
			expect(hasCustomHandler('package')).toBe(false)
		})

		it('returns false for undefined', () => {
			expect(hasCustomHandler(undefined)).toBe(false)
		})
	})

	describe('getHandler', () => {
		it('returns handler object for mcp-server', () => {
			const handler = getHandler('mcp-server')
			expect(handler).toBeDefined()
			expect(handler.install).toBeTypeOf('function')
			expect(handler.remove).toBeTypeOf('function')
		})

		it('returns handler object for vscode-extension', () => {
			const handler = getHandler('vscode-extension')
			expect(handler).toBeDefined()
			expect(handler.install).toBeTypeOf('function')
			expect(handler.remove).toBeTypeOf('function')
		})

		it('returns null for unknown type', () => {
			expect(getHandler('unknown')).toBeNull()
		})

		it('returns null for source type', () => {
			expect(getHandler('source')).toBeNull()
		})
	})

	describe('getDefaultTarget', () => {
		it('returns .cursor/rules for cursor-rules type', () => {
			expect(getDefaultTarget('cursor-rules')).toBe('.cursor/rules')
		})

		it('returns .github for github-action type', () => {
			expect(getDefaultTarget('github-action')).toBe('.github')
		})

		it('returns null for mcp-server (uses custom handler instead)', () => {
			expect(getDefaultTarget('mcp-server')).toBeNull()
		})

		it('returns null for source type', () => {
			expect(getDefaultTarget('source')).toBeNull()
		})

		it('returns null for package type', () => {
			expect(getDefaultTarget('package')).toBeNull()
		})

		it('returns null for unknown types', () => {
			expect(getDefaultTarget('unknown')).toBeNull()
		})

		it('returns null for undefined', () => {
			expect(getDefaultTarget(undefined)).toBeNull()
		})
	})
})
