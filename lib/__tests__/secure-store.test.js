import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// We test only the encrypted file fallback (keytar unavailable).
// The crypto-based encrypt/decrypt is tested indirectly via set/get round-trip.
// ---------------------------------------------------------------------------

// Override homedir so tests don't touch real credentials
const { testHome } = vi.hoisted(() => {
	const os = require("node:os")
	const path = require("node:path")
	return {
		testHome: path.join(os.tmpdir(), `lpm-test-secure-store-${Date.now()}`),
	}
})

vi.mock("node:os", async () => {
	const actual = await vi.importActual("node:os")
	return { ...actual, homedir: () => testHome }
})

// Force keytar to be unavailable so we exercise the file fallback
vi.mock("keytar", () => {
	throw new Error("keytar not available")
})

import {
	clearAllSecrets,
	clearToken,
	deleteSecret,
	getSecret,
	getToken,
	isUsingKeychain,
	setSecret,
	setToken,
} from "../secure-store.js"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("secure-store.js – encrypted file fallback", () => {
	beforeEach(() => {
		// Ensure a clean test directory
		mkdirSync(testHome, { recursive: true })
	})

	afterEach(() => {
		// Clean up test files
		const storeDir = join(testHome, ".lpm")
		const files = [join(storeDir, ".credentials"), join(storeDir, ".salt")]
		for (const f of files) {
			try {
				unlinkSync(f)
			} catch {}
		}
	})

	it("isUsingKeychain returns false without keytar", async () => {
		expect(await isUsingKeychain()).toBe(false)
	})

	it("set and get a secret round-trip", async () => {
		await setSecret("test-key", "super-secret-value")
		const value = await getSecret("test-key")
		expect(value).toBe("super-secret-value")
	})

	it("returns null for non-existent key", async () => {
		const value = await getSecret("nonexistent")
		expect(value).toBeNull()
	})

	it("overwrites existing secret", async () => {
		await setSecret("my-key", "value-1")
		await setSecret("my-key", "value-2")
		expect(await getSecret("my-key")).toBe("value-2")
	})

	it("stores multiple secrets", async () => {
		await setSecret("key-a", "alpha")
		await setSecret("key-b", "beta")
		expect(await getSecret("key-a")).toBe("alpha")
		expect(await getSecret("key-b")).toBe("beta")
	})

	it("deleteSecret removes a key", async () => {
		await setSecret("delete-me", "gone")
		const deleted = await deleteSecret("delete-me")
		expect(deleted).toBe(true)
		expect(await getSecret("delete-me")).toBeNull()
	})

	it("deleteSecret returns false for missing key", async () => {
		const deleted = await deleteSecret("never-existed")
		expect(deleted).toBe(false)
	})

	it("clearAllSecrets removes the credential file", async () => {
		await setSecret("temp", "value")
		await clearAllSecrets()

		const credFile = join(testHome, ".lpm", ".credentials")
		expect(existsSync(credFile)).toBe(false)
	})
})

describe("secure-store.js – token helpers", () => {
	beforeEach(() => {
		mkdirSync(testHome, { recursive: true })
	})

	afterEach(() => {
		const storeDir = join(testHome, ".lpm")
		const files = [join(storeDir, ".credentials"), join(storeDir, ".salt")]
		for (const f of files) {
			try {
				unlinkSync(f)
			} catch {}
		}
	})

	it("setToken + getToken round-trip", async () => {
		await setToken("my-auth-token")
		expect(await getToken()).toBe("my-auth-token")
	})

	it("clearToken removes the token", async () => {
		await setToken("to-clear")
		await clearToken()
		expect(await getToken()).toBeNull()
	})
})

describe("secure-store.js – corruption resilience", () => {
	beforeEach(() => {
		mkdirSync(join(testHome, ".lpm"), { recursive: true })
	})

	afterEach(() => {
		const storeDir = join(testHome, ".lpm")
		const files = [join(storeDir, ".credentials"), join(storeDir, ".salt")]
		for (const f of files) {
			try {
				unlinkSync(f)
			} catch {}
		}
	})

	it("returns null when credential file is corrupted", async () => {
		writeFileSync(join(testHome, ".lpm", ".credentials"), "garbage-data")
		const value = await getSecret("any-key")
		expect(value).toBeNull()
	})

	it("can write new credentials after corruption", async () => {
		writeFileSync(join(testHome, ".lpm", ".credentials"), "garbage-data")
		await setSecret("fresh-key", "fresh-value")
		expect(await getSecret("fresh-key")).toBe("fresh-value")
	})
})
