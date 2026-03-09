/**
 * Quality check definitions for LPM packages.
 * Each check is a pure function that returns { passed, detail }.
 * Checks are grouped by category and scored out of 100 total points.
 *
 * Categories:
 *   - documentation: 25 points (6 checks)
 *   - code: 34 points (9 checks)
 *   - testing: 11 points (2 checks)
 *   - health: 30 points (9 checks)
 */

const DEFAULT_TEST_SCRIPT = 'echo "Error: no test" && exit 1'

// --- Documentation checks (25 points) ---

const hasReadme = {
	id: "has-readme",
	category: "documentation",
	label: "Has README",
	maxPoints: 8,
	run: ({ readme }) => ({
		passed: !!readme && readme.length > 100,
		detail: readme
			? `README found (${readme.length.toLocaleString()} chars)`
			: "No README found",
	}),
}

const readmeHasInstall = {
	id: "readme-install",
	category: "documentation",
	label: "README has install section",
	maxPoints: 3,
	run: ({ readme }) => {
		if (!readme) return { passed: false, detail: "No README" }
		const lower = readme.toLowerCase()
		const hasSection =
			lower.includes("## install") ||
			lower.includes("## getting started") ||
			lower.includes("## setup") ||
			lower.includes("npm install") ||
			lower.includes("lpm add") ||
			lower.includes("lpm install")
		return {
			passed: hasSection,
			detail: hasSection
				? "Install instructions found"
				: "No install section found in README",
		}
	},
}

