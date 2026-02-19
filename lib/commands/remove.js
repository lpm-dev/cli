import * as p from '@clack/prompts'
import chalk from 'chalk'
import { getRegistryUrl, getToken } from '../config.js'
import { hasCustomHandler, getHandler } from '../install-targets.js'

/**
 * Remove a previously added package.
 *
 * For packages with custom install handlers (e.g., MCP servers), this
 * delegates to the handler's remove function. For standard source packages,
 * it advises manual removal since files were copied into the project.
 *
 * @param {string} pkgName - Package name (e.g., "@lpm.dev/owner.my-pkg")
 * @param {object} options - CLI options
 */
export async function remove(pkgName, options) {
	p.intro(chalk.bgCyan(chalk.black(' lpm remove ')))

	// 1. Auth Check
	const token = await getToken()
	if (!token) {
		p.log.error('Not logged in. Run `lpm login` first.')
		p.outro('')
		return
	}

	// 2. Normalize package name
	const name = pkgName.startsWith('@lpm.dev/')
		? pkgName
		: `@lpm.dev/${pkgName}`

	// 3. Fetch package metadata to determine type
	const baseRegistryUrl = getRegistryUrl()
	const registryUrl = baseRegistryUrl.endsWith('/api/registry')
		? baseRegistryUrl
		: `${baseRegistryUrl}/api/registry`
	const encodedName = name.replace('/', '%2f')

	let meta
	try {
		const res = await fetch(`${registryUrl}/${encodedName}`, {
			headers: { Authorization: `Bearer ${token}` },
		})

		if (!res.ok) {
			if (res.status === 404) {
				p.log.error(`Package '${name}' not found.`)
				p.outro('')
				return
			}
			throw new Error(res.statusText)
		}

		meta = await res.json()
	} catch (err) {
		p.log.error(`Failed to fetch package info: ${err.message}`)
		p.outro('')
		return
	}

	// 4. Determine package type from latest version's lpmConfig
	const latestVersion = meta['dist-tags']?.latest
	const versionData = latestVersion ? meta.versions[latestVersion] : null
	const packageType = versionData?.lpmConfig?.type || meta.packageType

	// 5. Route to type-specific handler or show manual instructions
	if (packageType && hasCustomHandler(packageType)) {
		const handler = getHandler(packageType)
		const result = await handler.remove({ name })

		if (result.success) {
			p.log.success(result.message)
		} else {
			p.log.error(result.message)
		}
	} else {
		p.log.info(
			`${chalk.cyan(name)} was installed as source files copied into your project.`,
		)
		p.log.info('Remove the files manually from your project directory.')
	}

	p.outro('')
}
