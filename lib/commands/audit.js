/**
 * Audit Command
 *
 * Scan project dependencies for known security vulnerabilities.
 *
 * Usage:
 *   lpm audit [options]
 *   lpm audit fix
 *
 * Options:
 *   --json    Output in JSON format
 *   --level   Minimum severity to report (low, moderate, high, critical)
 *
 * @module cli/lib/commands/audit
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { post } from '../api.js';

/**
 * Severity levels in order of priority.
 */
const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'info'];

/**
 * Severity colors.
 */
const SEVERITY_COLORS = {
  critical: chalk.bgRed.white,
  high: chalk.red,
  moderate: chalk.yellow,
  low: chalk.blue,
  info: chalk.dim,
};

/**
 * Read and parse package.json from current directory.
 * @returns {{ dependencies: Record<string, string>, devDependencies: Record<string, string> } | null}
 */
function readPackageJson() {
  const packageJsonPath = join(process.cwd(), 'package.json');

  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const content = readFileSync(packageJsonPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Read and parse package-lock.json for exact versions.
 * @returns {Record<string, { version: string, resolved?: string }> | null}
 */
function readPackageLock() {
  const lockPath = join(process.cwd(), 'package-lock.json');

  if (!existsSync(lockPath)) {
    return null;
  }

  try {
    const content = readFileSync(lockPath, 'utf8');
    const lock = JSON.parse(content);
    return lock.packages || lock.dependencies || null;
  } catch {
    return null;
  }
}

/**
 * Format vulnerability count by severity.
 * @param {Object} counts
 * @returns {string}
 */
function formatVulnCounts(counts) {
  const parts = [];

  for (const severity of SEVERITY_ORDER) {
    const count = counts[severity] || 0;
    if (count > 0) {
      const color = SEVERITY_COLORS[severity] || chalk.dim;
      parts.push(color(`${count} ${severity}`));
    }
  }

  return parts.join(', ') || chalk.green('0 vulnerabilities');
}

/**
 * Execute the audit command.
 *
 * @param {string} [action] - Optional action ('fix')
 * @param {Object} options - Command options
 * @param {boolean} [options.json] - Output as JSON
 * @param {string} [options.level] - Minimum severity level
 */
export async function audit(action, options = {}) {
  const spinner = ora('Reading dependencies...').start();

  // Read package.json
  const packageJson = readPackageJson();

  if (!packageJson) {
    spinner.fail(chalk.red('No package.json found in current directory.'));
    process.exit(1);
  }

  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };

  const depCount = Object.keys(dependencies).length;

  if (depCount === 0) {
    spinner.succeed(chalk.green('No dependencies to audit.'));
    return;
  }

  // Try to get exact versions from lock file
  const lockData = readPackageLock();

  // Build dependency list for API
  const depList = Object.entries(dependencies).map(([name, version]) => {
    // Try to get exact version from lock
    let exactVersion = version;
    if (lockData) {
      const lockEntry = lockData[name] || lockData[`node_modules/${name}`];
      if (lockEntry?.version) {
        exactVersion = lockEntry.version;
      }
    }
    return { name, version: exactVersion };
  });

  spinner.text = `Auditing ${depCount} dependencies...`;

  try {
    const response = await post(
      '/audit',
      { dependencies: depList },
      {
        onRetry: (attempt, max) => {
          spinner.text = `Auditing (retry ${attempt}/${max})...`;
        },
      },
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Audit request failed.');
    }

    const data = await response.json();
    const vulnerabilities = data.vulnerabilities || [];

    spinner.stop();

    // Filter by severity level if specified
    let filteredVulns = vulnerabilities;
    if (options.level) {
      const levelIndex = SEVERITY_ORDER.indexOf(options.level);
      if (levelIndex !== -1) {
        filteredVulns = vulnerabilities.filter(v => {
          const vIndex = SEVERITY_ORDER.indexOf(v.severity);
          return vIndex !== -1 && vIndex <= levelIndex;
        });
      }
    }

    // JSON output
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            scanned: depCount,
            vulnerabilities: filteredVulns,
            counts: data.counts || {},
          },
          null,
          2,
        ),
      );
      return;
    }

    // No vulnerabilities
    if (filteredVulns.length === 0) {
      console.log(
        chalk.green(
          `\n✓ No vulnerabilities found in ${depCount} dependencies.\n`,
        ),
      );
      return;
    }

    // Display vulnerabilities
    console.log(
      chalk.bold(
        `\nFound ${formatVulnCounts(data.counts || {})} in ${depCount} dependencies.\n`,
      ),
    );

    // Group by package
    const byPackage = {};
    for (const vuln of filteredVulns) {
      const key = vuln.package;
      if (!byPackage[key]) {
        byPackage[key] = [];
      }
      byPackage[key].push(vuln);
    }

    // Display each package
    for (const [pkg, vulns] of Object.entries(byPackage)) {
      console.log(chalk.cyan.bold(pkg));

      for (const vuln of vulns) {
        const severityColor = SEVERITY_COLORS[vuln.severity] || chalk.dim;
        const severity = severityColor(vuln.severity.padEnd(10));
        const title = vuln.title || vuln.id || 'Unknown vulnerability';

        console.log(`  ${severity} ${title}`);

        if (vuln.vulnerable_versions) {
          console.log(chalk.dim(`    Vulnerable: ${vuln.vulnerable_versions}`));
        }

        if (vuln.patched_versions) {
          console.log(
            chalk.green(`    Fix: Upgrade to ${vuln.patched_versions}`),
          );
        }

        if (vuln.url) {
          console.log(chalk.dim(`    More info: ${vuln.url}`));
        }
      }

      console.log('');
    }

    // Fix suggestion
    if (action !== 'fix') {
      console.log(chalk.dim('Run `lpm audit fix` to attempt automatic fixes.'));
      console.log('');
    }

    // Handle fix action
    if (action === 'fix') {
      console.log(chalk.yellow('Automatic fix is not yet implemented.'));
      console.log(
        chalk.dim(
          'Please update vulnerable packages manually based on the recommendations above.',
        ),
      );
      console.log('');
    }

    // Exit with error code if vulnerabilities found
    if (
      filteredVulns.some(
        v => v.severity === 'critical' || v.severity === 'high',
      )
    ) {
      process.exit(1);
    }
  } catch (error) {
    spinner.fail(chalk.red('Audit failed.'));
    console.error(chalk.red(`  ${error.message}`));
    process.exit(1);
  }
}

export default audit;