const readmeHasUsage = {
	id: "readme-usage",
	category: "documentation",
	label: "README has usage examples",
	maxPoints: 4,
	run: ({ readme }) => {
		if (!readme) return { passed: false, detail: "No README" }
		const lower = readme.toLowerCase()
		const hasUsageSection =
			lower.includes("## usage") || lower.includes("## example")
		const codeBlockCount = (readme.match(/```/g) || []).length / 2
		const hasCodeBlocks = codeBlockCount >= 2
		const passed = hasUsageSection || hasCodeBlocks
		return {
			passed,
			detail: passed
				? `Usage examples found (${Math.floor(codeBlockCount)} code blocks)`
				: "No usage examples found in README",
		}
	},
}

const readmeHasApi = {
	id: "readme-api",
	category: "documentation",
	label: "README has API docs",
	maxPoints: 3,
	run: ({ readme }) => {
		if (!readme) return { passed: false, detail: "No README" }
		const lower = readme.toLowerCase()
		const hasApiSection =
			lower.includes("## api") ||
			lower.includes("## reference") ||
			lower.includes("## props") ||
			lower.includes("## parameters") ||
			lower.includes("## options")
		return {
			passed: hasApiSection,
			detail: hasApiSection
				? "API documentation found"
				: "No API/reference section found in README",
		}
	},
}

const hasChangelog = {
	id: "has-changelog",
	category: "documentation",
	label: "Has CHANGELOG",
	maxPoints: 4,
	run: ({ files }) => {
		const changelogFiles = files.filter(f => {
			const name = (f.path || f).toLowerCase()
			return name.includes("changelog")
		})
		return {
			passed: changelogFiles.length > 0,
			detail:
				changelogFiles.length > 0
					? "CHANGELOG found"
					: "No CHANGELOG file found",
		}
	},
}

const hasLicense = {
	id: "has-license",
	category: "documentation",
	label: "Has LICENSE file",
	maxPoints: 3,
	run: ({ files, packageJson }) => {
		const licenseFiles = files.filter(f => {
			const name = (f.path || f).toLowerCase()
			return name.includes("license") || name.includes("licence")
		})
		const hasLicenseField = !!packageJson.license
		const passed = licenseFiles.length > 0 || hasLicenseField
		return {
			passed,
			detail:
				licenseFiles.length > 0
					? "LICENSE file found"
					: hasLicenseField
						? `License field: ${packageJson.license}`
						: "No LICENSE file or license field",
		}
	},
}

// --- Code Quality checks (30 points) ---

const hasTypes = {
	id: "has-types",
	category: "code",
	label: "Has TypeScript types",
	maxPoints: 8,
	run: ({ packageJson, files }) => {
		const hasTypesField = !!(packageJson.types || packageJson.typings)
		const hasDtsFiles = files.some(f => {
			const name = f.path || f
			return name.endsWith(".d.ts") || name.endsWith(".d.mts")
		})
		const passed = hasTypesField || hasDtsFiles
		return {
			passed,
			detail: hasTypesField
				? `Types field: ${packageJson.types || packageJson.typings}`
				: hasDtsFiles
					? ".d.ts files found"
					: "No TypeScript type definitions found",
		}
	},
}

const intellisenseCoverage = {
	id: "intellisense-coverage",
	category: "code",
	label: "Intellisense coverage",
	maxPoints: 4,
	run: ({ packageJson, files }) => {
		// Full points if .d.ts files exist (complete intellisense)
		const hasTypesField = !!(packageJson.types || packageJson.typings)
		const hasDtsFiles = files.some(f => {
			const name = f.path || f
			return name.endsWith(".d.ts") || name.endsWith(".d.mts")
		})
		if (hasTypesField || hasDtsFiles) {
			return {
				passed: true,
				detail: "TypeScript definitions provide full intellisense",
			}
		}
		// Partial check: JSDoc detection runs server-side from tarball
		// CLI assumes fail; server can upgrade if JSDoc found
		return {
			passed: false,
			detail: "No .d.ts files or JSDoc detected for intellisense",
			serverOnly: true,
		}
	},
}

const hasEsm = {
	id: "esm-exports",
	category: "code",
	label: "ESM exports",
	maxPoints: 3,
	run: ({ packageJson }) => {
		const isModule = packageJson.type === "module"
		const hasModuleField = !!packageJson.module
		const hasExportsField = !!packageJson.exports
		const passed = isModule || hasModuleField || hasExportsField
		return {
			passed,
			detail: isModule
				? '"type": "module" detected'
				: hasExportsField
					? '"exports" field detected'
					: hasModuleField
						? '"module" field detected'
						: "No ESM support detected",
		}
	},
}

const treeShakable = {
	id: "tree-shakable",
	category: "code",
	label: "Tree-shakable",
	maxPoints: 3,
	run: ({ packageJson }) => {
		const hasSideEffects = packageJson.sideEffects === false
		const hasExportsField = !!packageJson.exports
		const isModule = packageJson.type === "module"
		const passed = hasSideEffects || (hasExportsField && isModule)
		let detail
		if (hasSideEffects) {
			detail = '"sideEffects": false enables tree-shaking'
		} else if (hasExportsField && isModule) {
			detail = "ESM + exports map enables tree-shaking"
		} else {
			detail = 'No "sideEffects": false in package.json'
		}
		return { passed, detail }
	},
}

const noEval = {
	id: "no-eval",
	category: "code",
	label: "No eval/Function() patterns",
	maxPoints: 3,
	run: () => {
		// This check runs server-side from tarball contents.
		// CLI assumes pass; server overrides if eval detected.
		return {
			passed: true,
			detail: "Full check runs server-side",
			serverOnly: true,
		}
	},
}

const hasEngines = {
	id: "has-engines",
	category: "code",
	label: 'Has "engines" field',
	maxPoints: 2,
	run: ({ packageJson }) => {
		const hasField = !!packageJson.engines?.node
		return {
			passed: hasField,
			detail: hasField
				? `engines.node: ${packageJson.engines.node}`
				: 'No "engines" field in package.json',
		}
	},
}

const hasExportsMap = {
	id: "has-exports-map",
	category: "code",
	label: 'Has "exports" map',
	maxPoints: 5,
	run: ({ packageJson }) => {
		const hasField = !!packageJson.exports
		return {
			passed: hasField,
			detail: hasField
				? '"exports" map defined'
				: 'No "exports" map in package.json',
		}
	},
}

const smallDeps = {
	id: "small-deps",
	category: "code",
	label: "Small dependency footprint",
	maxPoints: 4,
	run: ({ packageJson }) => {
		const deps = packageJson.dependencies
			? Object.keys(packageJson.dependencies).length
			: 0
		let points
		if (deps === 0) points = 4
		else if (deps <= 3) points = 3
		else if (deps <= 7) points = 2
		else if (deps <= 15) points = 1
		else points = 0
		return {
			passed: points > 0,
			points,
			detail: `${deps} production ${deps === 1 ? "dependency" : "dependencies"}`,
		}
	},
}

const sourceMaps = {
	id: "source-maps",
	category: "code",
	label: "Source maps included",
	maxPoints: 2,
	run: ({ files }) => {
		const mapFiles = files.filter(f => {
			const name = f.path || f
			return name.endsWith(".js.map") || name.endsWith(".mjs.map")
		})
		return {
			passed: mapFiles.length > 0,
			detail:
				mapFiles.length > 0
					? `${mapFiles.length} source map${mapFiles.length !== 1 ? "s" : ""} found`
					: "No source map files found",
		}
	},
}

// --- Testing checks (11 points) ---

const hasTestFiles = {
	id: "has-test-files",
	category: "testing",
	label: "Has test files",
	maxPoints: 7,
	run: ({ files }) => {
		const testFiles = files.filter(f => {
			const name = (f.path || f).toLowerCase()
			return (
				name.includes(".test.") ||
				name.includes(".spec.") ||
				name.includes("__tests__/") ||
				name.startsWith("test/") ||
				name.startsWith("tests/")
			)
		})
		return {
			passed: testFiles.length > 0,
			detail:
				testFiles.length > 0
					? `${testFiles.length} test file${testFiles.length !== 1 ? "s" : ""} found`
					: "No test files found",
		}
	},
}

const hasTestScript = {
	id: "has-test-script",
	category: "testing",
	label: "Has test script",
	maxPoints: 4,
	run: ({ packageJson }) => {
		const testScript = packageJson.scripts?.test
		const hasScript = !!testScript && !testScript.includes(DEFAULT_TEST_SCRIPT)
		return {
			passed: hasScript,
			detail: hasScript
				? `test script: ${testScript}`
				: "No test script in package.json",
		}
	},
}

// --- Package Health checks (30 points) ---

const hasDescription = {
	id: "has-description",
	category: "health",
	label: "Has description",
	maxPoints: 3,
	run: ({ packageJson }) => {
		const desc = packageJson.description
		const passed = !!desc && desc.length > 10
		return {
			passed,
			detail: passed
				? `Description: "${desc.substring(0, 60)}${desc.length > 60 ? "..." : ""}"`
				: "No meaningful description in package.json",
		}
	},
}

const hasKeywords = {
	id: "has-keywords",
	category: "health",
	label: "Has keywords",
	maxPoints: 2,
	run: ({ packageJson }) => {
		const keywords = packageJson.keywords
		const passed = Array.isArray(keywords) && keywords.length > 0
		return {
			passed,
			detail: passed
				? `${keywords.length} keyword${keywords.length !== 1 ? "s" : ""}`
				: "No keywords in package.json",
		}
	},
}

const hasRepository = {
	id: "has-repository",
	category: "health",
	label: "Has repository URL",
	maxPoints: 2,
	run: ({ packageJson }) => {
		const repo = packageJson.repository
		const hasRepo = !!(
			repo &&
			(typeof repo === "string" || typeof repo?.url === "string")
		)
		return {
			passed: hasRepo,
			detail: hasRepo
				? `Repository: ${typeof repo === "string" ? repo : repo.url}`
				: "No repository field in package.json",
		}
	},
}

const hasHomepage = {
	id: "has-homepage",
	category: "health",
	label: "Has homepage",
	maxPoints: 2,
	run: ({ packageJson }) => {
		const passed = !!packageJson.homepage
		return {
			passed,
			detail: passed
				? `Homepage: ${packageJson.homepage}`
				: "No homepage in package.json",
		}
	},
}

const reasonableSize = {
	id: "reasonable-size",
	category: "health",
	label: "Reasonable bundle size",
	maxPoints: 3,
	run: ({ unpackedSize }) => {
		if (!unpackedSize)
			return { passed: true, points: 3, detail: "Size unknown" }
		const kb = unpackedSize / 1024
		const mb = kb / 1024
		let points
		if (mb < 0.1) points = 3
		else if (mb < 0.5) points = 2
		else if (mb < 1) points = 1
		else points = 0

		const sizeStr = mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.round(kb)}KB`
		return {
			passed: points > 0,
			points,
			detail: `Unpacked size: ${sizeStr}`,
		}
	},
}

const noVulnerabilities = {
	id: "no-vulnerabilities",
	category: "health",
	label: "No known vulnerabilities",
	maxPoints: 5,
	run: () => {
		// This check runs server-side with OSV scan results.
		// CLI assumes pass; server overrides with actual results.
		return {
			passed: true,
			detail: "Full check runs server-side",
			serverOnly: true,
		}
	},
}

const maintenanceHealth = {
	id: "maintenance-health",
	category: "health",
	label: "Active maintenance",
	maxPoints: 5,
	run: () => {
		// Server-only: checks if last version was published within 90 days.
		// CLI cannot know this — assumes pass.
		return {
			passed: true,
			detail: "Full check runs server-side",
			serverOnly: true,
		}
	},
}

const semverConsistency = {
	id: "semver-consistency",
	category: "health",
	label: "SemVer consistency",
	maxPoints: 4,
	run: ({ packageJson }) => {
		// CLI can check if the current version is valid semver
		const version = packageJson.version
		if (!version) return { passed: false, detail: "No version in package.json" }
		// Basic semver regex (major.minor.patch with optional pre-release)
		const semverRegex = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/
		const isValid = semverRegex.test(version)
		// Server can also check version history for wild jumps
		return {
			passed: isValid,
			detail: isValid
				? `Valid semver: ${version}`
				: `Invalid semver format: ${version}`,
			serverOnly: !isValid ? undefined : true,
		}
	},
}

const authorVerified = {
	id: "author-verified",
	category: "health",
	label: "Verified author",
	maxPoints: 4,
	run: () => {
		// Server-only: checks if the author has linked social accounts.
		// CLI cannot know this — assumes pass.
		return {
			passed: true,
			detail: "Full check runs server-side",
			serverOnly: true,
		}
	},
}

// --- Export all checks ---

/** JS checks (default) */
export const checks = [
	// Documentation (25)
	hasReadme,
	readmeHasInstall,
	readmeHasUsage,
	readmeHasApi,
	hasChangelog,
	hasLicense,
	// Code Quality (30)
	hasTypes,
	intellisenseCoverage,
	hasEsm,
	treeShakable,
	noEval,
	hasEngines,
	hasExportsMap,
	smallDeps,
	sourceMaps,
	// Testing (11)
	hasTestFiles,
	hasTestScript,
	// Health (30)
	hasDescription,
	hasKeywords,
	hasRepository,
	hasHomepage,
	reasonableSize,
	noVulnerabilities,
	maintenanceHealth,
	semverConsistency,
	authorVerified,
]

// Export individual universal checks for reuse by ecosystem-specific check sets
export {
	hasReadme,
	readmeHasUsage,
	readmeHasApi,
	hasChangelog,
	hasLicense,
	hasDescription,
	hasKeywords,
	hasRepository,
	hasHomepage,
	reasonableSize,
	noVulnerabilities,
	maintenanceHealth,
	semverConsistency,
	authorVerified,
}

/**
 * Get source package informational badges (not scored)
 * @param {object} lpmConfig
 * @returns {object|null}
 */
export function getSourcePackageInfo(lpmConfig) {
	if (!lpmConfig) return null
	return {
		hasConfig: true,
		hasDefaults: !!lpmConfig.defaultConfig,
		optionCount: lpmConfig.configSchema
			? Object.keys(lpmConfig.configSchema).length
			: 0,
		usesConditionalIncludes: (lpmConfig.files || []).some(
			f => f.include === "when" && f.condition,
		),
	}
}
