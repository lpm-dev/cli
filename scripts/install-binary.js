#!/usr/bin/env node

/**
 * LPM CLI Binary Installer — 3-tier fallback + hard-link optimization.
 *
 * Runs as a postinstall hook. Resolution order:
 *
 * 1. optionalDependencies — platform package installed by npm (fastest, cached)
 * 2. GitHub Releases — direct download if optionalDependencies missing (--no-optional)
 * 3. Graceful fallback — JS CLI handles commands if binary unavailable
 *
 * After resolving the binary, hard-links it over bin/lpm.js so subsequent
 * runs execute the native binary directly (zero Node.js overhead).
 *
 * Follows the esbuild pattern: https://github.com/evanw/esbuild
 */

import { execSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgDir = path.join(__dirname, "..")
const binDir = path.join(pkgDir, "bin")
const require = createRequire(import.meta.url)

// Platform → { package name, binary filename in package }
const PLATFORMS = {
	"darwin-arm64": {
		pkg: "@lpm-registry/cli-darwin-arm64",
		binary: "lpm",
	},
	"darwin-x64": {
		pkg: "@lpm-registry/cli-darwin-x64",
		binary: "lpm",
	},
	"linux-x64": {
		pkg: "@lpm-registry/cli-linux-x64",
		binary: "lpm",
	},
	"linux-arm64": {
		pkg: "@lpm-registry/cli-linux-arm64",
		binary: "lpm",
	},
	"win32-x64": {
		pkg: "@lpm-registry/cli-win32-x64",
		binary: "lpm.exe",
	},
}

// GitHub Releases fallback URLs
const GITHUB_RELEASES =
	"https://github.com/lpm-dev/rust-client/releases/download"
const GITHUB_BINARY_NAMES = {
	"darwin-arm64": "lpm-darwin-arm64",
	"darwin-x64": "lpm-darwin-x64",
	"linux-x64": "lpm-linux-x64",
	"linux-arm64": "lpm-linux-arm64",
	"win32-x64": "lpm-win32-x64.exe",
}

async function main() {
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

	// ── Tier 1: Try optionalDependencies (platform package) ──────────
	let binaryPath = tryOptionalDependency(platformInfo)

	// ── Tier 2: Direct download from GitHub Releases ─────────────────
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

	// ── Hard-link optimization ───────────────────────────────────────
	// Replace bin/lpm.js with a hard link to the native binary.
	// After this, `lpm` on PATH IS the Rust binary — zero Node.js overhead.
	if (process.platform !== "win32") {
		tryHardLink(binaryPath)
	} else {
		// Windows: copy instead of hard-link (npm creates .cmd shims)
		tryCopyBinary(binaryPath)
	}
}

/**
 * Tier 1: Resolve binary from optionalDependencies platform package.
 * Returns the path to the binary, or null if not found.
 */
function tryOptionalDependency(platformInfo) {
	try {
		// require.resolve finds the package in node_modules
		const pkgJsonPath = require.resolve(`${platformInfo.pkg}/package.json`)
		const pkgDir = path.dirname(pkgJsonPath)
		const binaryPath = path.join(pkgDir, platformInfo.binary)

		if (fs.existsSync(binaryPath)) {
			// Verify the binary is executable
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
		// Package not installed (--no-optional, or resolution failed)
	}

	return null
}

/**
 * Tier 2: Download binary directly from GitHub Releases.
 * Returns the path to the downloaded binary, or null on failure.
 */
async function tryGitHubDownload(version, githubBinaryName) {
	const url = `${GITHUB_RELEASES}/v${version}/${githubBinaryName}`
	const destName = process.platform === "win32" ? "lpm-bin.exe" : "lpm-bin"
	const destPath = path.join(binDir, destName)

	try {
		console.log(`[lpm] Platform package not found. Downloading from GitHub...`)
		await download(url, destPath)
		fs.chmodSync(destPath, 0o755)
		console.log("[lpm] Native binary downloaded from GitHub Releases.")
		return destPath
	} catch (err) {
		console.log(`[lpm] GitHub download failed: ${err.message}. Using JS CLI.`)
		// Clean up partial download
		if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
		return null
	}
}

/**
 * Hard-link the native binary over bin/lpm.js (Unix only).
 *
 * After this, the `lpm` symlink on PATH points directly to the Rust binary.
 * Node.js is never started. Zero overhead.
 *
 * We keep lpm.js.bak as the JS fallback — if the hard link is broken
 * (npm rebuild, etc.), the JS wrapper can be restored.
 */
function tryHardLink(binaryPath) {
	const shimPath = path.join(binDir, "lpm.js")
	const backupPath = path.join(binDir, "lpm.js.bak")

	try {
		// Back up the JS shim (only if not already backed up)
		if (fs.existsSync(shimPath) && !fs.existsSync(backupPath)) {
			fs.copyFileSync(shimPath, backupPath)
		}

		// Replace JS shim with hard link to native binary
		if (fs.existsSync(shimPath)) {
			fs.unlinkSync(shimPath)
		}
		fs.linkSync(binaryPath, shimPath)

		console.log("[lpm] Hard-linked native binary (zero Node.js overhead)")
	} catch (err) {
		// Hard link failed (cross-device mount, permissions, etc.)
		// Restore JS shim — it will delegate at runtime (50ms overhead)
		if (fs.existsSync(backupPath) && !fs.existsSync(shimPath)) {
			fs.copyFileSync(backupPath, shimPath)
		}
		console.log(`[lpm] Hard-link failed (${err.code}). Using JS wrapper.`)
	}
}

/**
 * Copy binary to bin/ directory (Windows fallback).
 * npm on Windows creates .cmd shims, so hard-linking doesn't work the same way.
 */
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
 */
function download(url, dest, redirects = 0) {
	if (redirects > 5) return Promise.reject(new Error("Too many redirects"))

	const client = url.startsWith("https") ? https : http

	return new Promise((resolve, reject) => {
		client
			.get(url, res => {
				if (
					res.statusCode >= 300 &&
					res.statusCode < 400 &&
					res.headers.location
				) {
					resolve(download(res.headers.location, dest, redirects + 1))
					return
				}

				if (res.statusCode !== 200) {
					reject(new Error(`HTTP ${res.statusCode}`))
					return
				}

				const out = fs.createWriteStream(dest)
				res.pipe(out)
				out.on("finish", () => {
					out.close()
					resolve()
				})
				out.on("error", reject)
			})
			.on("error", reject)
	})
}

main().catch(() => {
	// Silently fail — JS CLI fallback will handle all commands
})
