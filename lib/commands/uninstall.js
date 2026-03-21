import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { getPackageManager, getRegistryUrl, getToken } from "../config.js"
import { createSpinner, log, printHeader } from "../ui.js"

/**
 * Uninstall LPM packages.
 * Creates a temporary .npmrc with auth, runs the package manager's uninstall, and cleans up.
 *
 * @param {string[]} packages - Package names to uninstall
 * @param {object} [options]
 * @param {string} [options.pm] - Package manager override (npm, pnpm, yarn, bun)
 */
export async function uninstall(packages, options) {
	printHeader()

	if (!packages || packages.length === 0) {
		log.error("Please specify at least one package to uninstall.")
		log.info("Usage: lpm uninstall @lpm.dev/owner.package-name")
		process.exit(1)
	}

	const token = await getToken()
	if (!token) {
		log.error(
			'You must be logged in to uninstall packages. Run "lpm login" first.',
		)
		process.exit(1)
	}

	const pm = getPackageManager(options?.pm)
	const spinner = createSpinner(
		`Preparing to uninstall ${packages.join(", ")}...`,
	).start()

	const baseRegistryUrl = getRegistryUrl()
	const registryUrl = baseRegistryUrl.endsWith("/api/registry")
		? baseRegistryUrl
		: `${baseRegistryUrl}/api/registry`
	const registryHost = registryUrl.replace(/^https?:/, "")

	const npmrcContent = `${registryHost}/:_authToken=${token}
@lpm.dev:registry=${registryUrl}
`

	const projectNpmrcPath = path.resolve(process.cwd(), ".npmrc")
	let existingNpmrc = null
	let tempNpmrcPath = null

	if (pm === "npm") {
		tempNpmrcPath = path.resolve(process.cwd(), `.npmrc.lpm-${Date.now()}`)
		fs.writeFileSync(tempNpmrcPath, npmrcContent)
	} else {
		if (fs.existsSync(projectNpmrcPath)) {
			existingNpmrc = fs.readFileSync(projectNpmrcPath, "utf8")
		}
		fs.writeFileSync(projectNpmrcPath, npmrcContent)
	}

	spinner.succeed(`Configuration generated. Running ${pm} uninstall...`)

	const pmArgs =
		pm === "npm"
			? ["uninstall", ...packages, "--userconfig", tempNpmrcPath]
			: ["uninstall", ...packages]

	const child = spawn(pm, pmArgs, {
		stdio: "inherit",
		env: { ...process.env, LPM_TOKEN: token },
	})

	const cleanup = () => {
		if (pm === "npm") {
			if (tempNpmrcPath && fs.existsSync(tempNpmrcPath)) {
				fs.unlinkSync(tempNpmrcPath)
			}
		} else {
			if (existingNpmrc !== null) {
				fs.writeFileSync(projectNpmrcPath, existingNpmrc)
			} else if (fs.existsSync(projectNpmrcPath)) {
				fs.unlinkSync(projectNpmrcPath)
			}
		}
	}

	child.on("close", code => {
		cleanup()
		if (code !== 0) {
			log.error(`${pm} uninstall failed with code ${code}`)
			process.exit(code)
		} else {
			log.success("Packages uninstalled successfully.")
		}
	})

	child.on("error", err => {
		log.error(`Failed to start ${pm}: ${err.message}`)
		cleanup()
		process.exit(1)
	})

	process.on("SIGINT", () => {
		cleanup()
		process.exit()
	})
}
