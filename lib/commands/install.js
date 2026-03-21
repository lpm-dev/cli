import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { getPackageManager, getRegistryUrl, getToken } from "../config.js"
import { createSpinner, log, printHeader } from "../ui.js"
import { skillsInstall } from "./skills.js"

/**
 * Check if a package name is an LPM package
 * LPM packages use the @lpm.dev scope
 */
function isLpmPackage(pkgName) {
	return pkgName.startsWith("@lpm.dev/")
}

export async function install(packages, options) {
	const isJson = options?.json

	if (!isJson) printHeader()

	const token = await getToken()
	if (!token) {
		if (isJson) {
			process.stdout.write(
				`${JSON.stringify(
					{
						success: false,
						packages: [],
						npmOutput: "",
						warnings: [],
						errors: [
							'You must be logged in to install packages. Run "lpm login" first.',
						],
					},
					null,
					2,
				)}\n`,
			)
		} else {
			log.error(
				'You must be logged in to install packages. Run "lpm login" first.',
			)
		}
		process.exit(1)
	}

	// Track if user specified packages explicitly (for scoped skills fetch)
	const explicitPackages = packages && packages.length > 0

	if (!packages || packages.length === 0) {
		// No packages specified - read from package.json
		const packageJsonPath = path.resolve(process.cwd(), "package.json")
		if (!fs.existsSync(packageJsonPath)) {
			if (isJson) {
				process.stdout.write(
					`${JSON.stringify(
						{
							success: false,
							packages: [],
							npmOutput: "",
							warnings: [],
							errors: ["No packages specified and no package.json found."],
						},
						null,
						2,
					)}\n`,
				)
			} else {
				log.error("No packages specified and no package.json found.")
			}
			process.exit(1)
		}

		const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
		const allDeps = {
			...pkg.dependencies,
			...pkg.devDependencies,
		}

		// Filter to LPM packages only (@lpm.dev scope)
		packages = Object.keys(allDeps).filter(isLpmPackage)

		if (packages.length === 0) {
			if (isJson) {
				process.stdout.write(
					`${JSON.stringify(
						{
							success: true,
							packages: [],
							npmOutput: "",
							warnings: ["No LPM packages (@lpm.dev/*) found in package.json."],
							errors: [],
						},
						null,
						2,
					)}\n`,
				)
			} else {
				log.info("No LPM packages (@lpm.dev/*) found in package.json.")
			}
			process.exit(0)
		}

		if (!isJson) {
			log.info(`Found ${packages.length} LPM packages in package.json:`)
			for (const pkg of packages) {
				log.info(`  ${pkg}`)
			}
		}
	}

	let spinner
	if (!isJson) {
		spinner = createSpinner("Configuring registry authentication...").start()
	}

	const baseRegistryUrl = getRegistryUrl()
	// Ensure we have the full registry path for npm
	const registryUrl = baseRegistryUrl.endsWith("/api/registry")
		? baseRegistryUrl
		: `${baseRegistryUrl}/api/registry`
	// Remove protocol for auth token config (e.g. https://registry.com/ -> //registry.com/)
	const registryHost = registryUrl.replace(/^https?:/, "")

	// Create temporary .npmrc content
	// Simple configuration - all LPM packages use @lpm.dev scope
	const npmrcContent = `${registryHost}/:_authToken=${token}
@lpm.dev:registry=${registryUrl}
`

	const pm = getPackageManager(options?.pm)

	// For npm we can use --userconfig with a temp file.
	// For pnpm/yarn/bun we write a temporary project .npmrc (all PMs read it).
	const projectNpmrcPath = path.resolve(process.cwd(), ".npmrc")
	let existingNpmrc = null
	let tempNpmrcPath = null

	if (pm === "npm") {
		// npm supports --userconfig — use a separate temp file (doesn't touch project .npmrc)
		tempNpmrcPath = path.resolve(process.cwd(), `.npmrc.lpm-${Date.now()}`)
		fs.writeFileSync(tempNpmrcPath, npmrcContent)
	} else {
		// pnpm/yarn/bun read project .npmrc — back up existing, write temp, restore after
		if (fs.existsSync(projectNpmrcPath)) {
			existingNpmrc = fs.readFileSync(projectNpmrcPath, "utf8")
		}
		fs.writeFileSync(projectNpmrcPath, npmrcContent)
	}

	if (!isJson) {
		spinner.succeed(`Configuration generated. Running ${pm} install...`)
	}

	const pmArgs =
		pm === "npm"
			? ["install", ...packages, "--userconfig", tempNpmrcPath]
			: ["install", ...packages]

	// In JSON mode, capture stdout/stderr instead of inheriting
	const child = spawn(pm, pmArgs, {
		stdio: isJson ? "pipe" : "inherit",
		env: { ...process.env, LPM_TOKEN: token },
	})

	const cleanup = () => {
		if (pm === "npm") {
			// Remove temp file
			if (tempNpmrcPath && fs.existsSync(tempNpmrcPath)) {
				fs.unlinkSync(tempNpmrcPath)
			}
		} else {
			// Restore original .npmrc (or remove if there wasn't one)
			if (existingNpmrc !== null) {
				fs.writeFileSync(projectNpmrcPath, existingNpmrc)
			} else if (fs.existsSync(projectNpmrcPath)) {
				fs.unlinkSync(projectNpmrcPath)
			}
		}
	}

	const fetchSkills = options?.skills !== false

	if (isJson) {
		let stdout = ""
		let stderr = ""
		child.stdout.on("data", data => {
			stdout += data.toString()
		})
		child.stderr.on("data", data => {
			stderr += data.toString()
		})

		child.on("close", async code => {
			cleanup()
			const output = {
				success: code === 0,
				packages: packages.map(p => ({ name: p })),
				npmOutput: (stdout + stderr).trim(),
				warnings: [],
				errors: code !== 0 ? [`${pm} install failed with code ${code}`] : [],
			}
			process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
			if (code !== 0) process.exit(code)
			if (fetchSkills) {
				if (explicitPackages) {
					for (const pkg of packages.filter(isLpmPackage)) {
						await skillsInstall(pkg, { json: true })
					}
				} else {
					await skillsInstall(null, { json: true })
				}
			}
		})

		child.on("error", err => {
			cleanup()
			const output = {
				success: false,
				packages: packages.map(p => ({ name: p })),
				npmOutput: "",
				warnings: [],
				errors: [`Failed to start ${pm}: ${err.message}`],
			}
			process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
			process.exit(1)
		})
	} else {
		child.on("close", async code => {
			cleanup()
			if (code !== 0) {
				log.error(`${pm} install failed with code ${code}`)
				process.exit(code)
			} else {
				log.success("Packages installed successfully.")
				if (fetchSkills) {
					console.log("")
					if (explicitPackages) {
						for (const pkg of packages.filter(isLpmPackage)) {
							await skillsInstall(pkg)
						}
					} else {
						await skillsInstall(null)
					}
				}
			}
		})

		child.on("error", err => {
			log.error(`Failed to start ${pm}: ${err.message}`)
			cleanup()
			process.exit(1)
		})
	}

	// Handle interrupt to cleanup
	process.on("SIGINT", () => {
		cleanup()
		process.exit()
	})
}
