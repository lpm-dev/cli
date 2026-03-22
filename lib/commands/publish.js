import { exec } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import * as p from "@clack/prompts"
import { request, verifyTokenScope } from "../api.js"
import {
	clearTransientToken,
	getRegistryUrl,
	setTransientToken,
} from "../config.js"
import { SUCCESS_MESSAGES, WARNING_MESSAGES } from "../constants.js"
import {
	createEcosystemTarball,
	detectEcosystem,
	detectXCFramework,
	extractSwiftMetadata,
	readSwiftManifest,
} from "../ecosystem.js"
import { generateIntegrity } from "../integrity.js"
import {
	exchangeGitLabOidcToken,
	exchangeOidcToken,
	isGitHubActionsWithOidc,
	isGitLabCiWithOidc,
} from "../oidc.js"
import { displayQualityReport } from "../quality/display.js"
import { runQualityChecks } from "../quality/score.js"
import { createSpinner, log, printHeader } from "../ui.js"

const execAsync = promisify(exec)
const readFileAsync = promisify(fs.readFile)

/**
 * Parse package name in the @lpm.dev/owner.package format
 * @returns {{ owner: string, pkgName: string } | { error: string }}
 */
function parsePackageName(name) {
	// New format: @lpm.dev/owner.package-name
	if (name.startsWith("@lpm.dev/")) {
		const nameWithOwner = name.replace("@lpm.dev/", "")
		const dotIndex = nameWithOwner.indexOf(".")
		if (dotIndex === -1) {
			return { error: "Invalid format. Expected @lpm.dev/owner.package-name" }
		}
		return {
			owner: nameWithOwner.substring(0, dotIndex),
			pkgName: nameWithOwner.substring(dotIndex + 1),
		}
	}

	// Legacy format: @scope/package-name
	if (name.startsWith("@")) {
		const match = name.match(/^@([^/]+)\/(.+)$/)
		if (match) {
			return {
				owner: match[1],
				pkgName: match[2],
				isLegacy: true,
			}
		}
	}

	return {
		error: "Invalid package name. Use @lpm.dev/owner.package-name format",
	}
}

/**
 * Run the interactive init flow for non-JS packages.
 * Generates a minimal package.json with name, version, and description.
 *
 * @param {string} ecosystem - Detected ecosystem
 * @returns {Promise<object>} Generated package.json contents
 */
