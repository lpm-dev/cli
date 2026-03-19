/**
 * OIDC (OpenID Connect) token exchange for secret-free CI operations.
 *
 * When running in GitHub Actions with `id-token: write` permission,
 * this module requests an OIDC JWT from GitHub and exchanges it for
 * a short-lived LPM token — no LPM_TOKEN secret required.
 *
 * Two modes:
 * - **Publish**: Requires trusted publisher config in LPM dashboard.
 * - **Read (install)**: Requires GitHub/GitLab account linked to LPM user.
 *
 * @module cli/lib/oidc
 */

import { getRegistryUrl } from "./config.js"

/**
 * Detect whether we are running in GitHub Actions with OIDC available.
 * Both env vars must be set for token request to work.
 *
 * @returns {boolean}
 */
export function isGitHubActionsWithOidc() {
	return !!(
		process.env.ACTIONS_ID_TOKEN_REQUEST_URL &&
		process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
	)
}

/**
 * Detect whether we are running in GitLab CI with an OIDC token injected.
 * GitLab injects the JWT directly as an env var via id_tokens — no HTTP fetch needed.
 *
 * @returns {boolean}
 */
export function isGitLabCiWithOidc() {
	return !!(
		process.env.GITLAB_CI === "true" && process.env.LPM_GITLAB_OIDC_TOKEN
	)
}

/**
 * Request a GitHub Actions OIDC JWT.
 * @returns {Promise<string>} The raw JWT string
 */
async function requestGitHubOidcJwt() {
	const githubTokenUrl = `${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=https://lpm.dev`

	const githubRes = await fetch(githubTokenUrl, {
		headers: {
			Authorization: `bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
		},
	})

	if (!githubRes.ok) {
		const body = await githubRes.text().catch(() => "")
		throw new Error(
			`GitHub OIDC token request failed (${githubRes.status})${body ? `: ${body}` : ""}`,
		)
	}

	const { value: oidcJwt } = await githubRes.json()
	if (!oidcJwt) {
		throw new Error("GitHub OIDC response did not contain a token value")
	}

	return oidcJwt
}

/**
 * Exchange an OIDC JWT with the LPM server for a short-lived token.
 *
 * @param {string} oidcJwt - The raw OIDC JWT
 * @param {{ scope?: "read"|"publish", packageName?: string }} [options]
 * @returns {Promise<{ token: string, expiresAt: string }>}
 */
async function exchangeJwtWithServer(oidcJwt, options = {}) {
	const { scope = "publish", packageName } = options
	const registryUrl = getRegistryUrl()
	const scopeParam = scope === "read" ? "?scope=read" : ""

	const body = { token: oidcJwt }
	if (packageName) body.package = packageName

	const exchangeRes = await fetch(
		`${registryUrl}/api/registry/-/token/oidc${scopeParam}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
	)

	if (!exchangeRes.ok) {
		const text = await exchangeRes.text().catch(() => "")
		throw new Error(
			`OIDC token exchange failed (${exchangeRes.status})${text ? `: ${text}` : ""}`,
		)
	}

	const data = await exchangeRes.json()
	if (!data.token) {
		throw new Error("OIDC exchange response did not contain a token")
	}

	return data
}

/**
 * Exchange a GitHub Actions OIDC JWT for a short-lived LPM token.
 *
 * @param {string} [packageName] - Required for publish scope, optional for read
 * @param {{ scope?: "read"|"publish" }} [options]
 * @returns {Promise<string>} Short-lived LPM token
 */
export async function exchangeOidcToken(packageName, options = {}) {
	const oidcJwt = await requestGitHubOidcJwt()
	const data = await exchangeJwtWithServer(oidcJwt, {
		scope: options.scope || "publish",
		packageName,
	})
	return data.token
}

/**
 * Exchange a GitLab CI OIDC JWT for a short-lived LPM token.
 *
 * @param {string} [packageName] - Required for publish scope, optional for read
 * @param {{ scope?: "read"|"publish" }} [options]
 * @returns {Promise<string>} Short-lived LPM token
 */
export async function exchangeGitLabOidcToken(packageName, options = {}) {
	const oidcJwt = process.env.LPM_GITLAB_OIDC_TOKEN
	if (!oidcJwt) {
		throw new Error(
			"LPM_GITLAB_OIDC_TOKEN is not set. " +
				"Add id_tokens: LPM_GITLAB_OIDC_TOKEN: { aud: https://lpm.dev } to your .gitlab-ci.yml",
		)
	}

	const data = await exchangeJwtWithServer(oidcJwt, {
		scope: options.scope || "publish",
		packageName,
	})
	return data.token
}

/**
 * Detect CI environment and exchange OIDC token for a read-only install token.
 * Works with both GitHub Actions and GitLab CI.
 *
 * @returns {Promise<string>} Short-lived read-only LPM token
 * @throws {Error} If not in a supported CI environment or exchange fails
 */
export async function exchangeOidcInstallToken() {
	if (isGitHubActionsWithOidc()) {
		return exchangeOidcToken(null, { scope: "read" })
	}
	if (isGitLabCiWithOidc()) {
		return exchangeGitLabOidcToken(null, { scope: "read" })
	}
	throw new Error(
		"OIDC is not available. This command requires a CI environment with OIDC support " +
			"(GitHub Actions with `id-token: write` or GitLab CI with `id_tokens` configured).",
	)
}
