import fs from "node:fs"
import path from "node:path"
import * as p from "@clack/prompts"
import chalk from "chalk"
import { getRegistryUrl } from "../config.js"
import { exchangeOidcInstallToken } from "../oidc.js"
import { log, printHeader } from "../ui.js"

/**
 * Remove existing LPM config lines from .npmrc content.
 * Handles both scoped (@lpm.dev:registry=) and unscoped (registry=...lpm.dev) formats.
 * @param {string} content
 * @returns {string}
 */
function removeLpmLines(content) {
	return content
		.split("\n")
		.filter(line => {
			return (
				!line.includes("@lpm.dev:registry") &&
				!line.match(/^registry=.*lpm\.dev/) &&
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
 * Check if .npmrc has a custom default registry that is NOT npmjs.org or lpm.dev.
 * @param {string} content - Existing .npmrc content
 * @returns {string|null} The custom registry line, or null if none found
 */
function detectCustomRegistry(content) {
	return (
		content
			.split("\n")
			.find(
				line =>
					line.match(/^registry=/) &&
					!line.includes("registry.npmjs.org") &&
					!line.includes("lpm.dev"),
			) || null
	)
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

	// Determine proxy vs scoped mode
	let useScoped = !!options?.scoped

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
				const existingContent = fs.readFileSync(npmrcPath, "utf8")

				// Detect custom default registry
				if (!useScoped) {
					const customRegistry = detectCustomRegistry(existingContent)
					if (customRegistry) {
						log.warn(
							`Found existing default registry: ${customRegistry.trim()}`,
						)
						log.warn("Using --scoped mode to avoid overriding it.")
						useScoped = true
					}
				}

				npmrcContent = removeLpmLines(existingContent)
			}

			const registryLine = useScoped
				? `@lpm.dev:registry=${fullRegistryUrl}`
				: `registry=${fullRegistryUrl}`

			const lpmConfig = `# LPM Registry (OIDC — expires in 30 minutes)
${registryLine}
${registryHost}/:_authToken=${oidcToken}`

			npmrcContent = npmrcContent
				? `${npmrcContent}\n\n${lpmConfig}`
				: lpmConfig
			fs.writeFileSync(npmrcPath, `${npmrcContent}\n`)

			p.note(
				`${registryLine}\nToken: OIDC read-only (30 min)`,
				".npmrc configuration",
			)

			console.log("")
			log.success(".npmrc configured with OIDC read-only token.")
			log.info("Token expires in 30 minutes. No LPM_TOKEN secret needed.")
			if (!useScoped) {
				log.info("All packages (LPM + npm) will route through lpm.dev.")
			}
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

		// Detect custom default registry
		if (!useScoped) {
			const customRegistry = detectCustomRegistry(npmrcContent)
			if (customRegistry) {
				log.warn(`Found existing default registry: ${customRegistry.trim()}`)
				log.warn("Using --scoped mode to avoid overriding it.")
				log.warn(
					"To use LPM as your default registry, remove the existing registry= line first.",
				)
				useScoped = true
			}
		}

		// Check if already configured (both scoped and unscoped formats)
		if (
			npmrcContent.includes("@lpm.dev:registry") ||
			npmrcContent.match(/^registry=.*lpm\.dev/m)
		) {
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

	const registryLine = useScoped
		? `@lpm.dev:registry=${fullRegistryUrl}`
		: `registry=${fullRegistryUrl}`

	// Add LPM registry config with placeholder
	const lpmConfig = `
# LPM Registry
${registryLine}
${registryHost}/:_authToken=\${LPM_TOKEN}
`.trim()

	npmrcContent = npmrcContent ? `${npmrcContent}\n\n${lpmConfig}` : lpmConfig
	fs.writeFileSync(npmrcPath, `${npmrcContent}\n`)

	p.note(
		`${registryLine}\n${registryHost}/:_authToken=\${LPM_TOKEN}`,
		".npmrc configuration",
	)

	console.log("")
	log.success(".npmrc configured for LPM registry.")
	if (useScoped) {
		log.info("Only @lpm.dev packages will route through lpm.dev.")
	} else {
		log.info("All packages (LPM + npm) will route through lpm.dev.")
		log.info("Note: First install may update resolved URLs in your lockfile.")
	}
	log.info("For local development: Run `lpm npmrc` to generate a token.")
	log.info("For CI/CD: Set the LPM_TOKEN environment variable.")
	log.info("For CI/CD with OIDC: Run `lpm setup --oidc` (no secrets needed).")
	console.log("")

	p.outro("Setup complete!")
}
