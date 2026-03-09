import { getSourcePackageInfo, checks as jsChecks } from "./checks.js"
import { swiftChecks, xcframeworkChecks } from "./swift-checks.js"

const TIERS = [
	{ min: 90, tier: "excellent" },
	{ min: 70, tier: "good" },
	{ min: 50, tier: "fair" },
	{ min: 0, tier: "needs-work" },
]

function getTier(score) {
	return TIERS.find(t => score >= t.min)?.tier || "needs-work"
}

/**
 * Get the check set for a given ecosystem.
 *
 * @param {string} ecosystem - "js", "swift", "rust", etc.
 * @returns {Array} Check definitions
 */
function getChecksForEcosystem(ecosystem) {
	switch (ecosystem) {
		case "swift":
			return swiftChecks
		case "xcframework":
			return xcframeworkChecks
		default:
			return jsChecks
	}
}

/**
 * Run all quality checks and compute the score.
 *
 * @param {object} params
 * @param {object} params.packageJson - Parsed package.json
 * @param {string|null} params.readme - README content
 * @param {object|null} params.lpmConfig - Parsed lpm.config.json
 * @param {Array} params.files - File list (each has .path)
 * @param {number} [params.unpackedSize] - Unpacked size in bytes
 * @param {string} [params.ecosystem] - Ecosystem identifier (default: "js")
 * @param {object} [params.swiftManifest] - Parsed Swift manifest metadata (for Swift packages)
 * @returns {{ score: number, checks: Array, meta: object }}
 */
export function runQualityChecks({
	packageJson,
	readme,
	lpmConfig,
	files,
	unpackedSize,
	ecosystem = "js",
	swiftManifest,
	xcframeworkMeta,
}) {
	const context = {
		packageJson,
		readme,
		lpmConfig,
		files,
		unpackedSize,
		swiftManifest,
		xcframeworkMeta,
	}
	const checks = getChecksForEcosystem(ecosystem)

	const results = checks.map(check => {
		const result = check.run(context)
		// Some checks return custom points (e.g. smallDeps, reasonableSize)
		const points = result.passed
			? result.points !== undefined
				? result.points
				: check.maxPoints
			: 0
		return {
			id: check.id,
			category: check.category,
			label: check.label,
			passed: result.passed,
			points,
			maxPoints: check.maxPoints,
			detail: result.detail,
			...(result.serverOnly && { serverOnly: true }),
		}
	})

	// Compute category scores dynamically from actual check maxPoints
	const categories = {}
	for (const result of results) {
		if (!categories[result.category]) {
			categories[result.category] = { score: 0, max: 0 }
		}
		categories[result.category].score += result.points
		categories[result.category].max += result.maxPoints
	}

	const totalScore = Object.values(categories).reduce(
		(sum, c) => sum + c.score,
		0,
	)
	const maxScore = Object.values(categories).reduce((sum, c) => sum + c.max, 0)

	const meta = {
		version: 1,
		tier: getTier(totalScore),
		score: totalScore,
		maxScore,
		ecosystem,
		isSourcePackage: !!lpmConfig,
		categories,
		sourcePackageInfo: getSourcePackageInfo(lpmConfig),
		computedAt: new Date().toISOString(),
	}

	return { score: totalScore, checks: results, meta }
}
