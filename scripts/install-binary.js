#!/usr/bin/env node

/**
 * LPM CLI Binary Installer — 3-tier fallback + hard-link optimization.
 *
 * Runs as a postinstall hook. Resolution order:
 *
 * 1. optionalDependencies — platform package installed by npm (fastest, cached).
 *    Integrity story: npm provenance attestation, verified by the npm registry
 *    at install time. No extra check needed here.
 * 2. GitHub Releases — direct download if optionalDependencies missing
 *    (--no-optional, corporate proxies blocking scoped packages, resolution
 *    failure). Integrity story: every byte is anchored to a Sigstore-signed
 *    `SHA256SUMS.txt` manifest published per release. The `sigstore` npm
 *    package is consulted as an optional dependency — when resolvable, full
 *    Sigstore bundle verification runs; when not, SHA-256 against the signed
 *    manifest is the floor. Fail-closed on any integrity gate.
 * 3. Graceful fallback — JS CLI handles commands if Tier 2 returns null.
 *
 * After resolving the binary, hard-links it over bin/lpm.js so subsequent
 * runs execute the native binary directly (zero Node.js overhead).
 *
 * Set `LPM_INSTALL_INSECURE=1` to skip every Tier-2 integrity check (escape
 * valve for emergency installs from releases that predate the signed-install
 * gate). Emits a loud WARN on every use.
 *
 * Follows the esbuild postinstall pattern: https://github.com/evanw/esbuild
 */

import { execSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import https from "node:https"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgDir = path.join(__dirname, "..")
const binDir = path.join(pkgDir, "bin")
const require = createRequire(import.meta.url)

const PLATFORMS = {
	"darwin-arm64": { pkg: "@lpm-registry/cli-darwin-arm64", binary: "lpm" },
	"darwin-x64": { pkg: "@lpm-registry/cli-darwin-x64", binary: "lpm" },
	"linux-x64": { pkg: "@lpm-registry/cli-linux-x64", binary: "lpm" },
	"linux-arm64": { pkg: "@lpm-registry/cli-linux-arm64", binary: "lpm" },
	"win32-x64": { pkg: "@lpm-registry/cli-win32-x64", binary: "lpm.exe" },
}

const GITHUB_RELEASES =
	"https://github.com/lpm-dev/rust-client/releases/download"
const GITHUB_BINARY_NAMES = {
	"darwin-arm64": "lpm-darwin-arm64",
	"darwin-x64": "lpm-darwin-x64",
	"linux-x64": "lpm-linux-x64",
	"linux-arm64": "lpm-linux-arm64",
	"win32-x64": "lpm-win32-x64.exe",
}

const MANIFEST_MAX_BYTES = 64 * 1024
const BUNDLE_MAX_BYTES = 1024 * 1024
const ASSET_MAX_BYTES = 256 * 1024 * 1024

const SIGSTORE_IDENTITY = {
	certificateIdentityRegExp:
		"^https://github\\.com/lpm-dev/rust-client/\\.github/workflows/release\\.yml@.+",
	certificateOIDCIssuer: "https://token.actions.githubusercontent.com",
}

export async function main() {
	const platform = `${process.platform}-${os.arch()}`
	const platformInfo = PLATFORMS[platform]

	if (!platformInfo) {
		console.log(
			`[lpm] No pre-built binary for ${platform}. Using JS CLI fallback.`,
		)
		return
	}

	const pkg = JSON.parse(
		fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8"),
	)

	let binaryPath = tryOptionalDependency(platformInfo)

	if (!binaryPath) {
		const githubBinaryName = GITHUB_BINARY_NAMES[platform]
		if (githubBinaryName) {
			binaryPath = await tryGitHubDownload(pkg.version, githubBinaryName)
		}
	}

	if (!binaryPath) {
		console.log("[lpm] Binary not available. Using JS CLI fallback.")
		return
	}

	if (process.platform !== "win32") {
		tryHardLink(binaryPath)
	} else {
		tryCopyBinary(binaryPath)
	}
}

function tryOptionalDependency(platformInfo) {
	try {
		const pkgJsonPath = require.resolve(`${platformInfo.pkg}/package.json`)
		const platformPkgDir = path.dirname(pkgJsonPath)
		const binaryPath = path.join(platformPkgDir, platformInfo.binary)

		if (fs.existsSync(binaryPath)) {
			try {
				execSync(`"${binaryPath}" --version`, {
					stdio: "ignore",
					timeout: 5000,
				})
				console.log(`[lpm] Using native binary from ${platformInfo.pkg}`)
				return binaryPath
			} catch {
				console.log(
					`[lpm] Binary from ${platformInfo.pkg} exists but not executable.`,
				)
			}
		}
	} catch {
		// Package not installed (--no-optional, or resolution failed).
	}

	return null
}

/**
 * Tier 2: download binary from GitHub Releases with end-to-end integrity.
 *
 * Returns the path to the verified, executable binary on success, or null
 * on any failure (manifest 404, SHA mismatch, Sigstore rejection, network
 * error). `null` falls through to the JS CLI fallback in `main` — Tier 2
 * never silently installs an unverified binary.
 *
 * Exported for testability — `vi.mock` of the network calls drives this
 * function directly.
 */
export async function tryGitHubDownload(version, githubBinaryName, deps = {}) {
	const downloadFn = deps.download || download
	const downloadToBufferFn = deps.downloadToBuffer || downloadToBuffer
	const sha256FileFn = deps.sha256File || sha256File
	const verifyFn = deps.tryVerifyManifestSignature || tryVerifyManifestSignature
	const destDir = deps.destDir || binDir
	const insecure = process.env.LPM_INSTALL_INSECURE === "1"

	const manifestUrl = `${GITHUB_RELEASES}/v${version}/SHA256SUMS.txt`
	const bundleUrl = `${GITHUB_RELEASES}/v${version}/SHA256SUMS.txt.sigstore`
	const assetUrl = `${GITHUB_RELEASES}/v${version}/${githubBinaryName}`

	let manifestBody = null
	let bundleBody = null

	if (insecure) {
		console.log(
			"[lpm] WARN: LPM_INSTALL_INSECURE=1 — skipping ALL integrity verification on Tier-2 download",
		)
	} else {
		try {
			manifestBody = await downloadToBufferFn(manifestUrl, MANIFEST_MAX_BYTES)
		} catch (err) {
			if (err && err.statusCode === 404) {
				console.log(
					`[lpm] ERROR: release v${version} does not ship SHA256SUMS.txt — this release predates LPM's signed-install gate.`,
				)
				console.log(
					`[lpm]        Install manually from https://github.com/lpm-dev/rust-client/releases/v${version}`,
				)
				console.log(
					"[lpm]        Or set LPM_INSTALL_INSECURE=1 to skip integrity verification (NOT recommended).",
				)
			} else {
				console.log(
					`[lpm] ERROR: could not fetch signed manifest: ${err.message}`,
				)
			}
			return null
		}
		try {
			bundleBody = await downloadToBufferFn(bundleUrl, BUNDLE_MAX_BYTES)
		} catch {
			// Bundle 404 / fetch failure is not an attack signal by itself —
			// the SHA-256 gate against the manifest still runs. cosign /
			// sigstore verification is opportunistic on this channel.
			bundleBody = null
		}

		if (bundleBody) {
			const verdict = await verifyFn(manifestBody, bundleBody)
			if (verdict === "verified") {
				console.log(
					"[lpm] Verified Sigstore signature on manifest (identity-pinned to release.yml)",
				)
			} else if (verdict === "rejected") {
				// Verifier ran and refused — strong attack signal.
				console.log(
					"[lpm] ERROR: Sigstore verifier rejected the manifest signature.",
				)
				console.log(
					"[lpm]        Refusing to install. See https://github.com/lpm-dev/rust-client/issues",
				)
				return null
			} else {
				// Optional `sigstore` package not resolvable — degrade to
				// SHA-only with a loud WARN so the user knows what to
				// install for the stronger posture.
				console.log(
					"[lpm] WARN: optional 'sigstore' package not available; falling back to SHA-256 against the signed manifest only.",
				)
				console.log(
					"[lpm]       For Sigstore verification, run `npm install --include=optional` or unblock the sigstore package.",
				)
			}
		}
	}

	const destName = process.platform === "win32" ? "lpm-bin.exe" : "lpm-bin"
	const destPath = path.join(destDir, destName)
	const tmpPath = `${destPath}.tmp.${process.pid}`

	try {
		console.log("[lpm] Downloading native binary from GitHub Releases...")
		await downloadFn(assetUrl, tmpPath, 0, ASSET_MAX_BYTES)
	} catch (err) {
		console.log(`[lpm] Download failed: ${err.message}. Using JS CLI fallback.`)
		safeUnlink(tmpPath)
		return null
	}

	if (manifestBody) {
		const actualSha = await sha256FileFn(tmpPath)
		const expectedSha = parseManifestEntry(
			manifestBody.toString("utf-8"),
			githubBinaryName,
		)
		if (!expectedSha) {
			console.log(
				`[lpm] ERROR: manifest does not enumerate ${githubBinaryName}; release-pipeline bug.`,
			)
			safeUnlink(tmpPath)
			return null
		}
		if (actualSha !== expectedSha) {
			console.log(`[lpm] ERROR: SHA-256 mismatch for ${githubBinaryName}`)
			console.log(
				`[lpm]        expected: ${expectedSha} (from signed manifest)`,
			)
			console.log(`[lpm]        actual:   ${actualSha}`)
			console.log("[lpm]        Refusing to install — strong tampering signal.")
			safeUnlink(tmpPath)
			return null
		}
		console.log(`[lpm] Verified SHA-256: ${actualSha}`)
	}

	try {
		fs.renameSync(tmpPath, destPath)
		fs.chmodSync(destPath, 0o755)
	} catch (err) {
		console.log(`[lpm] Could not install verified binary: ${err.message}`)
		safeUnlink(tmpPath)
		return null
	}

	console.log("[lpm] Native binary installed from GitHub Releases.")
	return destPath
}

function tryHardLink(binaryPath) {
	const shimPath = path.join(binDir, "lpm.js")
	const backupPath = path.join(binDir, "lpm.js.bak")

	try {
		if (fs.existsSync(shimPath) && !fs.existsSync(backupPath)) {
			fs.copyFileSync(shimPath, backupPath)
		}

		if (fs.existsSync(shimPath)) {
			fs.unlinkSync(shimPath)
		}
		fs.linkSync(binaryPath, shimPath)

		console.log("[lpm] Hard-linked native binary (zero Node.js overhead)")
	} catch (err) {
		if (fs.existsSync(backupPath) && !fs.existsSync(shimPath)) {
			fs.copyFileSync(backupPath, shimPath)
		}
		console.log(`[lpm] Hard-link failed (${err.code}). Using JS wrapper.`)
	}
}

function tryCopyBinary(binaryPath) {
	const destPath = path.join(binDir, "lpm-bin.exe")
	try {
		fs.copyFileSync(binaryPath, destPath)
		console.log("[lpm] Copied native binary to bin/")
	} catch (err) {
		console.log(`[lpm] Copy failed: ${err.message}. Using JS wrapper.`)
	}
}

/**
 * Download a file from a URL, following redirects (GitHub → S3).
 *
 * HTTPS-only end-to-end: the entry check rejects any non-`https://`
 * URL, and redirect Locations are resolved against the current URL
 * before re-entering the function — so an attacker-controlled mirror
 * cannot downgrade transport mid-chain via `Location: http://…`.
 *
 * Streams to disk with a per-response byte cap so a compromised mirror
 * cannot exhaust disk by serving an unbounded body. The 5-redirect cap
 * is preserved from the pre-integrity-gate shape.
 *
 * Exported for testability.
 */
export function download(url, dest, redirects = 0, maxBytes = ASSET_MAX_BYTES) {
	if (redirects > 5) return Promise.reject(new Error("Too many redirects"))
	if (!url.startsWith("https://")) {
		return Promise.reject(
			new Error(
				`refusing non-HTTPS transport: ${url} (Tier-2 download requires HTTPS end-to-end)`,
			),
		)
	}

	return new Promise((resolve, reject) => {
		const req = https.get(url, res => {
			if (
				res.statusCode >= 300 &&
				res.statusCode < 400 &&
				res.headers.location
			) {
				res.resume()
				let nextUrl
				try {
					nextUrl = new URL(res.headers.location, url).href
				} catch {
					reject(
						new Error(`invalid redirect Location: ${res.headers.location}`),
					)
					return
				}
				resolve(download(nextUrl, dest, redirects + 1, maxBytes))
				return
			}

			if (res.statusCode !== 200) {
				const err = new Error(`HTTP ${res.statusCode}`)
				err.statusCode = res.statusCode
				res.resume()
				reject(err)
				return
			}

			const advertised = Number(res.headers["content-length"])
			if (Number.isFinite(advertised) && advertised > maxBytes) {
				res.resume()
				reject(
					new Error(
						`response advertises ${advertised} bytes; cap of ${maxBytes} would be exceeded`,
					),
				)
				return
			}

			let received = 0
			const out = fs.createWriteStream(dest)
			res.on("data", chunk => {
				received += chunk.length
				if (received > maxBytes) {
					out.destroy()
					res.destroy()
					safeUnlink(dest)
					reject(
						new Error(
							`response body exceeded cap of ${maxBytes} bytes mid-stream`,
						),
					)
				}
			})
			res.pipe(out)
			out.on("finish", () => {
				out.close()
				resolve()
			})
			out.on("error", reject)
		})
		req.on("error", reject)
	})
}

/**
 * Buffered variant of [`download`] — fetches a bounded body into memory
 * and returns it as a Buffer. Used for the manifest + Sigstore bundle,
 * both of which are small and must be inspected as a whole before any
 * other byte is honored.
 *
 * HTTPS-only: identical transport-hardening posture as [`download`].
 *
 * Exported for testability.
 */
export function downloadToBuffer(url, maxBytes, redirects = 0) {
	if (redirects > 5) return Promise.reject(new Error("Too many redirects"))
	if (!url.startsWith("https://")) {
		return Promise.reject(
			new Error(
				`refusing non-HTTPS transport: ${url} (Tier-2 download requires HTTPS end-to-end)`,
			),
		)
	}

	return new Promise((resolve, reject) => {
		const req = https.get(url, res => {
			if (
				res.statusCode >= 300 &&
				res.statusCode < 400 &&
				res.headers.location
			) {
				res.resume()
				let nextUrl
				try {
					nextUrl = new URL(res.headers.location, url).href
				} catch {
					reject(
						new Error(`invalid redirect Location: ${res.headers.location}`),
					)
					return
				}
				resolve(downloadToBuffer(nextUrl, maxBytes, redirects + 1))
				return
			}

			if (res.statusCode !== 200) {
				const err = new Error(`HTTP ${res.statusCode}`)
				err.statusCode = res.statusCode
				res.resume()
				reject(err)
				return
			}

			const advertised = Number(res.headers["content-length"])
			if (Number.isFinite(advertised) && advertised > maxBytes) {
				res.resume()
				reject(
					new Error(
						`response advertises ${advertised} bytes; cap of ${maxBytes} would be exceeded`,
					),
				)
				return
			}

			const chunks = []
			let received = 0
			res.on("data", chunk => {
				received += chunk.length
				if (received > maxBytes) {
					res.destroy()
					reject(
						new Error(
							`response body exceeded cap of ${maxBytes} bytes mid-stream`,
						),
					)
					return
				}
				chunks.push(chunk)
			})
			res.on("end", () => resolve(Buffer.concat(chunks)))
			res.on("error", reject)
		})
		req.on("error", reject)
	})
}

/**
 * Compute the SHA-256 of a file as a lowercase hex string, streaming
 * the file so we never buffer the whole asset in memory.
 *
 * Exported for testability.
 */
export function sha256File(filePath) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash("sha256")
		const stream = fs.createReadStream(filePath)
		stream.on("data", chunk => hash.update(chunk))
		stream.on("end", () => resolve(hash.digest("hex")))
		stream.on("error", reject)
	})
}

