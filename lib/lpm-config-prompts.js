/**
 * Interactive prompts for LPM package configuration.
 *
 * Generates @clack/prompts calls from a configSchema definition.
 * Only prompts for parameters not already provided via URL params.
 *
 * @module cli/lib/lpm-config-prompts
 */

import * as p from '@clack/prompts';

/**
 * Prompt the user for missing config parameters.
 *
 * Iterates over configSchema entries. For each key NOT in inlineConfig,
 * shows an appropriate prompt based on the field type.
 *
 * @param {Record<string, object>} configSchema - Config schema from lpm.config.json
 * @param {Record<string, string>} inlineConfig - Already-provided params from URL
 * @param {Record<string, *>} defaultConfig - Default values
 * @returns {Promise<Record<string, *>>} User answers for missing params
 */
export async function promptForMissingConfig(
  configSchema,
  inlineConfig,
  defaultConfig,
) {
  const answers = {};
  const missingKeys = Object.keys(configSchema).filter(
    key => !(key in inlineConfig),
  );

  if (missingKeys.length === 0) return answers;

  for (const key of missingKeys) {
    const schema = configSchema[key];
    const defaultValue = defaultConfig?.[key] ?? schema.default;

    if (schema.type === 'boolean') {
      const result = await p.confirm({
        message: schema.label || `Enable ${key}?`,
        initialValue: defaultValue ?? false,
      });

      if (p.isCancel(result)) {
        p.cancel('Operation cancelled.');
        process.exit(0);
      }

      answers[key] = String(result);
    } else if (schema.type === 'select' && schema.multiSelect) {
      const options = (schema.options || []).map(opt => {
        if (typeof opt === 'string') {
          return { value: opt, label: opt };
        }
        return { value: opt.value, label: opt.label || opt.value };
      });

      const result = await p.multiselect({
        message: schema.label || `Select ${key}:`,
        options,
        initialValues: Array.isArray(defaultValue)
          ? defaultValue
          : defaultValue
            ? [defaultValue]
            : [],
        required: false,
      });

      if (p.isCancel(result)) {
        p.cancel('Operation cancelled.');
        process.exit(0);
      }

      // Join as comma-separated string (matches URL param format)
      answers[key] = Array.isArray(result) ? result.join(',') : result;
    } else if (schema.type === 'select') {
      const options = (schema.options || []).map(opt => {
        if (typeof opt === 'string') {
          return { value: opt, label: opt };
        }
        return { value: opt.value, label: opt.label || opt.value };
      });

      const result = await p.select({
        message: schema.label || `Select ${key}:`,
        options,
        initialValue: defaultValue,
      });

      if (p.isCancel(result)) {
        p.cancel('Operation cancelled.');
        process.exit(0);
      }

      answers[key] = result;
    }
  }

  return answers;
}
