/**
 * LPM Package Config System
 *
 * Handles lpm.config.json parsing, validation, condition evaluation,
 * file filtering, template replacement, and dependency resolution
 * for the `lpm add` command.
 *
 * Pure logic module — no I/O beyond file reads, no prompts.
 *
 * @module cli/lib/lpm-config
 */

import fs from 'node:fs';
import path from 'node:path';

/** Maximum lpm.config.json file size (1 MB) */
const MAX_CONFIG_FILE_SIZE = 1024 * 1024;

/** Maximum number of file rules allowed */
const MAX_FILE_RULES = 1000;

/**
 * Parse a package reference that may include version and URL query params.
 *
 * Supports:
 *   @lpm.dev/owner.pkg
 *   @lpm.dev/owner.pkg@1.0.0
 *   @lpm.dev/owner.pkg?component=dialog&styling=panda
 *   @lpm.dev/owner.pkg@1.0.0?component=dialog,button&styling=panda
 *
 * @param {string} ref - Package reference string
 * @returns {{ name: string, version: string, inlineConfig: Record<string, string>, providedParams: Set<string> }}
 */
export function parseLpmPackageReference(ref) {
  // Split query string first
  const queryIndex = ref.indexOf('?');
  let packagePart = ref;
  let queryString = '';

  if (queryIndex !== -1) {
    packagePart = ref.substring(0, queryIndex);
    queryString = ref.substring(queryIndex + 1);
  }

  // Extract version from package part
  let name = packagePart;
  let version = 'latest';

  // Find version separator: last @ after position 0 (position 0 is the scope @)
  const lastAt = packagePart.lastIndexOf('@');
  if (lastAt > 0) {
    name = packagePart.substring(0, lastAt);
    version = packagePart.substring(lastAt + 1);
  }

  // Parse query params
  const inlineConfig = {};
  const providedParams = new Set();

  if (queryString) {
    const params = new URLSearchParams(queryString);
    for (const [key, value] of params.entries()) {
      inlineConfig[key] = value;
      providedParams.add(key);
    }
  }

  return { name, version, inlineConfig, providedParams };
}

/**
 * Read and validate lpm.config.json from an extracted package directory.
 *
 * @param {string} extractDir - Path to extracted tarball directory
 * @returns {import('./lpm-config.js').LpmConfig | null} Parsed config or null if not found
 */
