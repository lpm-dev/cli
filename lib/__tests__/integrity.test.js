import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
	calculateHash,
	createStreamVerifier,
	generateIntegrity,
	parseIntegrity,
	verifyIntegrity,
	verifyIntegrityMultiple,
} from "../integrity.js"

// ============================================================================
// parseIntegrity
// ============================================================================

describe("parseIntegrity", () => {
	it("parses a valid sha512 integrity string", () => {
		const result = parseIntegrity("sha512-abc123def456")
		expect(result).toEqual({ algorithm: "sha512", hash: "abc123def456" })
	})

	it("parses a valid sha256 integrity string", () => {
		const result = parseIntegrity("sha256-xyz789")
		expect(result).toEqual({ algorithm: "sha256", hash: "xyz789" })
	})

	it("parses a valid sha384 integrity string", () => {
		const result = parseIntegrity("sha384-foobar")
		expect(result).toEqual({ algorithm: "sha384", hash: "foobar" })
	})

	it("is case-insensitive for algorithm", () => {
		const result = parseIntegrity("SHA512-abc123")
		expect(result).toEqual({ algorithm: "sha512", hash: "abc123" })
	})

	it("returns null for null input", () => {
		expect(parseIntegrity(null)).toBeNull()
	})

	it("returns null for empty string", () => {
		expect(parseIntegrity("")).toBeNull()
	})

	it("returns null for non-string input", () => {
		expect(parseIntegrity(123)).toBeNull()
	})

	it("returns null for invalid format (no dash)", () => {
		expect(parseIntegrity("sha512abc123")).toBeNull()
	})

	it("returns null for unsupported algorithm", () => {
		expect(parseIntegrity("md5-abc123")).toBeNull()
	})
})

// ============================================================================
// calculateHash
// ============================================================================

describe("calculateHash", () => {
	const testBuffer = Buffer.from("hello world")

	it("calculates sha512 hash by default", () => {
		const expected = createHash("sha512").update(testBuffer).digest("base64")
		expect(calculateHash(testBuffer)).toBe(expected)
	})

	it("calculates sha256 hash", () => {
		const expected = createHash("sha256").update(testBuffer).digest("base64")
		expect(calculateHash(testBuffer, "sha256")).toBe(expected)
	})

	it("calculates sha384 hash", () => {
		const expected = createHash("sha384").update(testBuffer).digest("base64")
		expect(calculateHash(testBuffer, "sha384")).toBe(expected)
	})

	it("throws for unsupported algorithm", () => {
		expect(() => calculateHash(testBuffer, "md5")).toThrow(
			"Unsupported hash algorithm",
		)
	})

	it("produces consistent output for same input", () => {
		const hash1 = calculateHash(testBuffer)
		const hash2 = calculateHash(testBuffer)
		expect(hash1).toBe(hash2)
	})

	it("produces different output for different input", () => {
		const hash1 = calculateHash(Buffer.from("hello"))
		const hash2 = calculateHash(Buffer.from("world"))
		expect(hash1).not.toBe(hash2)
	})
})

// ============================================================================
// generateIntegrity
// ============================================================================

describe("generateIntegrity", () => {
	const testBuffer = Buffer.from("test data")

	it("generates SRI format with default sha512", () => {
		const result = generateIntegrity(testBuffer)
		expect(result).toMatch(/^sha512-.+$/)
	})

	it("generates SRI format with sha256", () => {
		const result = generateIntegrity(testBuffer, "sha256")
		expect(result).toMatch(/^sha256-.+$/)
	})

	it("matches calculateHash output", () => {
		const hash = calculateHash(testBuffer, "sha512")
		const integrity = generateIntegrity(testBuffer, "sha512")
		expect(integrity).toBe(`sha512-${hash}`)
	})
})

// ============================================================================
// verifyIntegrity
// ============================================================================

