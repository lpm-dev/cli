/**
 * Secure Store - OS Keychain Storage with Fallback
 *
 * Provides secure credential storage using the system keychain.
 * Falls back to encrypted file storage if keytar is unavailable.
 *
 * @module cli/lib/secure-store
 */

import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto"
import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { KEYTAR_ACCOUNT_NAME, KEYTAR_SERVICE_NAME } from "./constants.js"

/** @type {import('keytar') | null} */
let keytar = null

/**
 * Try to load keytar for native keychain access.
 * Falls back gracefully if not available.
 */
async function loadKeytar() {
	if (keytar !== null) return keytar

	try {
		// Dynamic import to avoid hard dependency
		const mod = await import("keytar")
		// ESM dynamic import returns { default: keytarModule }
		keytar = mod.default || mod
		return keytar
	} catch {
		// keytar not available (missing native dependencies)
		keytar = false
		return null
	}
}

// ============================================================================
// Fallback Encrypted File Storage
// ============================================================================

const ENCRYPTED_STORE_DIR = join(homedir(), ".lpm")
const ENCRYPTED_STORE_FILE = join(ENCRYPTED_STORE_DIR, ".credentials")
const SALT_FILE = join(ENCRYPTED_STORE_DIR, ".salt")

/**
 * Get or create encryption salt.
 * @returns {Buffer}
 */
function getOrCreateSalt() {
	if (existsSync(SALT_FILE)) {
		return readFileSync(SALT_FILE)
	}

	const salt = randomBytes(32)
	if (!existsSync(ENCRYPTED_STORE_DIR)) {
		mkdirSync(ENCRYPTED_STORE_DIR, { recursive: true, mode: 0o700 })
	}
	writeFileSync(SALT_FILE, salt, { mode: 0o600 })
	return salt
}

/**
 * Derive encryption key from machine-specific data.
 * Uses a combination of hostname, username, and random salt.
 * @returns {Buffer}
 */
function deriveKey() {
	const salt = getOrCreateSalt()
	// Use machine-specific data as part of the key derivation
	const machineId = `${homedir()}-${process.env.USER || "user"}`
	return scryptSync(machineId, salt, 32)
}

/**
 * Encrypt a value using AES-256-GCM.
 * @param {string} value - The value to encrypt
 * @returns {string} - Base64 encoded encrypted data
 */
function encrypt(value) {
	const key = deriveKey()
	const iv = randomBytes(16)
	const cipher = createCipheriv("aes-256-gcm", key, iv)

	let encrypted = cipher.update(value, "utf8", "base64")
	encrypted += cipher.final("base64")

	const authTag = cipher.getAuthTag()

	// Format: iv:authTag:encrypted
	return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`
}

/**
 * Decrypt a value using AES-256-GCM.
 * @param {string} encryptedValue - Base64 encoded encrypted data
 * @returns {string | null} - Decrypted value or null if failed
 */
function decrypt(encryptedValue) {
	try {
		const key = deriveKey()
		const [ivBase64, authTagBase64, encrypted] = encryptedValue.split(":")

		const iv = Buffer.from(ivBase64, "base64")
		const authTag = Buffer.from(authTagBase64, "base64")

		const decipher = createDecipheriv("aes-256-gcm", key, iv)
		decipher.setAuthTag(authTag)

		let decrypted = decipher.update(encrypted, "base64", "utf8")
		decrypted += decipher.final("utf8")

		return decrypted
	} catch {
		// Decryption failed (wrong key, corrupted data, etc.)
		return null
	}
}

/**
 * Read encrypted store from file.
 * @returns {Record<string, string>}
 */
function readEncryptedStore() {
	if (!existsSync(ENCRYPTED_STORE_FILE)) {
		return {}
	}

	try {
		const content = readFileSync(ENCRYPTED_STORE_FILE, "utf8")
		const decrypted = decrypt(content)
		if (!decrypted) return {}
		return JSON.parse(decrypted)
	} catch {
		return {}
	}
}

/**
 * Write encrypted store to file.
 * @param {Record<string, string>} store
 */
function writeEncryptedStore(store) {
	if (!existsSync(ENCRYPTED_STORE_DIR)) {
		mkdirSync(ENCRYPTED_STORE_DIR, { recursive: true, mode: 0o700 })
	}

	const content = encrypt(JSON.stringify(store))
	writeFileSync(ENCRYPTED_STORE_FILE, content, { mode: 0o600 })
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Store a secret securely.
 * Uses OS keychain if available, falls back to encrypted file.
 *
 * @param {string} key - The key to store the secret under
 * @param {string} value - The secret value
 * @returns {Promise<void>}
 */
export async function setSecret(key, value) {
	const kt = await loadKeytar()

	if (kt) {
		await kt.setPassword(KEYTAR_SERVICE_NAME, key, value)
		return
	}

	// Fallback to encrypted file
	const store = readEncryptedStore()
	store[key] = value
	writeEncryptedStore(store)
}

/**
 * Retrieve a secret.
 * Uses OS keychain if available, falls back to encrypted file.
 *
 * @param {string} key - The key to retrieve
 * @returns {Promise<string | null>}
 */
export async function getSecret(key) {
	const kt = await loadKeytar()

	if (kt) {
		return kt.getPassword(KEYTAR_SERVICE_NAME, key)
	}

	// Fallback to encrypted file
	const store = readEncryptedStore()
	return store[key] || null
}

/**
 * Delete a secret.
 * Uses OS keychain if available, falls back to encrypted file.
 *
 * @param {string} key - The key to delete
 * @returns {Promise<boolean>}
 */
export async function deleteSecret(key) {
	const kt = await loadKeytar()

	if (kt) {
		return kt.deletePassword(KEYTAR_SERVICE_NAME, key)
	}

	// Fallback to encrypted file
	const store = readEncryptedStore()
	if (key in store) {
		delete store[key]
		writeEncryptedStore(store)
		return true
	}
	return false
}

/**
 * Clear all stored secrets.
 * @returns {Promise<void>}
 */
export async function clearAllSecrets() {
	const kt = await loadKeytar()

	if (kt) {
		// keytar doesn't have a "clear all" - delete known keys
		await kt.deletePassword(KEYTAR_SERVICE_NAME, KEYTAR_ACCOUNT_NAME)
		return
	}

	// Fallback: delete the encrypted store file
	if (existsSync(ENCRYPTED_STORE_FILE)) {
		unlinkSync(ENCRYPTED_STORE_FILE)
	}
}

/**
 * Check if secure storage is using native keychain.
 * @returns {Promise<boolean>}
 */
export async function isUsingKeychain() {
	const kt = await loadKeytar()
	return kt !== null && kt !== false
}

// ============================================================================
// Token-Specific Helpers
// ============================================================================

/**
 * Get the stored auth token.
 * @returns {Promise<string | null>}
 */
export async function getToken() {
	return getSecret(KEYTAR_ACCOUNT_NAME)
}

/**
 * Set the auth token.
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function setToken(token) {
	return setSecret(KEYTAR_ACCOUNT_NAME, token)
}

/**
 * Clear the auth token.
 * @returns {Promise<boolean>}
 */
export async function clearToken() {
	return deleteSecret(KEYTAR_ACCOUNT_NAME)
}