export function readLpmConfig(extractDir) {
  const configPath = path.join(extractDir, 'lpm.config.json');

  if (!fs.existsSync(configPath)) {
    return null;
  }

  const stat = fs.statSync(configPath);
  if (stat.size > MAX_CONFIG_FILE_SIZE) {
    throw new Error(
      `lpm.config.json exceeds maximum size of ${MAX_CONFIG_FILE_SIZE / 1024 / 1024}MB`,
    );
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw);

  const errors = validateLpmConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid lpm.config.json:\n  ${errors.join('\n  ')}`);
  }

  return config;
}

/**
 * Validate a parsed lpm.config.json object.
 *
 * @param {object} config - Parsed lpm.config.json
 * @returns {string[]} Array of error messages (empty if valid)
 */
export function validateLpmConfig(config) {
  const errors = [];

  // Validate file rules
  if (config.files) {
    if (!Array.isArray(config.files)) {
      errors.push("'files' must be an array");
    } else {
      if (config.files.length > MAX_FILE_RULES) {
        errors.push(
          `Too many file rules (${config.files.length}). Maximum is ${MAX_FILE_RULES}.`,
        );
      }

      for (let i = 0; i < config.files.length; i++) {
        const rule = config.files[i];

        if (rule.src) {
          const normalizedSrc = rule.src.replace(/\\/g, '/');
          if (normalizedSrc.includes('..')) {
            errors.push(
              `files[${i}].src contains path traversal: "${rule.src}"`,
            );
          }
          if (normalizedSrc.startsWith('/')) {
            errors.push(
              `files[${i}].src must be a relative path: "${rule.src}"`,
            );
          }
        }

        if (rule.dest) {
          const normalizedDest = rule.dest.replace(/\\/g, '/');
          if (normalizedDest.includes('..')) {
            errors.push(
              `files[${i}].dest contains path traversal: "${rule.dest}"`,
            );
          }
          if (normalizedDest.startsWith('/')) {
            errors.push(
              `files[${i}].dest must be a relative path: "${rule.dest}"`,
            );
          }
        }

        if (
          rule.include &&
          !['always', 'never', 'when'].includes(rule.include)
        ) {
          errors.push(
            `files[${i}].include must be "always", "never", or "when". Got: "${rule.include}"`,
          );
        }

        if (rule.include === 'when' && !rule.condition) {
          errors.push(`files[${i}] has include "when" but no condition object`);
        }
      }
    }
  }

  // Validate configSchema
  if (config.configSchema) {
    if (
      typeof config.configSchema !== 'object' ||
      Array.isArray(config.configSchema)
    ) {
      errors.push("'configSchema' must be an object");
    } else {
      for (const [key, entry] of Object.entries(config.configSchema)) {
        if (!entry.type) {
          errors.push(`configSchema.${key} is missing 'type'`);
        } else if (!['select', 'boolean'].includes(entry.type)) {
          errors.push(
            `configSchema.${key}.type must be "select" or "boolean". Got: "${entry.type}"`,
          );
        }

        if (entry.type === 'select') {
          if (
            !entry.options ||
            !Array.isArray(entry.options) ||
            entry.options.length === 0
          ) {
            errors.push(
              `configSchema.${key} is type "select" but has no options`,
            );
          }
        }
      }
    }
  }

  // Validate transform
  if (config.transform) {
    if (!['template', 'variants', 'hybrid'].includes(config.transform)) {
      errors.push(
        `'transform' must be "template", "variants", or "hybrid". Got: "${config.transform}"`,
      );
    }
  }

  // Validate importAlias
  if (config.importAlias !== undefined) {
    if (typeof config.importAlias !== 'string') {
      errors.push("'importAlias' must be a string (e.g., \"@/\", \"~/\")");
    } else if (!config.importAlias.endsWith('/')) {
      errors.push(
        "'importAlias' must end with \"/\" (e.g., \"@/\", \"~/\", \"@src/\")",
      );
    }
  }

  return errors;
}

/**
 * Evaluate whether a file rule should be included based on config and provided params.
 *
 * Implements "include all by default": if a condition key was NOT explicitly
 * provided by the user, the file is included regardless of its condition value.
 *
 * @param {object} fileRule - File rule from lpm.config.json
 * @param {Record<string, string>} mergedConfig - Merged configuration values
 * @param {Set<string>} providedParams - Set of parameter keys explicitly provided by the user
 * @returns {boolean} Whether the file should be included
 */
export function evaluateCondition(fileRule, mergedConfig, providedParams) {
  if (!fileRule.include || fileRule.include === 'always') return true;
  if (fileRule.include === 'never') return false;

  if (fileRule.include === 'when' && fileRule.condition) {
    // All condition entries must match (AND logic)
    for (const [conditionKey, conditionValue] of Object.entries(
      fileRule.condition,
    )) {
      // "Include all by default": if param was NOT provided, skip this check (include the file)
      if (!providedParams.has(conditionKey)) {
        continue;
      }

      const configValue = mergedConfig[conditionKey];

      // Handle comma-separated multi-select values
      if (typeof configValue === 'string' && configValue.includes(',')) {
        const selectedValues = configValue.split(',').map(v => v.trim());
        if (!selectedValues.includes(String(conditionValue))) {
          return false;
        }
      } else {
        // Single value or boolean comparison
        if (String(configValue) !== String(conditionValue)) {
          return false;
        }
      }
    }

    return true;
  }

  // Default: include
  return true;
}

/**
 * Filter file rules based on merged config and provided params.
 *
 * @param {object[]} files - Array of file rules from lpm.config.json
 * @param {Record<string, string>} mergedConfig - Merged configuration values
 * @param {Set<string>} providedParams - Set of parameter keys explicitly provided
 * @returns {object[]} Filtered file rules that should be included
 */
export function filterFiles(files, mergedConfig, providedParams) {
  return files.filter(fileRule =>
    evaluateCondition(fileRule, mergedConfig, providedParams),
  );
}

/**
 * Apply template variable replacement in file content.
 *
 * Replaces {{variableName}} with the corresponding config value.
 * Only matches word characters (\w+) — no expression parsing, no eval.
 *
 * @param {string} content - File content with {{template}} placeholders
 * @param {Record<string, string>} config - Configuration values
 * @returns {string} Content with placeholders replaced
 */
export function applyTemplateVariables(content, config) {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in config) {
      return String(config[key]);
    }
    return match;
  });
}

/**
 * Resolve variant file mappings based on config values.
 *
 * For "variants" or "hybrid" transform mode, maps each config key
 * to the selected variant file path.
 *
 * @param {Record<string, Record<string, string>>} variants - Variant mapping from lpm.config.json
 * @param {Record<string, string>} config - Merged configuration values
 * @param {Record<string, string>} [output] - Output path mapping
 * @returns {{ src: string, dest: string }[]} Array of source/dest pairs to copy
 */
export function resolveVariants(variants, config, output = {}) {
  const result = [];

  for (const [configKey, variantMap] of Object.entries(variants)) {
    const selectedValue = config[configKey];
    if (!selectedValue || !variantMap[selectedValue]) continue;

    const src = variantMap[selectedValue];
    const dest = output[configKey] || src;

    result.push({ src, dest });
  }

  return result;
}

/**
 * Resolve conditional dependencies based on config choices.
 *
 * @param {Record<string, Record<string, string[]>>} depConfig - Dependencies config from lpm.config.json
 * @param {Record<string, string>} mergedConfig - Merged configuration values
 * @returns {{ npm: string[], lpm: string[] }} Separated npm and LPM dependencies
 */
export function resolveConditionalDependencies(depConfig, mergedConfig) {
  const allDeps = new Set();

  for (const [configKey, depMap] of Object.entries(depConfig)) {
    const selectedValue = mergedConfig[configKey];
    if (!selectedValue) continue;

    // Handle comma-separated values
    const values =
      typeof selectedValue === 'string' && selectedValue.includes(',')
        ? selectedValue.split(',').map(v => v.trim())
        : [selectedValue];

    for (const value of values) {
      const deps = depMap[value];
      if (Array.isArray(deps)) {
        for (const dep of deps) {
          allDeps.add(dep);
        }
      }
    }
  }

  const npm = [];
  const lpm = [];

  for (const dep of allDeps) {
    if (dep.startsWith('@lpm.dev/')) {
      lpm.push(dep);
    } else {
      npm.push(dep);
    }
  }

  return { npm, lpm };
}

/**
 * Expand glob-like src patterns to actual file paths.
 *
 * Supports simple patterns:
 *   - Exact paths: "lib/utils.js"
 *   - Directory wildcards: "components/dialog/**"
 *
 * @param {string} srcPattern - Source pattern from file rule
 * @param {string} extractDir - Extracted tarball directory
 * @returns {string[]} Array of matching file paths (relative to extractDir)
 */
export function expandSrcGlob(srcPattern, extractDir) {
  // If pattern doesn't contain *, it's an exact path
  if (!srcPattern.includes('*')) {
    const fullPath = path.join(extractDir, srcPattern);
    if (fs.existsSync(fullPath)) {
      return [srcPattern];
    }
    return [];
  }

  // Handle ** (directory wildcard)
  if (srcPattern.endsWith('/**')) {
    const baseDir = srcPattern.slice(0, -3); // Remove /**
    const fullBaseDir = path.join(extractDir, baseDir);

    if (
      !fs.existsSync(fullBaseDir) ||
      !fs.statSync(fullBaseDir).isDirectory()
    ) {
      return [];
    }

    const results = [];
    const collectFiles = (dir, relativeTo) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullEntryPath = path.join(dir, entry.name);
        const relPath = path.relative(extractDir, fullEntryPath);

        if (entry.isDirectory()) {
          collectFiles(fullEntryPath, relativeTo);
        } else {
          results.push(relPath);
        }
      }
    };

    collectFiles(fullBaseDir, extractDir);
    return results;
  }

  // Handle dir/*.ext patterns (single-directory wildcard)
  const lastSlash = srcPattern.lastIndexOf('/');
  const dirPart = lastSlash >= 0 ? srcPattern.slice(0, lastSlash) : '.';
  const filePart = lastSlash >= 0 ? srcPattern.slice(lastSlash + 1) : srcPattern;

  if (filePart.includes('*')) {
    const fullDir = path.join(extractDir, dirPart);
    if (!fs.existsSync(fullDir) || !fs.statSync(fullDir).isDirectory()) {
      return [];
    }

    // Convert glob pattern to regex: *.mdc → /^.*\.mdc$/
    const escaped = filePart
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`);

    const entries = fs.readdirSync(fullDir, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
      if (entry.isFile() && regex.test(entry.name)) {
        results.push(dirPart === '.' ? entry.name : path.join(dirPart, entry.name));
      }
    }
    return results;
  }

  // For other patterns, treat as exact path
  const fullPath = path.join(extractDir, srcPattern);
  if (fs.existsSync(fullPath)) {
    return [srcPattern];
  }
  return [];
}
