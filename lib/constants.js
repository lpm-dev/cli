/**
 * CLI Constants Configuration
 * Centralized configuration for all CLI behavior.
 *
 * @module cli/lib/constants
 */

// ============================================================================
// Network Configuration
// ============================================================================

/** Maximum number of retry attempts for failed requests */
export const MAX_RETRIES = 3

/** Request timeout in milliseconds (30 seconds) */
export const REQUEST_TIMEOUT_MS = 30_000

/** Base delay for exponential backoff in milliseconds */
export const RETRY_BASE_DELAY_MS = 1_000

/** Maximum delay between retries in milliseconds */
export const RETRY_MAX_DELAY_MS = 10_000

/** Multiplier for exponential backoff */
export const RETRY_BACKOFF_MULTIPLIER = 2

// ============================================================================
// Cache Configuration
// ============================================================================

/** Cache directory name (relative to user's home) */
export const CACHE_DIR_NAME = ".lpm-cache"

/** Maximum cache size in bytes (500 MB) */
export const MAX_CACHE_SIZE_BYTES = 500 * 1024 * 1024

/** Cache entry TTL in milliseconds (7 days) */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// ============================================================================
// Security Configuration
// ============================================================================

/** Keytar service name for credential storage */
export const KEYTAR_SERVICE_NAME = "lpm-cli"

/** Keytar account name for token storage */
export const KEYTAR_ACCOUNT_NAME = "auth-token"

/** Token scopes that allow publishing */
export const PUBLISH_SCOPES = ["publish", "write", "full"]

/** Token scopes that allow reading */
export const READ_SCOPES = ["read", "publish", "write", "full"]

// ============================================================================
// API Configuration
// ============================================================================

/** Default registry URL */
export const DEFAULT_REGISTRY_URL = "https://lpm.dev"

/** API version prefix */
export const API_VERSION = "v1"

/** HTTP status codes that trigger retries */
export const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504]

/** HTTP status codes that indicate rate limiting */
export const RATE_LIMIT_STATUS_CODES = [429]

// ============================================================================
// CLI Configuration
// ============================================================================

/** CLI name for display purposes */
export const CLI_NAME = "lpm"

/** Default pagination limit for list commands */
export const DEFAULT_PAGE_LIMIT = 20

/** Maximum pagination limit */
export const MAX_PAGE_LIMIT = 100

// ============================================================================
// File System Configuration
// ============================================================================

/** Default source directory for component extraction */
export const DEFAULT_COMPONENTS_DIR = "components"

/** Allowed file extensions for source code extraction */
export const ALLOWED_SOURCE_EXTENSIONS = [
	".js",
	".jsx",
	".ts",
	".tsx",
	".css",
	".scss",
	".json",
	".md",
]

/** Maximum file size for source extraction (10 MB) */
export const MAX_SOURCE_FILE_SIZE_BYTES = 10 * 1024 * 1024

// ============================================================================
// Integrity Verification
// ============================================================================

/** Default hash algorithm for tarball verification */
export const DEFAULT_HASH_ALGORITHM = "sha512"

/** Supported hash algorithms */
export const SUPPORTED_HASH_ALGORITHMS = ["sha256", "sha384", "sha512"]

// ============================================================================
// Spinner Messages
// ============================================================================

export const SPINNER_MESSAGES = {
	authenticating: "Authenticating...",
	downloading: "Downloading package...",
	extracting: "Extracting files...",
	publishing: "Publishing package...",
	verifying: "Verifying integrity...",
	retrying: (attempt, max) => `Retrying (${attempt}/${max})...`,
	rateLimited: seconds => `Rate limited. Waiting ${seconds}s...`,
	readingConfig: "Reading package configuration...",
	filteringFiles: "Filtering files based on configuration...",
}

// ============================================================================
// Error Messages
// ============================================================================

export const ERROR_MESSAGES = {
	notAuthenticated: "Not authenticated. Run `lpm login` first.",
	tokenExpired: "Token expired. Run `lpm login` to refresh.",
	tokenMissingScope: scope =>
		`Token missing required scope: ${scope}. Run \`lpm token-rotate --scope ${scope}\` to fix.`,
	networkError: "Network error. Check your connection and try again.",
	rateLimited: "Rate limited. Please wait and try again.",
	integrityMismatch:
		"Package integrity check failed. Download may be corrupted.",
	pathTraversal: "Invalid path: path traversal detected.",
	timeout:
		"Request timed out. Try again or increase timeout with `lpm config set timeout <ms>`.",
	invalidLpmConfig: "Invalid lpm.config.json: ",
	invalidConfigValue: (key, value, allowed) =>
		`Invalid value "${value}" for "${key}". Allowed: ${allowed.join(", ")}`,
	missingRequiredConfig: key =>
		`Required config parameter "${key}" not provided. Use ?${key}=value in the package URL.`,
}

// ============================================================================
// Warning Messages
// ============================================================================

export const WARNING_MESSAGES = {
	usernameNotSet: "Your personal username is not set.",
	usernameNotSetHint: registryUrl =>
		`Set it to publish packages under your personal owner:\n  ${registryUrl}/dashboard/settings`,
	ownerMismatch: owner =>
		`Package owner "@lpm.dev/${owner}" doesn't match your available owners.`,
	// Legacy - kept for backward compatibility
	scopeMismatch: scope =>
		`Package owner "@lpm.dev/${scope}" doesn't match your available owners.`,
	noOrganizations: "You have no organizations.",
	createOrgHint: registryUrl =>
		`Create one at: ${registryUrl}/dashboard/orgs/new`,
	ownerFixHint:
		'Either:\n  1. Set your username/org slug to match the package owner\n  2. Change package.json "name" to use @lpm.dev/YOUR_OWNER.package-name',
	// Legacy - kept for backward compatibility
	scopeFixHint:
		'Either:\n  1. Set your username/org slug to match the package owner\n  2. Change package.json "name" to use @lpm.dev/YOUR_OWNER.package-name',
}

// ============================================================================
// Success Messages
// ============================================================================

export const SUCCESS_MESSAGES = {
	// Updated for new format: @lpm.dev/owner.package-name
	// owner = username or org slug, pkgName = package name (without owner prefix)
	publishPersonal: (registryUrl, owner, pkgName, version) =>
		`Successfully published @lpm.dev/${owner}.${pkgName}@${version}\n  ${registryUrl}/${owner}.${pkgName}`,
	publishOrg: (registryUrl, owner, pkgName, version) =>
		`Successfully published @lpm.dev/${owner}.${pkgName}@${version}\n  ${registryUrl}/${owner}.${pkgName}`,
}
