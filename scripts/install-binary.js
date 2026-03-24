#!/usr/bin/env node

/**
 * Download the platform-specific LPM Rust binary.
 *
 * Runs as a postinstall hook. Downloads the pre-built binary from
 * lpm.dev/releases and places it in the package's bin/ directory.
 *
 * Falls back gracefully to the JS CLI if the binary isn't available
 * for the current platform.
 */

import { execSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgDir = path.join(__dirname, "..")
const binDir = path.join(pkgDir, "bin")
const binaryPath = path.join(
	binDir,
	process.platform === "win32" ? "lpm-bin.exe" : "lpm-bin",
)

// Platform → binary filename mapping
const PLATFORM_MAP = {
	"darwin-arm64": "lpm-darwin-arm64",
	"darwin-x64": "lpm-darwin-x64",
	"linux-x64": "lpm-linux-x64",
	"linux-arm64": "lpm-linux-arm64",
	"win32-x64": "lpm-win32-x64.exe",
}

const GITHUB_RELEASES =
	"https://github.com/lpm-dev/rust-client/releases/download"
const pkg = JSON.parse(
	fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8"),
)

async function main() {
	const platform = `${process.platform}-${process.arch}`
	const binaryName = PLATFORM_MAP[platform]

	if (!binaryName) {
		console.log(`[lpm] No pre-built binary for ${platform}. Using JS CLI.`)
		return
	}

	// Skip if binary already exists and is executable
	if (fs.existsSync(binaryPath)) {
		try {
			execSync(`"${binaryPath}" --version`, { stdio: "ignore", timeout: 5000 })
			return
		} catch {
			// Binary exists but broken, re-download
			fs.unlinkSync(binaryPath)
		}
	}

	const url = `${GITHUB_RELEASES}/v${pkg.version}/${binaryName}`

	try {
		console.log(`[lpm] Downloading native binary for ${platform}...`)
		await download(url, binaryPath)
		fs.chmodSync(binaryPath, 0o755)
		console.log("[lpm] Native binary installed.")
	} catch (err) {
		console.log(`[lpm] Binary not available: ${err.message}. Using JS CLI.`)
		// Clean up partial download
		if (fs.existsSync(binaryPath)) fs.unlinkSync(binaryPath)
	}
}

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
	// Silently fail — JS CLI fallback
})
