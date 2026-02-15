/**
 * Search Command
 *
 * Search for packages using hybrid keyword + semantic search.
 *
 * Usage:
 *   lpm search <query> [options]
 *
 * Options:
 *   --limit <n>  Maximum number of results (default: 20)
 *   --json       Output in JSON format
 *
 * @module cli/lib/commands/search
 */

import chalk from 'chalk';
import ora from 'ora';
import { searchGet } from '../api.js';
import { DEFAULT_PAGE_LIMIT } from '../constants.js';

/**
 * Format downloads count.
 * @param {number} count
 * @returns {string}
 */
function formatDownloads(count) {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return String(count);
}

/**
 * Execute the search command.
 *
 * @param {string} query - Search query
 * @param {Object} options - Command options
 * @param {number} [options.limit] - Maximum results
 * @param {boolean} [options.json] - Output as JSON
 */
export async function search(query, options = {}) {
  if (!query || query.trim() === '') {
    console.error(chalk.red('Error: Search query required.'));
    console.log(chalk.dim('Usage: lpm search <query>'));
    process.exit(1);
  }

  const limit = options.limit || DEFAULT_PAGE_LIMIT;
  const spinner = ora(`Searching for "${query}"...`).start();

  try {
    const params = new URLSearchParams({
      q: query,
      mode: 'semantic',
      limit: String(limit),
    });

    const response = await searchGet(`/packages?${params.toString()}`, {
      onRetry: (attempt, max) => {
        spinner.text = `Searching (retry ${attempt}/${max})...`;
      },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(
        data.error || `Search failed with status ${response.status}`,
      );
    }

    const data = await response.json();
    const packages = data.packages || [];

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(packages, null, 2));
      return;
    }

    if (packages.length === 0) {
      console.log(chalk.yellow(`\nNo packages found for "${query}".`));
      return;
    }

    console.log(
      chalk.bold(
        `\nFound ${packages.length} package${packages.length > 1 ? 's' : ''}:\n`,
      ),
    );

    // Calculate column widths (use LPM format: @lpm.dev/owner.name)
    const maxNameLength = Math.max(
      ...packages.map(p => {
        const owner = p.ownerSlug || p.owner;
        return (owner ? `@lpm.dev/${owner}.${p.name}` : p.name).length;
      }),
      10,
    );

    for (const pkg of packages) {
      const owner = pkg.ownerSlug || pkg.owner;
      const fullName = owner
        ? `@lpm.dev/${owner}.${pkg.name}`
        : pkg.name;
      const paddedName = fullName.padEnd(maxNameLength);
      const version = chalk.dim(
        `v${pkg.latestVersion || pkg.version || 'unknown'}`.padEnd(12),
      );
      const downloads = chalk.green(
        `↓ ${formatDownloads(pkg.downloadCount ?? pkg.downloads ?? 0)}`.padEnd(
          10,
        ),
      );

      console.log(`  ${chalk.cyan(paddedName)}  ${version}  ${downloads}`);

      if (pkg.description) {
        const truncatedDesc =
          pkg.description.length > 60
            ? `${pkg.description.slice(0, 57)}...`
            : pkg.description;
        console.log(`  ${chalk.dim(truncatedDesc)}`);
      }

      console.log('');
    }

    if (packages.length === limit) {
      console.log(
        chalk.dim(`  Showing first ${limit} results. Use --limit to see more.`),
      );
      console.log('');
    }
  } catch (error) {
    spinner.fail(chalk.red('Search failed.'));
    console.error(chalk.red(`  ${error.message}`));
    process.exit(1);
  }
}

export default search;