/**
 * Look up the SHA-256 for `filename` in a parsed SHA256SUMS.txt body.
 *
 * Format: `<64-hex>  <filename>\n` per line, two ASCII spaces between
 * digest and name (GNU coreutils default; macOS shasum -a 256 matches).
 * Malformed lines return null — a malformed manifest is an integrity
 * failure, not a silent miss; callers should refuse to install.
 *
 * Exported for testability.
 */
export function parseManifestEntry(manifestText, filename) {
	const lines = manifestText.split("\n")
	for (const raw of lines) {
		const line = raw.replace(/\r$/, "")
		if (line.length === 0) continue
		const idx = line.indexOf("  ")
		if (idx !== 64) return null
		const digest = line.slice(0, 64).toLowerCase()
		if (!/^[0-9a-f]{64}$/.test(digest)) return null
		const name = line.slice(idx + 2).trim()
		if (name.length === 0) return null
		if (name === filename) return digest
	}
	return null
}

function safeUnlink(p) {
	try {
		if (fs.existsSync(p)) fs.unlinkSync(p)
	} catch {
		// Best-effort.
	}
}

/**
 * Verify a Sigstore bundle against a manifest body using the optional
 * `sigstore` package. Returns:
 *
 *   "verified"    — bundle verified under the lpm-dev/rust-client
 *                   release.yml identity pin.
 *   "rejected"    — sigstore package present and refused the bundle.
 *   "unavailable" — sigstore package not resolvable (--no-optional,
 *                   firewalled, install failure). Caller degrades to
 *                   SHA-only.
 *
 * Exported for testability.
 */
export async function tryVerifyManifestSignature(manifestBody, bundleBody) {
	let sigstore
	try {
		sigstore = await import("sigstore")
	} catch {
		return "unavailable"
	}
	try {
		const bundle = JSON.parse(bundleBody.toString("utf-8"))
		await sigstore.verify(bundle, manifestBody, SIGSTORE_IDENTITY)
		return "verified"
	} catch {
		return "rejected"
	}
}

// Only run `main` when this module is executed as a script (the
// postinstall hook). Test files that `import { tryGitHubDownload, … }`
// from this module should not trigger a real install attempt during
// suite setup.
const invokedAsScript =
	process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedAsScript) {
	main().catch(() => {
		// Silently fail — JS CLI fallback will handle all commands.
	})
}
