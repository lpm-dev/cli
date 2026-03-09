/**
 * @lpm-registry/cli - CLI for Licensed Package Manager
 *
 * This module re-exports key utilities for programmatic use.
 * For CLI usage, run `lpm` directly.
 */

export {
	generateIntegrity,
	parseIntegrity,
	verifyIntegrity,
	verifyIntegrityMultiple,
} from "./lib/integrity.js"
export {
	filterFiles,
	parseLpmPackageReference,
	readLpmConfig,
	validateLpmConfig,
} from "./lib/lpm-config.js"
export {
	detectFramework,
	getDefaultPath,
	getUserImportPrefix,
} from "./lib/project-utils.js"
export { runQualityChecks } from "./lib/quality/score.js"
export {
	resolveSafePath,
	sanitizeFilename,
	validateComponentPath,
	validateTarballPaths,
} from "./lib/safe-path.js"