describe("verifyIntegrity", () => {
	const testBuffer = Buffer.from("hello world")
	const validIntegrity = generateIntegrity(testBuffer, "sha512")

	it("returns valid for matching integrity", () => {
		const result = verifyIntegrity(testBuffer, validIntegrity)
		expect(result).toEqual({ valid: true })
	})

	it("returns invalid for mismatching integrity", () => {
		const result = verifyIntegrity(Buffer.from("different"), validIntegrity)
		expect(result.valid).toBe(false)
		expect(result.error).toBeDefined()
		expect(result.actual).toMatch(/^sha512-/)
	})

	it("returns invalid for invalid format", () => {
		const result = verifyIntegrity(testBuffer, "not-valid-format")
		expect(result.valid).toBe(false)
		expect(result.error).toContain("Invalid integrity format")
	})

	it("works with sha256", () => {
		const integrity = generateIntegrity(testBuffer, "sha256")
		const result = verifyIntegrity(testBuffer, integrity)
		expect(result).toEqual({ valid: true })
	})
})

// ============================================================================
// verifyIntegrityMultiple
// ============================================================================

describe("verifyIntegrityMultiple", () => {
	const testBuffer = Buffer.from("hello world")
	const validIntegrity = generateIntegrity(testBuffer, "sha512")
	const wrongIntegrity = "sha512-wronghashvalue"

	it("returns valid when first integrity matches", () => {
		const result = verifyIntegrityMultiple(testBuffer, [
			validIntegrity,
			wrongIntegrity,
		])
		expect(result.valid).toBe(true)
		expect(result.matchedIntegrity).toBe(validIntegrity)
	})

	it("returns valid when second integrity matches", () => {
		const result = verifyIntegrityMultiple(testBuffer, [
			wrongIntegrity,
			validIntegrity,
		])
		expect(result.valid).toBe(true)
		expect(result.matchedIntegrity).toBe(validIntegrity)
	})

	it("returns invalid when none match", () => {
		const result = verifyIntegrityMultiple(testBuffer, [
			wrongIntegrity,
			"sha256-anotherwrong",
		])
		expect(result.valid).toBe(false)
		expect(result.error).toBeDefined()
	})

	it("returns invalid for empty array", () => {
		const result = verifyIntegrityMultiple(testBuffer, [])
		expect(result.valid).toBe(false)
		expect(result.error).toContain("No integrity values provided")
	})

	it("returns invalid for null/undefined", () => {
		const result = verifyIntegrityMultiple(testBuffer, null)
		expect(result.valid).toBe(false)
	})
})

// ============================================================================
// createStreamVerifier
// ============================================================================

describe("createStreamVerifier", () => {
	const testData = "hello world stream data"
	const testBuffer = Buffer.from(testData)

	it("verifies chunked data matches whole-buffer hash", () => {
		const integrity = generateIntegrity(testBuffer, "sha512")
		const verifier = createStreamVerifier("sha512")

		// Feed data in chunks
		verifier.update(Buffer.from("hello "))
		verifier.update(Buffer.from("world "))
		verifier.update(Buffer.from("stream data"))

		const result = verifier.verify(integrity)
		expect(result).toEqual({ valid: true })
	})

	it("detects mismatched data", () => {
		const integrity = generateIntegrity(testBuffer, "sha512")
		const verifier = createStreamVerifier("sha512")

		verifier.update(Buffer.from("different data"))

		const result = verifier.verify(integrity)
		expect(result.valid).toBe(false)
		expect(result.actual).toMatch(/^sha512-/)
	})

	it("returns error for algorithm mismatch", () => {
		const integrity = generateIntegrity(testBuffer, "sha256")
		const verifier = createStreamVerifier("sha512")

		verifier.update(testBuffer)

		const result = verifier.verify(integrity)
		expect(result.valid).toBe(false)
		expect(result.error).toContain("Algorithm mismatch")
	})

	it("returns error for invalid integrity format", () => {
		const verifier = createStreamVerifier("sha512")
		verifier.update(testBuffer)

		const result = verifier.verify("not-valid")
		expect(result.valid).toBe(false)
		expect(result.error).toContain("Invalid integrity format")
	})
})