async function initNonJsPackage(ecosystem) {
	log.info(`Detected ${ecosystem} project without package.json.`)
	log.info("Creating package metadata for LPM registry...")
	console.log("")

	// Get username from auth to auto-prefix owner
	const whoamiResponse = await request("/-/whoami")
	if (!whoamiResponse.ok) {
		throw new Error("Could not determine your username. Run `lpm login` first.")
	}
	const whoami = await whoamiResponse.json()

	// Build available owners list
	const availableOwners = []
	if (whoami.profile_username) {
		availableOwners.push({
			value: whoami.profile_username,
			label: `${whoami.profile_username} (personal)`,
		})
	}
	for (const org of whoami.organizations || []) {
		availableOwners.push({
			value: org.slug,
			label: `${org.slug} (organization)`,
		})
	}

	if (availableOwners.length === 0) {
		throw new Error(
			"No available owners. Set your username at the dashboard or create an organization.",
		)
	}

	// Select owner
	let owner
	if (availableOwners.length === 1) {
		owner = availableOwners[0].value
	} else {
		const selected = await p.select({
			message: "Publish under which owner?",
			options: availableOwners,
		})
		if (p.isCancel(selected)) {
			p.cancel("Cancelled.")
			process.exit(0)
		}
		owner = selected
	}

	// Suggest package name from directory name
	const dirName = path
		.basename(process.cwd())
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
	const packageNameInput = await p.text({
		message: "Package name",
		placeholder: dirName,
		defaultValue: dirName,
		validate: value => {
			if (!value) return "Package name is required"
			if (!/^[a-z0-9][a-z0-9-]*$/.test(value))
				return "Must start with a letter/number and contain only lowercase letters, numbers, and hyphens"
		},
	})
	if (p.isCancel(packageNameInput)) {
		p.cancel("Cancelled.")
		process.exit(0)
	}
	const packageName = packageNameInput || dirName

	const versionInput = await p.text({
		message: "Version",
		placeholder: "1.0.0",
		defaultValue: "1.0.0",
		validate: value => {
			if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(value))
				return "Must be valid semver (e.g. 1.0.0)"
		},
	})
	if (p.isCancel(versionInput)) {
		p.cancel("Cancelled.")
		process.exit(0)
	}

	const description = await p.text({
		message: "Description (optional)",
		placeholder: "",
	})
	if (p.isCancel(description)) {
		p.cancel("Cancelled.")
		process.exit(0)
	}

	const fullName = `@lpm.dev/${owner}.${packageName}`
	const pkg = {
		name: fullName,
		version: versionInput || "1.0.0",
	}
	if (description) {
		pkg.description = description
	}

	// Write package.json
	const packageJsonPath = path.resolve(process.cwd(), "package.json")
	fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`)
	log.success(`Created package.json for ${fullName}`)
	console.log("")

	return pkg
}

/**
 * Read README from the current directory.
 * Searches for common README filenames.
 *
 * @returns {string|null}
 */
function readReadme() {
	const readmeFilenames = [
		"README.md",
		"readme.md",
		"README",
		"Readme.md",
		"README.txt",
	]

	for (const filename of readmeFilenames) {
		const readmePath = path.resolve(process.cwd(), filename)

		if (!readmePath.startsWith(process.cwd())) {
			continue
		}

		if (fs.existsSync(readmePath)) {
			try {
				const stats = fs.statSync(readmePath)

				const MAX_README_SIZE = 1024 * 1024
				if (stats.size > MAX_README_SIZE) {
					log.warn(
						`README file is too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Maximum size is 1MB. Skipping README.`,
					)
					return null
				}

				const readmeBuffer = fs.readFileSync(readmePath)

				const isBinary = readmeBuffer.some(
					byte =>
						byte === 0 ||
						(byte < 32 && byte !== 9 && byte !== 10 && byte !== 13),
				)
				if (isBinary) {
					log.warn("README appears to be binary. Skipping.")
					return null
				}

				let readme = readmeBuffer.toString("utf8").trim()

				if (readme.length > MAX_README_SIZE) {
					readme = readme.substring(0, MAX_README_SIZE)
					log.warn("README truncated to 1MB.")
				}

				return readme
			} catch (_err) {
				// Continue to next filename
			}
		}
	}

	return null
}

/**
 * Read lpm.config.json from the current directory.
 *
 * @returns {object|null}
 */
function readLpmConfig() {
	const lpmConfigPath = path.resolve(process.cwd(), "lpm.config.json")
	if (fs.existsSync(lpmConfigPath)) {
		try {
			const lpmConfigRaw = fs.readFileSync(lpmConfigPath, "utf-8")
			return JSON.parse(lpmConfigRaw)
		} catch (_err) {
			log.warn("Could not parse lpm.config.json. Skipping.")
		}
	}
	return null
}

/**
 * Pack using npm pack (JS ecosystem).
 *
 * @returns {Promise<{ tarballPath: string, npmPackMeta: object }>}
 */
async function packWithNpm() {
	const { stdout } = await execAsync("npm pack --json")
	const packResult = JSON.parse(stdout)
	const packInfo = packResult[0]
	const tarballFilename = packInfo.filename
	const tarballPath = path.resolve(process.cwd(), tarballFilename)

	return {
		tarballPath,
		npmPackMeta: {
			unpackedSize: packInfo.unpackedSize,
			fileCount: packInfo.files?.length || 0,
			files: packInfo.files || [],
		},
	}
}

/**
 * Pack using tar (non-JS ecosystems).
 *
 * @param {string} ecosystem - Ecosystem identifier
 * @param {string} name - Package name
 * @param {string} version - Package version
 * @returns {Promise<{ tarballPath: string, npmPackMeta: object }>}
 */
async function packWithTar(ecosystem, name, version) {
	const result = await createEcosystemTarball(ecosystem, name, version)
	return {
		tarballPath: result.tarballPath,
		npmPackMeta: {
			unpackedSize: result.unpackedSize,
			fileCount: result.fileCount,
			files: result.files,
		},
	}
}

/**
 * Scan local project directory for test files.
 * This avoids requiring test files in the tarball to earn quality points.
 * Uses a limited-depth scan, skipping known non-source directories.
 */
function scanProjectForTestFiles() {
	const skipDirs = new Set([
		"node_modules",
		".git",
		"dist",
		"build",
		".next",
		".nuxt",
		"coverage",
		".lpm",
	])

	const result = []

	function walk(dir, depth = 0) {
		if (depth > 4) return
		let entries
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (!skipDirs.has(entry.name)) {
					walk(path.join(dir, entry.name), depth + 1)
				}
			} else if (entry.isFile()) {
				result.push({ path: path.join(dir, entry.name) })
			}
		}
	}

	walk(process.cwd())
	return result
}

export async function publish(options = {}) {
	const checkOnly = !!options.check
	const dryRun = !!options.dryRun
	const minScore = options.minScore ? parseInt(options.minScore, 10) : null
	const forceProvenance = !!options.provenance

	printHeader()

	// 1. Detect ecosystem
	const { ecosystem, manifestFile } = detectEcosystem()

	if (!ecosystem) {
		log.error(
			"No recognized project manifest found (package.json, Package.swift, Cargo.toml, pyproject.toml).",
		)
		process.exit(1)
	}

	if (ecosystem !== "js") {
		log.info(`Detected ${ecosystem} project (${manifestFile})`)
	}

	// 2. Read or generate package.json
	const packageJsonPath = path.resolve(process.cwd(), "package.json")
	let pkg
	let _isNewPackage = false

	if (ecosystem !== "js" && !fs.existsSync(packageJsonPath)) {
		// Non-JS project without package.json — run init flow
		pkg = await initNonJsPackage(ecosystem)
		_isNewPackage = true
	} else if (!fs.existsSync(packageJsonPath)) {
		log.error("No package.json found in current directory.")
		process.exit(1)
	} else {
		try {
			pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
		} catch (err) {
			log.error(`Invalid JSON in package.json: ${err.message}`)
			process.exit(1)
		}
	}

	const { name, version } = pkg

	// Parse package name to extract owner
	const parsed = parsePackageName(name)
	if (parsed.error) {
		log.error(parsed.error)
		log.info("LPM packages must use format: @lpm.dev/owner.package-name")
		log.info(`Your current name: ${name}`)

		// Suggest fix for legacy format
		const oldMatch = name.match(/^@([^/]+)\/(.+)$/)
		if (oldMatch) {
			const suggested = `@lpm.dev/${oldMatch[1]}.${oldMatch[2]}`
			log.info(`Suggested: ${suggested}`)
		}
		process.exit(1)
	}

	const { owner, pkgName: packageName, isLegacy } = parsed

	// Warn about legacy format
	if (isLegacy) {
		log.warn(`Legacy format detected: ${name}`)
		log.warn(`Please migrate to: @lpm.dev/${owner}.${packageName}`)
		console.log("")
	}

	const spinner = createSpinner("Preparing to publish...").start()

	// Track tarball path for cleanup in finally block
	let tarballPath = null
	// Hoist whoami for success message
	let whoami = null

	try {
		// 3. Read ecosystem-specific manifest data
		let swiftManifest = null
		let xcFramework = null

		if (ecosystem === "swift") {
			// Read Swift Package manifest
			spinner.text = "Reading Package.swift..."
			try {
				const rawManifest = await readSwiftManifest()
				swiftManifest = extractSwiftMetadata(rawManifest)
			} catch (err) {
				spinner.stop()
				log.warn(`Could not read Package.swift: ${err.message}`)
				log.info("Publishing without Swift manifest data.")
				spinner.start()
			}

			// Detect XCFramework
			xcFramework = detectXCFramework()
			if (xcFramework.found) {
				if (!xcFramework.hasInfoPlist) {
					spinner.stop()
					log.warn(
						`XCFramework "${xcFramework.name}" found but missing Info.plist. Treating as source package.`,
					)
					spinner.start()
					xcFramework = { found: false }
				} else {
					spinner.stop()
					log.info(`XCFramework detected: ${xcFramework.name}`)
					spinner.start()
				}
			}
		}

		// 4. Create tarball
		spinner.text = "Packing tarball..."
		let npmPackMeta

		if (ecosystem === "js") {
			const packResult = await packWithNpm()
			tarballPath = packResult.tarballPath
			npmPackMeta = packResult.npmPackMeta
		} else {
			const packResult = await packWithTar(ecosystem, name, version)
			tarballPath = packResult.tarballPath
			npmPackMeta = packResult.npmPackMeta
		}

		// 4b. Check if local skills exist but are missing from tarball
		const localSkillsDir = path.join(process.cwd(), ".lpm", "skills")
		if (fs.existsSync(localSkillsDir)) {
			const fileList = npmPackMeta.files || []
			const hasSkillsInTarball = fileList.some(f => {
				const filePath = f.path || f
				return (
					filePath.includes(".lpm/skills/") ||
					filePath.includes(".lpm\\skills\\")
				)
			})
			if (!hasSkillsInTarball) {
				spinner.stop()
				log.warn(
					"Found .lpm/skills/ directory but no skill files in the tarball.",
				)
				log.info(
					'If using "files" in package.json, add ".lpm" to include skills.',
				)
				console.log("")
				spinner.start()
			}
		}

		// 5. Read README
		spinner.text = "Reading README..."
		const readme = readReadme()

		// 6. Read lpm.config.json if present
		const lpmConfig = readLpmConfig()

		// 7. Run quality checks and display report
		spinner.text = "Running quality checks..."
		const projectFiles = scanProjectForTestFiles()
		const qualityResult = runQualityChecks({
			packageJson: pkg,
			readme,
			lpmConfig,
			files: npmPackMeta.files || [],
			projectFiles,
			unpackedSize: npmPackMeta.unpackedSize,
			ecosystem,
			swiftManifest,
		})

		// 7b. Check for stale skills (compare local with published)
		spinner.text = "Checking skills..."
		const prePublishWarnings = []
		try {
			const localSkillsDir = path.join(process.cwd(), ".lpm", "skills")
			if (fs.existsSync(localSkillsDir)) {
				const skillFiles = fs
					.readdirSync(localSkillsDir)
					.filter(f => f.endsWith(".md"))
					.sort()

				if (skillFiles.length > 0) {
					// Read local skills content
					const localSkills = skillFiles.map(f => ({
						name: f.replace(/\.md$/, ""),
						rawContent: fs.readFileSync(path.join(localSkillsDir, f), "utf8"),
					}))

					// Fetch published skills for comparison
					const cleanedName = name.startsWith("@lpm.dev/")
						? name.replace("@lpm.dev/", "")
						: `${owner}.${packageName}`
					const skillsResponse = await request(
						`/skills?name=${encodeURIComponent(cleanedName)}`,
						{ method: "GET" },
					).catch(() => null)

					if (skillsResponse?.ok) {
						const published = await skillsResponse.json()
						if (published.available && published.skills?.length > 0) {
							const pubSorted = [...published.skills]
								.map(s => ({ name: s.name, rawContent: s.rawContent }))
								.sort((a, b) => a.name.localeCompare(b.name))

							const isIdentical =
								localSkills.length === pubSorted.length &&
								localSkills.every(
									(local, i) =>
										local.name === pubSorted[i].name &&
										local.rawContent === pubSorted[i].rawContent,
								)

							if (isIdentical) {
								prePublishWarnings.push(
									`Agent Skills haven't changed since v${published.version} - consider reviewing them for accuracy`,
								)
							}
						}
					}
				}
			}
		} catch {
			// Non-critical — skip skills staleness check
		}

		spinner.stop()
		displayQualityReport({ ...qualityResult, warnings: prePublishWarnings })

		// --dry-run: print summary and exit without uploading
		if (dryRun) {
			const unpackedSize = npmPackMeta.unpackedSize || 0
			const fileCount =
				npmPackMeta.fileCount || (npmPackMeta.files?.length ?? 0)
			const sizeStr =
				unpackedSize >= 1024 * 1024
					? `${(unpackedSize / 1024 / 1024).toFixed(1)} MB unpacked`
					: `${(unpackedSize / 1024).toFixed(1)} kB unpacked`

			const githubOidc = isGitHubActionsWithOidc()
			const gitlabOidc = isGitLabCiWithOidc()
			const oidcStr = githubOidc
				? "GitHub Actions detected ✓"
				: gitlabOidc
					? "GitLab CI detected ✓"
					: "Not running in CI"
			const authStr =
				githubOidc || gitlabOidc
					? "Token will be exchanged at publish time"
					: "Run lpm login or configure Trusted Publishers"

			console.log("")
			console.log(`  Package  ${name}`)
			console.log(`  Version  ${version}`)
			console.log(`  Files    ${fileCount} files`)
			console.log(`  Size     ${sizeStr}`)
			console.log("")
			console.log(`  OIDC     ${oidcStr}`)
			console.log(`  Auth     ${authStr}`)
			console.log("")
			log.info("Dry run complete — run without --dry-run to publish.")
			process.exit(0)
		}

		// --check mode: display report and exit
		if (checkOnly) {
			if (minScore && qualityResult.score < minScore) {
				log.error(
					`Quality score ${qualityResult.score} is below minimum ${minScore}.`,
				)
				process.exit(1)
			}
			process.exit(0)
		}

		// --min-score gate: block publish if score is too low
		if (minScore && qualityResult.score < minScore) {
			log.error(
				`Quality score ${qualityResult.score} is below minimum ${minScore}. Publish blocked.`,
			)
			log.info('Run "lpm publish --check" to see improvement suggestions.')
			process.exit(1)
		}

		// 8. Confirmation prompt (after quality report so user can decide)
		const shouldPublish = await p.confirm({
			message: `Publish ${name}@${version}?`,
			initialValue: true,
		})

		if (p.isCancel(shouldPublish) || !shouldPublish) {
			p.cancel("Publish cancelled.")
			process.exit(0)
		}

		// 8.5. OIDC auto-detection: exchange a GitHub Actions or GitLab CI OIDC
		// token for a short-lived LPM publish token. Runs before auth verification
		// so that verifyTokenScope() picks up the OIDC token via getToken().
		const githubOidcAvailable = isGitHubActionsWithOidc()
		const gitlabOidcAvailable = isGitLabCiWithOidc()
		const oidcAvailable = githubOidcAvailable || gitlabOidcAvailable

		if (forceProvenance && !oidcAvailable) {
			p.cancel(
				"--provenance requires OIDC to be available. " +
					"For GitHub Actions, ensure `id-token: write` permission. " +
					"For GitLab CI, configure id_tokens in your job.",
			)
			process.exit(1)
		}
		if (oidcAvailable) {
			spinner.start()
			if (githubOidcAvailable) {
				spinner.text = "Requesting OIDC token from GitHub Actions..."
			} else {
				spinner.text = "Exchanging GitLab CI OIDC token..."
			}
			try {
				const oidcToken = githubOidcAvailable
					? await exchangeOidcToken(name)
					: await exchangeGitLabOidcToken(name)
				setTransientToken(oidcToken)
				spinner.stop()
				const provider = githubOidcAvailable ? "GitHub Actions" : "GitLab CI"
				log.success(
					`OIDC authentication successful (${provider} — no secrets needed)`,
				)
			} catch (err) {
				spinner.stop()
				if (forceProvenance) {
					// When --provenance is explicit, a failure is fatal
					throw new Error(`OIDC exchange failed: ${err.message}`)
				}
				// Auto-detection: non-fatal, fall back to configured credentials
				log.warn(`OIDC exchange failed: ${err.message}`)
				log.warn("Falling back to stored credentials...")
			}
		}

		// 9. Verify authentication and owner permissions
		spinner.start()
		spinner.text = "Verifying authentication..."
		const scopeResult = await verifyTokenScope("publish")

		if (!scopeResult.valid) {
			throw new Error(scopeResult.error)
		}

		spinner.text = "Checking owner permissions..."

		const whoamiResponse = await request("/-/whoami")
		if (whoamiResponse.ok) {
			whoami = await whoamiResponse.json()

			const availableOwners = []
			if (whoami.profile_username) {
				availableOwners.push(whoami.profile_username)
			}
			whoami.organizations?.forEach(org => {
				availableOwners.push(org.slug)
			})

			if (!availableOwners.includes(owner)) {
				spinner.stop()
				const registryUrl = getRegistryUrl()

				log.error(
					`You don't have permission to publish under "@lpm.dev/${owner}".`,
				)
				console.log("")

				if (!whoami.profile_username) {
					log.warn(WARNING_MESSAGES.usernameNotSet)
					log.warn(`  Set it at: ${registryUrl}/dashboard/settings`)
					console.log("")
				}

				if (whoami.organizations?.length > 0) {
					log.info("Your available owners:")
					if (whoami.profile_username) {
						log.info(`  @lpm.dev/${whoami.profile_username}.* (personal)`)
					}
					for (const org of whoami.organizations) {
						log.info(`  @lpm.dev/${org.slug}.* (organization)`)
					}
				} else {
					log.warn(WARNING_MESSAGES.noOrganizations)
					log.warn(WARNING_MESSAGES.createOrgHint(registryUrl))
				}

				console.log("")
				log.info(WARNING_MESSAGES.ownerFixHint)
				process.exit(1)
			}
		}

		// 9.5. Pre-upload 2FA check — prompt for OTP BEFORE uploading the tarball
		// This avoids uploading the entire tarball twice for large packages.
		let otpCode = null
		if (!oidcAvailable && whoami) {
			const userHas2fa = whoami.mfa_enabled
			const publishingOrg = whoami.organizations?.find(
				org => org.slug === owner,
			)
			const orgRequires2fa = publishingOrg?.require_2fa

			if (orgRequires2fa && !userHas2fa) {
				spinner.stop()
				log.error(
					"This organization requires two-factor authentication. Enable 2FA in your account settings.",
				)
				process.exit(1)
			}

			if (userHas2fa || orgRequires2fa) {
				spinner.stop()
				otpCode = await p.text({
					message: "Enter 2FA code",
					placeholder: "123456",
					validate: value => {
						if (!/^\d{6}$/.test(value))
							return "Enter a 6-digit code from your authenticator app"
					},
				})

				if (p.isCancel(otpCode)) {
					p.cancel("Publish cancelled.")
					process.exit(0)
				}
				spinner.start()
			}
		}

		// 10. Read tarball and generate integrity hashes
		spinner.text = "Reading tarball..."
		const tarballData = await readFileAsync(tarballPath)
		const tarballBase64 = tarballData.toString("base64")
		const shasum = createHash("sha1").update(tarballData).digest("hex")
		const integrity = generateIntegrity(tarballData, "sha512")

		// 11. Build version metadata
		const versionData = {
			...pkg,
			_id: `${name}@${version}`,
			name: name,
			version: version,
			readme: readme,
			dist: {
				shasum: shasum,
				integrity: integrity,
				tarball: `${getRegistryUrl()}/api/registry/${name}/-/${name}-${version}.tgz`,
			},
			_npmPackMeta: npmPackMeta,
			...(lpmConfig && { _lpmConfig: lpmConfig }),
			_qualityChecks: qualityResult.checks,
			_qualityMeta: qualityResult.meta,
		}

		// Add ecosystem-specific metadata
		if (ecosystem !== "js") {
			versionData._ecosystem = ecosystem
		}

		if (swiftManifest) {
			versionData._swiftManifest = swiftManifest
		}

		if (xcFramework?.found) {
			versionData._packageType = "xcframework"
			versionData._xcframeworkMeta = {
				name: xcFramework.name,
				slices: xcFramework.slices,
				formatVersion: xcFramework.formatVersion,
			}
		}

		// 12. Upload to registry
		spinner.text = `Uploading ${name}@${version}...`
		const payload = {
			_id: name,
			name: name,
			description: pkg.description,
			"dist-tags": {
				latest: version,
			},
			versions: {
				[version]: versionData,
			},
			_attachments: {
				[`${name}-${version}.tgz`]: {
					content_type: "application/octet-stream",
					data: tarballBase64,
					length: tarballData.length,
				},
			},
		}

		// Include ecosystem in top-level payload for API to store in packageSettings
		if (ecosystem !== "js") {
			payload._ecosystem = ecosystem
		}

		const publishHeaders = {
			"Content-Type": "application/json",
		}

		// Include OTP header if 2FA code was collected pre-upload
		if (otpCode) {
			publishHeaders["x-otp"] = otpCode
		}

		const response = await request(`/${encodeURIComponent(name)}`, {
			method: "PUT",
			body: JSON.stringify(payload),
			headers: publishHeaders,
			onRetry: (attempt, max) => {
				spinner.text = `Uploading to registry (retry ${attempt}/${max})...`
			},
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Publish failed: ${response.status} ${errorText}`)
		}

		// Parse response for warnings (e.g., skills staleness)
		let publishResult = {}
		try {
			publishResult = await response.json()
		} catch {
			// Response may not be JSON - that's fine
		}

		// Success message with dashboard link
		const registryUrl = getRegistryUrl()
		const isOrgOwner = whoami?.organizations?.some(org => org.slug === owner)

		if (isOrgOwner) {
			spinner.succeed(
				SUCCESS_MESSAGES.publishOrg(registryUrl, owner, packageName, version),
			)
		} else {
			spinner.succeed(
				SUCCESS_MESSAGES.publishPersonal(
					registryUrl,
					owner,
					packageName,
					version,
				),
			)
		}

		// Server may still return warnings for edge cases not caught client-side
		if (publishResult.warnings?.length > 0) {
			const newWarnings = publishResult.warnings.filter(
				w => !prePublishWarnings.includes(w),
			)
			if (newWarnings.length > 0) {
				console.log("")
				for (const warning of newWarnings) {
					log.warn(warning)
				}
			}
		}
	} catch (error) {
		spinner.fail(`Publish error: ${error.message}`)

		// Show upgrade link for personal account limit errors
		const registryUrl = getRegistryUrl()
		const isLimitError =
			error.message.includes("limit exceeded") ||
			error.message.includes("Upgrade to Pro")

		if (isLimitError) {
			const isOrgOwner = whoami?.organizations?.some(org => org.slug === owner)
			if (!isOrgOwner) {
				console.log("")
				log.info(`Upgrade plan: ${registryUrl}/dashboard/settings/billing`)
			}
		}

		process.exit(1)
	} finally {
		// Clear OIDC transient token so it doesn't leak into subsequent operations
		clearTransientToken()

		// Cleanup tarball (even on error)
		if (tarballPath && fs.existsSync(tarballPath)) {
			try {
				fs.unlinkSync(tarballPath)
			} catch {
				// Ignore cleanup errors
			}
		}
	}
}
