import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { getRegistryUrl, getToken } from "../config.js"
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
			log.info(
				`Installing ${packages.length} LPM packages from package.json...`,
			)
		}
	}

	let spinner
	if (!isJson) {
		spinner = createSpinner(
			`Preparing to install ${packages.join(", ")}...`,
		).start()
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

	// Write to temp file
	const tempNpmrcPath = path.resolve(process.cwd(), `.npmrc.lpm-${Date.now()}`)
	fs.writeFileSync(tempNpmrcPath, npmrcContent)

	if (!isJson) {
		spinner.succeed("Configuration generated. Running npm install...")
	}

	// Run npm install
	const npmArgs = ["install", ...packages, "--userconfig", tempNpmrcPath]

	// In JSON mode, capture stdout/stderr instead of inheriting
	const child = spawn("npm", npmArgs, {
		stdio: isJson ? "pipe" : "inherit",
		env: { ...process.env, LPM_TOKEN: token },
	})

	const cleanup = () => {
		if (fs.existsSync(tempNpmrcPath)) {
			fs.unlinkSync(tempNpmrcPath)
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
				errors: code !== 0 ? [`npm install failed with code ${code}`] : [],
			}
			process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
			if (code !== 0) process.exit(code)
			if (fetchSkills) await skillsInstall(null, { json: true })
		})

		child.on("error", err => {
			cleanup()
			const output = {
				success: false,
				packages: packages.map(p => ({ name: p })),
				npmOutput: "",
				warnings: [],
				errors: [`Failed to start npm: ${err.message}`],
			}
			process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
			process.exit(1)
		})
	} else {
		child.on("close", async code => {
			cleanup()
			if (code !== 0) {
				log.error(`npm install failed with code ${code}`)
				process.exit(code)
			} else {
				log.success("Packages installed successfully.")
				if (fetchSkills) {
					console.log("")
					await skillsInstall(null)
				}
			}
		})

		child.on("error", err => {
			log.error(`Failed to start npm: ${err.message}`)
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
