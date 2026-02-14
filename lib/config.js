/**
 * CLI Configuration Management
 *
 * Handles both secure credential storage and general configuration.
 * Token storage migrated to secure-store for keychain integration.
 *
 * @module cli/lib/config
 */

import Conf from 'conf';
import {
  DEFAULT_REGISTRY_URL,
  MAX_RETRIES,
  REQUEST_TIMEOUT_MS,
} from './constants.js';
import {
  isUsingKeychain,
  clearToken as secureClearToken,
  getToken as secureGetToken,
  setToken as secureSetToken,
} from './secure-store.js';

// ============================================================================
// General Configuration Store (non-sensitive data)
// ============================================================================

const config = new Conf({
  projectName: 'lpm-cli',
  defaults: {
    registryUrl: DEFAULT_REGISTRY_URL,
    timeout: REQUEST_TIMEOUT_MS,
    retries: MAX_RETRIES,
  },
});

// ============================================================================
// Token Management (Secure Storage)
// ============================================================================

/**
 * Get the stored auth token from secure storage.
 * Priority: LPM_TOKEN env var > secure storage > legacy storage
 * @returns {Promise<string | null>}
 */
export async function getToken() {
  // Check environment variable first (useful for CI/CD and testing)
  const envToken = process.env.LPM_TOKEN;
  if (envToken) return envToken;

  // Try secure store
  const secureToken = await secureGetToken();
  if (secureToken) return secureToken;

  // Migration: check if token exists in old storage
  const legacyToken = config.get('token');
  if (legacyToken) {
    // Migrate to secure storage
    await secureSetToken(legacyToken);
    config.delete('token');
    return legacyToken;
  }

  return null;
}

/**
 * Set the auth token in secure storage.
 * @param {string | null} token
 * @returns {Promise<void>}
 */
export async function setToken(token) {
  if (token === null) {
    await secureClearToken();
  } else {
    await secureSetToken(token);
  }
  // Ensure legacy token is cleared
  config.delete('token');
}

/**
 * Clear the auth token from secure storage.
 * @returns {Promise<void>}
 */
export async function clearToken() {
  await secureClearToken();
  config.delete('token');
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
  const envUrl = process.env.LPM_REGISTRY_URL;
  if (envUrl) return envUrl;

  return config.get('registryUrl', DEFAULT_REGISTRY_URL);
}

/**
 * Set the registry URL.
 * @param {string} url
 */
export function setRegistryUrl(url) {
  config.set('registryUrl', url);
}

// ============================================================================
// Timeout Configuration
// ============================================================================

/**
 * Get the request timeout in milliseconds.
 * @returns {number}
 */
export function getTimeout() {
  return config.get('timeout', REQUEST_TIMEOUT_MS);
}

/**
 * Set the request timeout in milliseconds.
 * @param {number} ms
 */
export function setTimeout(ms) {
  config.set('timeout', ms);
}

// ============================================================================
// Retry Configuration
// ============================================================================

/**
 * Get the maximum retry count.
 * @returns {number}
 */
export function getRetries() {
  return config.get('retries', MAX_RETRIES);
}

/**
 * Set the maximum retry count.
 * @param {number} count
 */
export function setRetries(count) {
  config.set('retries', count);
}

// ============================================================================
// General Configuration Access
// ============================================================================

/**
 * Get all configuration values.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function getAllConfig() {
  const usingKeychain = await isUsingKeychain();
  const hasToken = !!(await getToken());

  return {
    registryUrl: getRegistryUrl(),
    timeout: getTimeout(),
    retries: getRetries(),
    secureStorage: usingKeychain ? 'keychain' : 'encrypted-file',
    authenticated: hasToken,
  };
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
    timeout: getTimeout,
    retries: getRetries,
  };

  const getter = configMap[key];
  if (getter) return getter();
  return config.get(key);
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
    timeout: val => setTimeout(Number(val)),
    retries: val => setRetries(Number(val)),
  };

  const setter = configMap[key];
  if (setter) {
    setter(value);
    return true;
  }

  // Allow setting arbitrary config values
  config.set(key, value);
  return true;
}

/**
 * Delete a specific configuration value.
 * @param {string} key
 * @returns {boolean} - True if deleted
 */
export function deleteConfigValue(key) {
  const protectedKeys = ['registryUrl', 'registry', 'timeout', 'retries'];
  if (protectedKeys.includes(key)) {
    // Reset to default instead of deleting
    const defaults = {
      registryUrl: DEFAULT_REGISTRY_URL,
      registry: DEFAULT_REGISTRY_URL,
      timeout: REQUEST_TIMEOUT_MS,
      retries: MAX_RETRIES,
    };
    config.set(key === 'registry' ? 'registryUrl' : key, defaults[key]);
    return true;
  }

  config.delete(key);
  return true;
}
