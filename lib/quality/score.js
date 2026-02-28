import { checks as jsChecks, getSourcePackageInfo } from './checks.js';
import { swiftChecks } from './swift-checks.js';

const CATEGORY_MAX = {
	documentation: 25,
	code: 30,
	testing: 15,
	health: 30,
};

const TIERS = [
	{ min: 90, tier: 'excellent' },
	{ min: 70, tier: 'good' },
	{ min: 50, tier: 'fair' },
	{ min: 0, tier: 'needs-work' },
];

function getTier(score) {
	return TIERS.find(t => score >= t.min)?.tier || 'needs-work';
}

/**
 * Get the check set for a given ecosystem.
 *
 * @param {string} ecosystem - "js", "swift", "rust", etc.
 * @returns {Array} Check definitions
 */
function getChecksForEcosystem(ecosystem) {
	switch (ecosystem) {
		case 'swift':
			return swiftChecks;
		default:
			return jsChecks;
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
	ecosystem = 'js',
	swiftManifest,
}) {
	const context = { packageJson, readme, lpmConfig, files, unpackedSize, swiftManifest };
	const checks = getChecksForEcosystem(ecosystem);

	const results = checks.map(check => {
		const result = check.run(context);
		// Some checks return custom points (e.g. smallDeps, reasonableSize)
		const points = result.passed
			? result.points !== undefined
				? result.points
				: check.maxPoints
			: 0;
		return {
			id: check.id,
			category: check.category,
			label: check.label,
			passed: result.passed,
			points,
			maxPoints: check.maxPoints,
			detail: result.detail,
			...(result.serverOnly && { serverOnly: true }),
		};
	});

	// Compute category scores
	const categories = {};
	for (const [cat, max] of Object.entries(CATEGORY_MAX)) {
		const catChecks = results.filter(r => r.category === cat);
		const score = catChecks.reduce((sum, r) => sum + r.points, 0);
		categories[cat] = { score, max };
	}

	const totalScore = Object.values(categories).reduce(
		(sum, c) => sum + c.score,
		0,
	);

	const meta = {
		version: 1,
		tier: getTier(totalScore),
		score: totalScore,
		maxScore: 100,
		ecosystem,
		isSourcePackage: !!lpmConfig,
		categories,
		sourcePackageInfo: getSourcePackageInfo(lpmConfig),
		computedAt: new Date().toISOString(),
	};

	return { score: totalScore, checks: results, meta };
}
