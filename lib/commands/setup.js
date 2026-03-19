import fs from "node:fs"
import path from "node:path"
import * as p from "@clack/prompts"
import chalk from "chalk"
import { getRegistryUrl } from "../config.js"
import { exchangeOidcInstallToken } from "../oidc.js"
import { log, printHeader } from "../ui.js"

/**
 * Remove existing LPM config lines from .npmrc content.
 * @param {string} content
 * @returns {string}
 */
function removeLpmLines(content) {
	return content
		.split("\n")
		.filter(line => {
			return (
				!line.includes("@lpm.dev:registry") &&
				!line.includes("lpm.dev/api/registry/:_authToken") &&
				!line.includes("_authToken=lpm_") &&
				// biome-ignore lint/suspicious/noTemplateCurlyInString: matching literal npm token placeholder
				!line.includes("_authToken=${LPM_TOKEN}") &&
				!line.includes("# LPM Registry")
			)
		})
		.join("\n")
		.trim()
}

/**
 * Configure .npmrc for LPM packages.
 *
 * Default mode: writes ${LPM_TOKEN} placeholder (for CI with env var).
 * --oidc mode: exchanges CI OIDC token for a real short-lived token (no secrets needed).
 */
export async function setup(options) {
	printHeader()

	p.intro(chalk.bgCyan(chalk.black(" lpm setup ")))

	const registryUrl = options?.registry || getRegistryUrl()
	const projectRoot = process.cwd()
	const npmrcPath = path.join(projectRoot, ".npmrc")

	// Check for package.json
	const pkgJsonPath = path.join(projectRoot, "package.json")
	if (!fs.existsSync(pkgJsonPath)) {
		log.warn("No package.json found. Run this command in your project root.")
	}

	// Build registry URL
	const fullRegistryUrl = registryUrl.endsWith("/api/registry")
		? registryUrl
		: `${registryUrl}/api/registry`
	const registryHost = fullRegistryUrl.replace(/^https?:/, "")

	// ── OIDC mode: exchange CI token for a real short-lived install token ──
	if (options?.oidc) {
		let oidcToken
		try {
			oidcToken = await exchangeOidcInstallToken()
		} catch (err) {
			log.warn(`OIDC exchange failed: ${err.message}`)
			// biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder name in user-facing message
			log.warn("Falling back to ${LPM_TOKEN} environment variable placeholder.")
			// Fall through to default mode
		}

		if (oidcToken) {
			let npmrcContent = ""
			if (fs.existsSync(npmrcPath)) {
				npmrcContent = removeLpmLines(fs.readFileSync(npmrcPath, "utf8"))
			}

			const lpmConfig = `# LPM Registry (OIDC — expires in 30 minutes)
@lpm.dev:registry=${fullRegistryUrl}
${registryHost}/:_authToken=${oidcToken}`

			npmrcContent = npmrcContent
				? `${npmrcContent}\n\n${lpmConfig}`
				: lpmConfig
			fs.writeFileSync(npmrcPath, `${npmrcContent}\n`)

			p.note(
				`@lpm.dev:registry=${fullRegistryUrl}\nToken: OIDC read-only (30 min)`,
				".npmrc configuration",
			)

			console.log("")
			log.success(".npmrc configured with OIDC read-only token.")
			log.info("Token expires in 30 minutes. No LPM_TOKEN secret needed.")
			console.log("")

			p.outro("Setup complete!")
			return
		}
	}

	// ── Default mode: ${LPM_TOKEN} placeholder ──

	// Check for existing .npmrc
	let npmrcContent = ""
	if (fs.existsSync(npmrcPath)) {
		npmrcContent = fs.readFileSync(npmrcPath, "utf8")

		// Check if already configured
		if (npmrcContent.includes("@lpm.dev:registry")) {
			const overwrite = await p.confirm({
				message: ".npmrc already has LPM configuration. Overwrite?",
				initialValue: false,
			})

			if (p.isCancel(overwrite) || !overwrite) {
				p.outro("Setup cancelled.")
				return
			}

			npmrcContent = removeLpmLines(npmrcContent)
		}
	}

	// Add LPM registry config with placeholder
	const lpmConfig = `
# LPM Registry
@lpm.dev:registry=${fullRegistryUrl}
${registryHost}/:_authToken=\${LPM_TOKEN}
`.trim()

	npmrcContent = npmrcContent ? `${npmrcContent}\n\n${lpmConfig}` : lpmConfig
	fs.writeFileSync(npmrcPath, `${npmrcContent}\n`)

	p.note(
		`@lpm.dev:registry=${fullRegistryUrl}\n${registryHost}/:_authToken=\${LPM_TOKEN}`,
		".npmrc configuration",
	)

	console.log("")
	log.success(".npmrc configured for LPM packages.")
	log.info("For local development: Run `lpm npmrc` to generate a token.")
	log.info("For CI/CD: Set the LPM_TOKEN environment variable.")
	log.info("For CI/CD with OIDC: Run `lpm setup --oidc` (no secrets needed).")
	console.log("")

	p.outro("Setup complete!")
}
