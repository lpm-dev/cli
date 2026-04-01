/// <reference types="node" />

// Type declarations for @lpm-registry/cli

// --- integrity.js ---

export interface IntegrityHash {
	algorithm: string
	digest: string
}

export interface IntegrityResult {
	valid: boolean
	algorithm?: string
	error?: string
	actual?: string
}

export function generateIntegrity(buffer: Buffer, algorithm?: string): string
export function verifyIntegrity(
	buffer: Buffer,
	expectedIntegrity: string,
): IntegrityResult
export function verifyIntegrityMultiple(
	buffer: Buffer,
	integrities: string[],
): IntegrityResult
export function parseIntegrity(integrity: string): IntegrityHash

// --- safe-path.js ---

export interface PathValidation {
	valid: boolean
	resolvedPath?: string
	error?: string
}

export interface TarballPathValidation {
	valid: boolean
	invalidPaths?: string[]
}

export function validateComponentPath(
	projectRoot: string,
	componentPath: string,
): PathValidation
export function validateTarballPaths(
	extractDir: string,
	filePaths: string[],
): TarballPathValidation
export function resolveSafePath(
	basePath: string,
	userPath: string,
): PathValidation
export function sanitizeFilename(filename: string): string

// --- quality/score.js ---

export interface QualityCheck {
	id: string
	category: "documentation" | "code" | "testing" | "health"
	label: string
	passed: boolean
	points: number
	max_points: number
	server_only?: boolean
}

export interface QualityMeta {
	tier: "excellent" | "good" | "fair" | "needs-work"
	score: number
	maxScore: number
	categories: Record<string, { score: number; max: number }>
}

export interface QualityResult {
	score: number
	checks: QualityCheck[]
	meta: QualityMeta
}

export interface QualityInput {
	packageJson: Record<string, unknown>
	readme: string | null
	lpmConfig: Record<string, unknown> | null
	files: Array<{ path: string }>
	unpackedSize: number
}

export function runQualityChecks(input: QualityInput): QualityResult

// --- lpm-config.js ---

export interface PackageReference {
	name: string
	version: string
	inlineConfig: Record<string, string>
	providedParams: Set<string>
}

export interface LpmConfig {
	files?: Array<{
		src: string
		dest?: string
		when?: string
	}>
	configSchema?: Record<string, unknown>
	defaultConfig?: Record<string, string>
	dependencies?: Record<string, unknown>
}

export interface LpmConfigValidation {
	valid: boolean
	errors?: string[]
}

export function parseLpmPackageReference(ref: string): PackageReference
export function readLpmConfig(extractDir: string): LpmConfig | null
export function validateLpmConfig(config: unknown): LpmConfigValidation
export function filterFiles(
	files: LpmConfig["files"],
	mergedConfig: Record<string, string>,
	providedParams: Set<string>,
): NonNullable<LpmConfig["files"]>
// --- project-utils.js ---

export type Framework = "nextjs" | "vite" | "remix" | "astro" | "unknown"

export function detectFramework(): Framework
export function getDefaultPath(framework: Framework): string
export function getUserImportPrefix(): string
