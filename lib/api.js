/**
 * API Client with Retry, Timeout, and Rate Limit Handling
 *
 * Provides robust network communication with:
 * - Configurable timeouts using AbortController
 * - Exponential backoff retry for transient failures
 * - Rate limit handling with Retry-After header support
 *
 * @module cli/lib/api
 */

import { getRegistryUrl, getRetries, getTimeout, getToken } from './config.js';
import {
  ERROR_MESSAGES,
  RATE_LIMIT_STATUS_CODES,
  RETRY_BACKOFF_MULTIPLIER,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  RETRYABLE_STATUS_CODES,
} from './constants.js';

/**
 * Sleep for a specified duration.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay.
 * @param {number} attempt - Current attempt number (0-based)
 * @returns {number} - Delay in milliseconds
 */
function getBackoffDelay(attempt) {
  const delay = RETRY_BASE_DELAY_MS * RETRY_BACKOFF_MULTIPLIER ** attempt;
  // Add jitter (±10%)
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, RETRY_MAX_DELAY_MS);
}

/**
 * Parse Retry-After header value.
 * @param {string | null} retryAfter - Header value (seconds or HTTP date)
 * @returns {number} - Delay in milliseconds
 */
function parseRetryAfter(retryAfter) {
  if (!retryAfter) return RETRY_BASE_DELAY_MS;

  // Try parsing as seconds
  const seconds = parseInt(retryAfter, 10);
  if (!Number.isNaN(seconds)) {
    return seconds * 1000;
  }

  // Try parsing as HTTP date
  const date = new Date(retryAfter);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return RETRY_BASE_DELAY_MS;
}

/**
 * @typedef {Object} RequestOptions
 * @property {Record<string, string>} [headers] - Request headers
 * @property {string} [method] - HTTP method
 * @property {string | Buffer} [body] - Request body
 * @property {boolean} [skipRetry] - Skip retry logic for this request
 * @property {number} [timeout] - Override default timeout
 * @property {(attempt: number, maxRetries: number) => void} [onRetry] - Callback when retrying
 * @property {(seconds: number) => void} [onRateLimited] - Callback when rate limited
 */

/**
 * Make an API request with timeout, retry, and rate limit handling.
 *
 * @param {string} path - API path (will be prefixed with /api/registry)
 * @param {RequestOptions} [options={}] - Request options
 * @returns {Promise<import('node-fetch').Response>}
 * @throws {Error} On network failure, timeout, or authentication error
 */
export async function request(path, options = {}) {
  const token = await getToken();
  const registryUrl = getRegistryUrl();
  const url = `${registryUrl}/api/registry${path}`;
  const maxRetries = options.skipRetry ? 0 : getRetries();
  const timeout = options.timeout ?? getTimeout();

  const headers = {
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle authentication errors immediately (no retry)
      if (response.status === 401) {
        throw new Error(ERROR_MESSAGES.notAuthenticated);
      }

      if (response.status === 403) {
        const data = await response.json().catch(() => ({}));
        const errorMessage = data.error || 'Access denied.';

        // Check for license/purchase required error
        const purchaseMatch = errorMessage.match(
          /Package (@[^/]+\/[^\s]+) requires purchase/,
        );
        if (purchaseMatch) {
          const pkgName = purchaseMatch[1];
          const registryUrl = getRegistryUrl();
          throw new Error(
            `${errorMessage}\n  Purchase: ${registryUrl}/${pkgName.replace('@', '')}`,
          );
        }

        throw new Error(errorMessage);
      }

      // Handle rate limiting
      if (RATE_LIMIT_STATUS_CODES.includes(response.status)) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = parseRetryAfter(retryAfter);
        const delaySec = Math.ceil(delayMs / 1000);

        if (options.onRateLimited) {
          options.onRateLimited(delaySec);
        }

        // Only retry if we have attempts left
        if (attempt < maxRetries) {
          await sleep(delayMs);
          continue;
        }

        throw new Error(ERROR_MESSAGES.rateLimited);
      }

      // Handle retryable server errors
      if (
        RETRYABLE_STATUS_CODES.includes(response.status) &&
        attempt < maxRetries
      ) {
        const delay = getBackoffDelay(attempt);

        if (options.onRetry) {
          options.onRetry(attempt + 1, maxRetries);
        }

        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle abort (timeout)
      if (error.name === 'AbortError') {
        lastError = new Error(ERROR_MESSAGES.timeout);

        if (attempt < maxRetries) {
          const delay = getBackoffDelay(attempt);
          if (options.onRetry) {
            options.onRetry(attempt + 1, maxRetries);
          }
          await sleep(delay);
          continue;
        }

        throw lastError;
      }

      // Handle network errors
      if (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND' ||
        error.type === 'system'
      ) {
        lastError = new Error(ERROR_MESSAGES.networkError);

        if (attempt < maxRetries) {
          const delay = getBackoffDelay(attempt);
          if (options.onRetry) {
            options.onRetry(attempt + 1, maxRetries);
          }
          await sleep(delay);
          continue;
        }

        throw lastError;
      }

      // Re-throw other errors (like auth errors)
      throw error;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new Error(ERROR_MESSAGES.networkError);
}

/**
 * Make a GET request.
 * @param {string} path - API path
 * @param {RequestOptions} [options={}] - Request options
 * @returns {Promise<import('node-fetch').Response>}
 */
export function get(path, options = {}) {
  return request(path, { ...options, method: 'GET' });
}

/**
 * Make a POST request with JSON body.
 * @param {string} path - API path
 * @param {unknown} data - Request body (will be JSON serialized)
 * @param {RequestOptions} [options={}] - Request options
 * @returns {Promise<import('node-fetch').Response>}
 */
export function post(path, data, options = {}) {
  return request(path, {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify(data),
  });
}

/**
 * Make a PUT request with JSON body.
 * @param {string} path - API path
 * @param {unknown} data - Request body (will be JSON serialized)
 * @param {RequestOptions} [options={}] - Request options
 * @returns {Promise<import('node-fetch').Response>}
 */
export function put(path, data, options = {}) {
  return request(path, {
    ...options,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: JSON.stringify(data),
  });
}

/**
 * Check token validity and scopes.
 * @returns {Promise<{valid: boolean, scopes?: string[], user?: string, error?: string}>}
 */
export async function checkToken() {
  try {
    const response = await get('/cli/check', { skipRetry: true });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { valid: false, error: data.error || 'Token validation failed' };
    }

    const data = await response.json();
    return { valid: true, ...data };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Verify token has required scope before an operation.
 * @param {string} requiredScope - The scope to check for
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
export async function verifyTokenScope(requiredScope) {
  const result = await checkToken();

  if (!result.valid) {
    return { valid: false, error: result.error };
  }

  const scopes = result.scopes || [];
  const hasScope = scopes.includes(requiredScope) || scopes.includes('full');

  if (!hasScope) {
    return {
      valid: false,
      error: ERROR_MESSAGES.tokenMissingScope(requiredScope),
    };
  }

  return { valid: true };
}
