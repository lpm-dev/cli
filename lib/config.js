/**
 * CLI Configuration Management
 *
 * Handles both secure credential storage and general configuration.
 * Token storage migrated to secure-store for keychain integration.
 *
 * @module cli/lib/config
 */

import Conf from "conf"
import {
	DEFAULT_REGISTRY_URL,
	MAX_RETRIES,
	REQUEST_TIMEOUT_MS,
} from "./constants.js"
import {
	isUsingKeychain,
	clearToken as secureClearToken,
	getToken as secureGetToken,
	setToken as secureSetToken,
} from "./secure-store.js"

// ============================================================================
// General Configuration Store (non-sensitive data)
// ============================================================================

const config = new Conf({
	projectName: "lpm-cli",
	defaults: {
		registryUrl: DEFAULT_REGISTRY_URL,
		timeout: REQUEST_TIMEOUT_MS,
		retries: MAX_RETRIES,
	},
})

// ============================================================================
// Token Management (Secure Storage)
// ============================================================================

/**
 * Transient token — set for the duration of an OIDC-authenticated publish.
 * Takes priority over all other token sources so the short-lived OIDC token
 * is used without writing to keychain or mutating process.env.
 * @type {string | null}
 */
let _transientToken = null

/**
 * Set a transient token that overrides all other token sources.
 * Used by OIDC token exchange to inject a short-lived publish token.
 * @param {string} token
 */
export function setTransientToken(token) {
	_transientToken = token
}

/**
 * Clear the transient token after use.
 */
export function clearTransientToken() {
	_transientToken = null
}

/**
 * Get the stored auth token from secure storage.
 * Priority: transient (OIDC) > LPM_TOKEN env var > secure storage > legacy storage
 * Tokens are scoped per registry URL so dev and production don't collide.
 * @returns {Promise<string | null>}
 */
export async function getToken() {
	// OIDC-exchanged short-lived token takes highest priority
	if (_transientToken) return _transientToken

	// Check environment variable first (useful for CI/CD and testing)
	const envToken = process.env.LPM_TOKEN
	if (envToken) return envToken

	const registryUrl = getRegistryUrl()

	// Try secure store (registry-scoped)
	const secureToken = await secureGetToken(registryUrl)
	if (secureToken) return secureToken

	// Migration: check if token exists in old Conf storage
	const legacyToken = config.get("token")
	if (legacyToken) {
		// Migrate to secure storage (scoped to current registry)
		await secureSetToken(legacyToken, registryUrl)
		config.delete("token")
		return legacyToken
	}

	return null
}

/**
 * Set the auth token in secure storage (scoped to current registry).
 * @param {string | null} token
 * @returns {Promise<void>}
 */
export async function setToken(token) {
	const registryUrl = getRegistryUrl()
	if (token === null) {
		await secureClearToken(registryUrl)
	} else {
		await secureSetToken(token, registryUrl)
	}
	// Ensure legacy token is cleared
	config.delete("token")
}

/**
 * Clear the auth token from secure storage (scoped to current registry).
 * @returns {Promise<void>}
 */
export async function clearToken() {
	await secureClearToken(getRegistryUrl())
	config.delete("token")
}

// ============================================================================
// Registry URL Configuration
// ============================================================================

/**
 * Get the registry URL.
 * Priority: LPM_REGISTRY_URL env var > stored config > default
 * @returns {string}
 */
export function getRegistryUrl() {
	// Check environment variables first (useful for CI/CD and testing)
	const envUrl = process.env.LPM_REGISTRY_URL
	if (envUrl) return envUrl

	return config.get("registryUrl", DEFAULT_REGISTRY_URL)
}

/**
 * Set the registry URL.
 * @param {string} url
 */
export function setRegistryUrl(url) {
	config.set("registryUrl", url)
}

// ============================================================================
// Timeout Configuration
// ============================================================================

/**
 * Get the request timeout in milliseconds.
 * @returns {number}
 */
export function getTimeout() {
	return config.get("timeout", REQUEST_TIMEOUT_MS)
}

/**
 * Set the request timeout in milliseconds.
 * @param {number} ms
 */
export function setTimeout(ms) {
	config.set("timeout", ms)
}

// ============================================================================
// Retry Configuration
// ============================================================================

/**
 * Get the maximum retry count.
 * @returns {number}
 */
export function getRetries() {
	return config.get("retries", MAX_RETRIES)
}

/**
 * Set the maximum retry count.
 * @param {number} count
 */
export function setRetries(count) {
	config.set("retries", count)
}

// ============================================================================
// Package Manager Configuration
// ============================================================================

const VALID_PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"])
const DEFAULT_PACKAGE_MANAGER = "npm"

/**
 * Get the configured package manager for install/uninstall operations.
 * Priority: --pm flag > LPM_PACKAGE_MANAGER env > config > "npm"
 * @param {string} [override] - CLI flag override (--pm value)
 * @returns {string}
 */
export function getPackageManager(override) {
	const pm =
		override ||
		process.env.LPM_PACKAGE_MANAGER ||
		config.get("packageManager", DEFAULT_PACKAGE_MANAGER)

	if (!VALID_PACKAGE_MANAGERS.has(pm)) {
		return DEFAULT_PACKAGE_MANAGER
	}

	return pm
}

// ============================================================================
// General Configuration Access
// ============================================================================

/**
 * Get all configuration values.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function getAllConfig() {
	const usingKeychain = await isUsingKeychain()
	const hasToken = !!(await getToken())

	return {
		registryUrl: getRegistryUrl(),
		packageManager: getPackageManager(),
		timeout: getTimeout(),
		retries: getRetries(),
		secureStorage: usingKeychain ? "keychain" : "encrypted-file",
		authenticated: hasToken,
	}
}

/**
 * Get a specific configuration value.
 * @param {string} key
 * @returns {unknown}
 */
export function getConfigValue(key) {
	const configMap = {
		registry: getRegistryUrl,
		registryUrl: getRegistryUrl,
		packageManager: getPackageManager,
		timeout: getTimeout,
		retries: getRetries,
	}

	const getter = configMap[key]
	if (getter) return getter()
	return config.get(key)
}

/**
 * Set a specific configuration value.
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean} - True if set successfully
 */
export function setConfigValue(key, value) {
	const configMap = {
		registry: setRegistryUrl,
		registryUrl: setRegistryUrl,
		packageManager: val => {
			if (VALID_PACKAGE_MANAGERS.has(val)) {
				config.set("packageManager", val)
			} else {
				throw new Error(
					`Invalid package manager "${val}". Valid options: ${[...VALID_PACKAGE_MANAGERS].join(", ")}`,
				)
			}
		},
		timeout: val => setTimeout(Number(val)),
		retries: val => setRetries(Number(val)),
	}

	const setter = configMap[key]
	if (setter) {
		setter(value)
		return true
	}

	// Allow setting arbitrary config values
	config.set(key, value)
	return true
}

/**
 * Delete a specific configuration value.
 * @param {string} key
 * @returns {boolean} - True if deleted
 */
export function deleteConfigValue(key) {
	const protectedKeys = ["registryUrl", "registry", "timeout", "retries"]
	if (protectedKeys.includes(key)) {
		// Reset to default instead of deleting
		const defaults = {
			registryUrl: DEFAULT_REGISTRY_URL,
			registry: DEFAULT_REGISTRY_URL,
			timeout: REQUEST_TIMEOUT_MS,
			retries: MAX_RETRIES,
		}
		config.set(key === "registry" ? "registryUrl" : key, defaults[key])
		return true
	}

	config.delete(key)
	return true
}
