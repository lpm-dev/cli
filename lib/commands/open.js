import fs from "node:fs"
import path from "node:path"
import open from "open"
import { request } from "../api.js"
import { getRegistryUrl } from "../config.js"
import { createSpinner } from "../ui.js"

/**
 * Parse owner from LPM package name.
 * @param {string} name - Package name (e.g., '@lpm.dev/owner.pkg-name')
 * @returns {{ owner: string, pkgName: string } | null}
 */
function parseOwner(name) {
	if (name.startsWith("@lpm.dev/")) {
		const nameWithOwner = name.replace("@lpm.dev/", "")
		const dotIndex = nameWithOwner.indexOf(".")
		if (dotIndex === -1) return null
		return {
			owner: nameWithOwner.substring(0, dotIndex),
			pkgName: nameWithOwner.substring(dotIndex + 1),
		}
	}
	return null
}

export async function openDashboard() {
	const spinner = createSpinner("Opening dashboard...").start()
	const registryUrl = getRegistryUrl()

	// Default URL
	let url = `${registryUrl}/dashboard`

	// Check if we are in a package directory
	const pkgPath = path.join(process.cwd(), "package.json")
	if (fs.existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
			const parsed = parseOwner(pkg.name)

			if (parsed) {
				const { owner, pkgName } = parsed
				spinner.text = `Detected package ${pkg.name}. Checking owner...`

				// Fetch user info to determine if owner is personal or org
				try {
					const response = await request("/-/whoami")
					if (response.ok) {
						const data = await response.json()

						// Check if owner matches user's personal username
						if (data.profile_username && data.profile_username === owner) {
							url = `${registryUrl}/dashboard/packages`
							spinner.text = `Opening personal packages dashboard...`
						}
						// Check if owner matches one of user's organizations
						else if (data.organizations?.some(org => org.slug === owner)) {
							url = `${registryUrl}/dashboard/orgs/${owner}/packages`
							spinner.text = `Opening ${owner} organization packages...`
						}
						// Owner not recognized, fall back to public package page
						else {
							url = `${registryUrl}/${owner}.${pkgName}`
							spinner.text = `Opening public package page...`
						}
					} else {
						// Not authenticated, open public package page
						url = `${registryUrl}/${owner}.${pkgName}`
						spinner.text = `Opening public package page...`
					}
				} catch (_apiError) {
					// API error, fall back to dashboard
					url = `${registryUrl}/dashboard`
				}
			}
		} catch (_e) {
			// ignore JSON parse errors
		}
	}

	await open(url)
	spinner.succeed(`Opened ${url}`)
}
