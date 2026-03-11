/**
 * OIDC (OpenID Connect) token exchange for secret-free publishing.
 *
 * When running in GitHub Actions with `id-token: write` permission,
 * this module requests an OIDC JWT from GitHub and exchanges it for
 * a short-lived LPM publish token — no LPM_TOKEN secret required.
 *
 * The package must have a matching trusted publisher configured in
 * the LPM dashboard (Workflow tab) before this will succeed.
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
 * Exchange a GitHub Actions OIDC JWT for a short-lived LPM publish token.
 *
 * Steps:
 * 1. Request an OIDC JWT from GitHub (audience: https://lpm.dev)
 * 2. POST the JWT to the LPM OIDC token exchange endpoint
 * 3. Return the resulting `lpm_xxx` token (valid for 15 minutes)
 *
 * @param {string} packageName - Full package name, e.g. "@lpm.dev/owner.pkg-name"
 * @returns {Promise<string>} Short-lived LPM publish token
 * @throws {Error} If GitHub OIDC request fails or LPM exchange is rejected
 */
export async function exchangeOidcToken(packageName) {
	// 1. Request OIDC JWT from GitHub Actions
	// The audience must match EXPECTED_AUDIENCE in lib/registry/oidc.js on the server
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

	// 2. Exchange the OIDC JWT for a short-lived LPM publish token
	const registryUrl = getRegistryUrl()
	const exchangeRes = await fetch(`${registryUrl}/api/registry/-/token/oidc`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token: oidcJwt, package: packageName }),
	})

	if (!exchangeRes.ok) {
		const body = await exchangeRes.text().catch(() => "")
		throw new Error(
			`OIDC token exchange failed (${exchangeRes.status})${body ? `: ${body}` : ""}`,
		)
	}

	const { token } = await exchangeRes.json()
	if (!token) {
		throw new Error("OIDC exchange response did not contain a token")
	}

	return token
}

/**
 * Exchange a GitLab CI OIDC JWT for a short-lived LPM publish token.
 *
 * GitLab injects the JWT directly into LPM_GITLAB_OIDC_TOKEN via id_tokens — no
 * intermediate HTTP fetch is needed (unlike GitHub Actions).
 *
 * @param {string} packageName - Full package name, e.g. "@lpm.dev/owner.pkg-name"
 * @returns {Promise<string>} Short-lived LPM publish token
 * @throws {Error} If the OIDC token is missing or the LPM exchange is rejected
 */
export async function exchangeGitLabOidcToken(packageName) {
	const oidcJwt = process.env.LPM_GITLAB_OIDC_TOKEN
	if (!oidcJwt) {
		throw new Error(
			"LPM_GITLAB_OIDC_TOKEN is not set. " +
				"Add id_tokens: LPM_GITLAB_OIDC_TOKEN: { aud: https://lpm.dev } to your .gitlab-ci.yml",
		)
	}

	const registryUrl = getRegistryUrl()
	const exchangeRes = await fetch(`${registryUrl}/api/registry/-/token/oidc`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ token: oidcJwt, package: packageName }),
	})

	if (!exchangeRes.ok) {
		const body = await exchangeRes.text().catch(() => "")
		throw new Error(
			`OIDC token exchange failed (${exchangeRes.status})${body ? `: ${body}` : ""}`,
		)
	}

	const { token } = await exchangeRes.json()
	if (!token) {
		throw new Error("OIDC exchange response did not contain a token")
	}

	return token
}
