/**
 * Tier-2 integrity-gate tests for scripts/install-binary.js.
 *
 * The suite mocks the network primitives (`download`, `downloadToBuffer`,
 * `sha256File`, `tryVerifyManifestSignature`) via the dependency-injection
 * `deps` parameter on `tryGitHubDownload`. No real network calls fire.
 *
 * Coverage:
 *   - happy path: manifest SHA matches → binary installed.
 *   - manifest 404 → return null (falls through to JS CLI fallback).
 *   - SHA mismatch → return null + tmp file cleaned up.
 *   - manifest missing the platform binary entry → return null.
 *   - Sigstore verifier rejected → return null.
 *   - Sigstore package unavailable → SHA-only path runs, WARN logged.
 *   - Sigstore verified → both gates surface.
 *   - LPM_INSTALL_INSECURE=1 → all integrity skipped, install proceeds.
 *
 * Pure-helper coverage:
 *   - parseManifestEntry: canonical, malformed, missing-platform.
 */

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { parseManifestEntry, tryGitHubDownload } from "../install-binary.js"

function sha256(bytes) {
	return crypto.createHash("sha256").update(bytes).digest("hex")
}

describe("parseManifestEntry", () => {
	it("returns the SHA for a matching filename", () => {
		const manifest =
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  lpm-darwin-arm64\n" +
			"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  lpm-linux-x64\n"
		expect(parseManifestEntry(manifest, "lpm-linux-x64")).toBe(
			"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		)
	})

	it("returns null when the filename is not enumerated", () => {
		const manifest =
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  lpm-darwin-arm64\n"
		expect(parseManifestEntry(manifest, "lpm-linux-x64")).toBeNull()
	})

	it("returns null on malformed lines (short digest)", () => {
		const manifest = "abc  lpm-linux-x64\n"
		expect(parseManifestEntry(manifest, "lpm-linux-x64")).toBeNull()
	})

	it("returns null on malformed lines (non-hex)", () => {
		const manifest =
			"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz  lpm-linux-x64\n"
		expect(parseManifestEntry(manifest, "lpm-linux-x64")).toBeNull()
	})

	it("returns null on malformed lines (single-space separator)", () => {
		const manifest =
			"0000000000000000000000000000000000000000000000000000000000000000 lpm-linux-x64\n"
		expect(parseManifestEntry(manifest, "lpm-linux-x64")).toBeNull()
	})

	it("strips trailing carriage returns for Windows-format manifests", () => {
		const manifest =
			"1111111111111111111111111111111111111111111111111111111111111111  lpm-darwin-arm64\r\n"
		expect(parseManifestEntry(manifest, "lpm-darwin-arm64")).toBe(
			"1111111111111111111111111111111111111111111111111111111111111111",
		)
	})

	it("lowercases hex digests", () => {
		const manifest =
			"ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890  X\n"
		expect(parseManifestEntry(manifest, "X")).toBe(
			"abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
		)
	})
})

describe("tryGitHubDownload", () => {
	let tmpBinDir
	let assetBytes
	let assetSha
	let manifestText
	let priorInsecure

	beforeEach(() => {
		tmpBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "lpm-install-binary-"))
		assetBytes = Buffer.from("native-binary-fixture-bytes")
		assetSha = sha256(assetBytes)
		manifestText = `${assetSha}  lpm-linux-x64\n`
		priorInsecure = process.env.LPM_INSTALL_INSECURE
		delete process.env.LPM_INSTALL_INSECURE
		// Stub console.log so the test output stays clean. Replace
		// per-test so individual cases can re-bind to capture lines.
		vi.spyOn(console, "log").mockImplementation(() => {})
	})

	afterEach(() => {
		fs.rmSync(tmpBinDir, { recursive: true, force: true })
		if (priorInsecure === undefined) {
			delete process.env.LPM_INSTALL_INSECURE
		} else {
			process.env.LPM_INSTALL_INSECURE = priorInsecure
		}
		vi.restoreAllMocks()
	})

	function mkDeps(overrides = {}) {
		return {
			destDir: tmpBinDir,
			download: vi.fn(async (_url, dest) => {
				fs.writeFileSync(dest, assetBytes)
			}),
			downloadToBuffer: vi.fn(async url => {
				if (url.endsWith("SHA256SUMS.txt")) {
					return Buffer.from(manifestText, "utf-8")
				}
				if (url.endsWith("SHA256SUMS.txt.sigstore")) {
					return Buffer.from("dummy-bundle-bytes")
				}
				throw Object.assign(new Error("not mocked"), { statusCode: 404 })
			}),
			sha256File: vi.fn(async filePath => sha256(fs.readFileSync(filePath))),
			tryVerifyManifestSignature: vi.fn(async () => "unavailable"),
			...overrides,
		}
	}

	it("installs the verified binary when SHA matches and Sigstore is unavailable", async () => {
		const deps = mkDeps()
		const result = await tryGitHubDownload("0.42.0", "lpm-linux-x64", deps)
		expect(result).toBeTruthy()
		expect(fs.existsSync(result)).toBe(true)
		// The installed bytes must match the verified bytes — guards
		// against a regression that "verifies" but installs garbage.
		expect(fs.readFileSync(result)).toEqual(assetBytes)
		expect(deps.downloadToBuffer).toHaveBeenCalledTimes(2)
		expect(deps.sha256File).toHaveBeenCalledTimes(1)
	})

	it("returns null when the manifest is 404 (predates signed-install gate)", async () => {
		const deps = mkDeps({
			downloadToBuffer: vi.fn(async url => {
				if (url.endsWith("SHA256SUMS.txt")) {
					throw Object.assign(new Error("HTTP 404"), { statusCode: 404 })
				}
				return Buffer.from("never reached")
			}),
		})
		const result = await tryGitHubDownload("0.42.0", "lpm-linux-x64", deps)
		expect(result).toBeNull()
		// Asset must NOT have been fetched once we know the manifest
		// is missing — releases that predate the gate are install-via-
		// manual-link, not silently downgraded to unsigned.
		expect(deps.download).not.toHaveBeenCalled()
	})

	it("returns null and cleans up the tmp file when SHA mismatches", async () => {
		const wrongSha =
			"0000000000000000000000000000000000000000000000000000000000000000"
		const deps = mkDeps({
			downloadToBuffer: vi.fn(async url => {
				if (url.endsWith("SHA256SUMS.txt")) {
					return Buffer.from(`${wrongSha}  lpm-linux-x64\n`, "utf-8")
				}
				return Buffer.from("dummy-bundle-bytes")
			}),
		})
		const result = await tryGitHubDownload("0.42.0", "lpm-linux-x64", deps)
		expect(result).toBeNull()
		expect(deps.download).toHaveBeenCalledTimes(1)
		// destDir must be empty — the rejected binary's tmp file must be
		// cleaned up so no partially-downloaded asset survives the gate.
		expect(fs.readdirSync(tmpBinDir)).toEqual([])
	})

	it("returns null when the manifest does not enumerate the platform binary", async () => {
		const deps = mkDeps({
			downloadToBuffer: vi.fn(async url => {
				if (url.endsWith("SHA256SUMS.txt")) {
					return Buffer.from(`${assetSha}  lpm-some-other-platform\n`, "utf-8")
				}
				return Buffer.from("dummy-bundle-bytes")
			}),
		})
		const result = await tryGitHubDownload("0.42.0", "lpm-linux-x64", deps)
		expect(result).toBeNull()
	})

	it("returns null when Sigstore verifier explicitly rejects the bundle", async () => {
		const deps = mkDeps({
			tryVerifyManifestSignature: vi.fn(async () => "rejected"),
		})
		const result = await tryGitHubDownload("0.42.0", "lpm-linux-x64", deps)
		expect(result).toBeNull()
		expect(deps.download).not.toHaveBeenCalled()
	})

	it("degrades to SHA-only with WARN when sigstore package is unavailable", async () => {
		const logSpy = vi.spyOn(console, "log")
		const deps = mkDeps({
			tryVerifyManifestSignature: vi.fn(async () => "unavailable"),
		})
		const result = await tryGitHubDownload("0.42.0", "lpm-linux-x64", deps)
		expect(result).toBeTruthy()
		const warned = logSpy.mock.calls.some(args =>
			String(args[0] ?? "").includes(
				"optional 'sigstore' package not available",
			),
		)
		expect(warned).toBe(true)
	})

	it("emits Sigstore verified message when verifier succeeds", async () => {
		const logSpy = vi.spyOn(console, "log")
		const deps = mkDeps({
			tryVerifyManifestSignature: vi.fn(async () => "verified"),
		})
		const result = await tryGitHubDownload("0.42.0", "lpm-linux-x64", deps)
		expect(result).toBeTruthy()
		const verifiedLine = logSpy.mock.calls.some(args =>
			String(args[0] ?? "").includes("Verified Sigstore signature on manifest"),
		)
		expect(verifiedLine).toBe(true)
	})

	it("skips ALL integrity checks under LPM_INSTALL_INSECURE=1 with a loud WARN", async () => {
		process.env.LPM_INSTALL_INSECURE = "1"
		const logSpy = vi.spyOn(console, "log")
		// downloadToBuffer must NOT be called when insecure mode is on —
		// the manifest fetch is part of the integrity flow that gets
		// skipped wholesale.
		const deps = mkDeps({
			downloadToBuffer: vi.fn(async () => {
				throw new Error(
					"manifest fetch must not run under LPM_INSTALL_INSECURE=1",
				)
			}),
		})
		const result = await tryGitHubDownload("0.42.0", "lpm-linux-x64", deps)
		expect(result).toBeTruthy()
		expect(fs.readFileSync(result)).toEqual(assetBytes)
		const warned = logSpy.mock.calls.some(args =>
			String(args[0] ?? "").includes("LPM_INSTALL_INSECURE=1"),
		)
		expect(warned).toBe(true)
		expect(deps.downloadToBuffer).not.toHaveBeenCalled()
	})

	it("returns null and cleans up if the asset download fails", async () => {
		const deps = mkDeps({
			download: vi.fn(async () => {
				throw new Error("network down")
			}),
		})
		const result = await tryGitHubDownload("0.42.0", "lpm-linux-x64", deps)
		expect(result).toBeNull()
	})

	it("treats a missing Sigstore bundle as opportunistic skip (SHA gate still runs)", async () => {
		const logSpy = vi.spyOn(console, "log")
		// Bundle fetch fails; manifest succeeds. SHA gate still runs.
		const deps = mkDeps({
			downloadToBuffer: vi.fn(async url => {
				if (url.endsWith("SHA256SUMS.txt")) {
					return Buffer.from(manifestText, "utf-8")
				}
				throw Object.assign(new Error("HTTP 404"), { statusCode: 404 })
			}),
			tryVerifyManifestSignature: vi.fn(async () => {
				throw new Error("must not be called when bundle is absent")
			}),
		})
		const result = await tryGitHubDownload("0.42.0", "lpm-linux-x64", deps)
		expect(result).toBeTruthy()
		expect(deps.tryVerifyManifestSignature).not.toHaveBeenCalled()
		// SHA-only path was the floor — no Sigstore line printed.
		const sigstoreLine = logSpy.mock.calls.some(args =>
			String(args[0] ?? "").includes("Verified Sigstore signature"),
		)
		expect(sigstoreLine).toBe(false)
	})
})
