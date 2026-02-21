/**
 * @lpm-registry/cli - CLI for Licensed Package Manager
 *
 * This module re-exports key utilities for programmatic use.
 * For CLI usage, run `lpm` directly.
 */

export {
	generateIntegrity,
	verifyIntegrity,
	verifyIntegrityMultiple,
	parseIntegrity,
} from "./lib/integrity.js"

export {
	validateComponentPath,
	validateTarballPaths,
	resolveSafePath,
	sanitizeFilename,
} from "./lib/safe-path.js"

export { runQualityChecks } from "./lib/quality/score.js"

export {
	parseLpmPackageReference,
	readLpmConfig,
	validateLpmConfig,
	filterFiles,
} from "./lib/lpm-config.js"

export {
	detectFramework,
	getDefaultPath,
	getUserImportPrefix,
} from "./lib/project-utils.js"
