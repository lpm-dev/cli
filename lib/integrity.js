/**
 * Tarball Integrity Verification
 *
 * Provides cryptographic hash verification for downloaded packages.
 * Supports SHA-256, SHA-384, and SHA-512 algorithms.
 *
 * @module cli/lib/integrity
 */

import { createHash } from "node:crypto"
import {
	DEFAULT_HASH_ALGORITHM,
	ERROR_MESSAGES,
	SUPPORTED_HASH_ALGORITHMS,
} from "./constants.js"

/**
 * Parse an integrity string (SRI format).
 * Format: algorithm-base64hash
 * Example: sha512-abc123...
 *
 * @param {string} integrity - The integrity string
 * @returns {{ algorithm: string, hash: string } | null}
 */
export function parseIntegrity(integrity) {
	if (!integrity || typeof integrity !== "string") {
		return null
	}

	const match = integrity.match(/^(sha256|sha384|sha512)-(.+)$/i)
	if (!match) {
		return null
	}

	const [, algorithm, hash] = match
	return {
		algorithm: algorithm.toLowerCase(),
		hash,
	}
}

/**
 * Calculate the hash of a buffer.
 *
 * @param {Buffer} buffer - The data to hash
 * @param {string} [algorithm='sha512'] - Hash algorithm
 * @returns {string} - Base64 encoded hash
 */
export function calculateHash(buffer, algorithm = DEFAULT_HASH_ALGORITHM) {
	if (!SUPPORTED_HASH_ALGORITHMS.includes(algorithm)) {
		throw new Error(`Unsupported hash algorithm: ${algorithm}`)
	}

	return createHash(algorithm).update(buffer).digest("base64")
}

/**
 * Generate an integrity string (SRI format) for a buffer.
 *
 * @param {Buffer} buffer - The data to hash
 * @param {string} [algorithm='sha512'] - Hash algorithm
 * @returns {string} - Integrity string (e.g., 'sha512-abc123...')
 */
export function generateIntegrity(buffer, algorithm = DEFAULT_HASH_ALGORITHM) {
	const hash = calculateHash(buffer, algorithm)
	return `${algorithm}-${hash}`
}

/**
 * Verify the integrity of a buffer against an expected hash.
 *
 * @param {Buffer} buffer - The data to verify
 * @param {string} expectedIntegrity - Expected integrity string (SRI format)
 * @returns {{ valid: boolean, error?: string, actual?: string }}
 */
export function verifyIntegrity(buffer, expectedIntegrity) {
	const parsed = parseIntegrity(expectedIntegrity)

	if (!parsed) {
		return {
			valid: false,
			error: "Invalid integrity format. Expected format: algorithm-base64hash",
		}
	}

	const { algorithm, hash: expectedHash } = parsed
	const actualHash = calculateHash(buffer, algorithm)

	if (actualHash !== expectedHash) {
		return {
			valid: false,
			error: ERROR_MESSAGES.integrityMismatch,
			actual: `${algorithm}-${actualHash}`,
		}
	}

	return { valid: true }
}

/**
 * Verify integrity with multiple allowed hashes.
 * Useful when a package may have multiple valid integrity values.
 *
 * @param {Buffer} buffer - The data to verify
 * @param {string[]} integrities - Array of valid integrity strings
 * @returns {{ valid: boolean, matchedIntegrity?: string, error?: string }}
 */
export function verifyIntegrityMultiple(buffer, integrities) {
	if (!integrities || integrities.length === 0) {
		return { valid: false, error: "No integrity values provided" }
	}

	for (const integrity of integrities) {
		const result = verifyIntegrity(buffer, integrity)
		if (result.valid) {
			return { valid: true, matchedIntegrity: integrity }
		}
	}

	return {
		valid: false,
		error: ERROR_MESSAGES.integrityMismatch,
	}
}

/**
 * Create a streaming hash verifier.
 * Useful for large files where buffering the entire file is not practical.
 *
 * @param {string} [algorithm='sha512'] - Hash algorithm
 * @returns {{ update: (chunk: Buffer) => void, verify: (expectedIntegrity: string) => { valid: boolean, error?: string } }}
 */
export function createStreamVerifier(algorithm = DEFAULT_HASH_ALGORITHM) {
	const hash = createHash(algorithm)

	return {
		/**
		 * Update the hash with a chunk of data.
		 * @param {Buffer} chunk
		 */
		update(chunk) {
			hash.update(chunk)
		},

		/**
		 * Finalize and verify against expected integrity.
		 * @param {string} expectedIntegrity
		 * @returns {{ valid: boolean, error?: string, actual?: string }}
		 */
		verify(expectedIntegrity) {
			const parsed = parseIntegrity(expectedIntegrity)
			if (!parsed) {
				return {
					valid: false,
					error: "Invalid integrity format",
				}
			}

			// Algorithm must match
			if (parsed.algorithm !== algorithm) {
				return {
					valid: false,
					error: `Algorithm mismatch: expected ${parsed.algorithm}, got ${algorithm}`,
				}
			}

			const actualHash = hash.digest("base64")
			if (actualHash !== parsed.hash) {
				return {
					valid: false,
					error: ERROR_MESSAGES.integrityMismatch,
					actual: `${algorithm}-${actualHash}`,
				}
			}

			return { valid: true }
		},
	}
}
