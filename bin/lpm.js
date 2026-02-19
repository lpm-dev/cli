#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import updateNotifier from 'update-notifier';
import { add } from '../lib/commands/add.js';
import { audit } from '../lib/commands/audit.js';
import { cache } from '../lib/commands/cache.js';
import { config } from '../lib/commands/config.js';
import { doctor } from '../lib/commands/doctor.js';
import { info } from '../lib/commands/info.js';
import { init } from '../lib/commands/init.js';
import { install } from '../lib/commands/install.js';
import { login } from '../lib/commands/login.js';
import { logout } from '../lib/commands/logout.js';
import { openDashboard } from '../lib/commands/open.js';
import { outdated } from '../lib/commands/outdated.js';
import { publish } from '../lib/commands/publish.js';
import { quality } from '../lib/commands/quality.js';
import { remove } from '../lib/commands/remove.js';
import { run } from '../lib/commands/run.js';
import { search } from '../lib/commands/search.js';
import { setup } from '../lib/commands/setup.js';
import { checkName } from '../lib/commands/check-name.js';
import { marketplaceCompare } from '../lib/commands/marketplace-compare.js';
import { marketplaceEarnings } from '../lib/commands/marketplace-earnings.js';
import { mcpSetup, mcpRemove, mcpStatus } from '../lib/commands/mcp-setup.js';
import { poolStats } from '../lib/commands/pool-stats.js';
import { rotateToken } from '../lib/commands/token-rotate.js';
import { whoami } from '../lib/commands/whoami.js';

// Load package.json
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'),
);

// Check for updates
updateNotifier({ pkg }).notify();

const program = new Command();

program
  .name('lpm')
  .description('CLI for Licensed Package Manager')
  .version(pkg.version);

// ============================================================================
// Authentication Commands
// ============================================================================

program
  .command('login')
  .alias('l')
  .description('Authenticate with the registry')
  .action(login);

program
  .command('logout')
  .alias('lo')
  .description('Clear stored authentication token')
  .option('--revoke', 'Also revoke the token on the server')
  .option('--clear-cache', 'Clear local package cache')
  .action(logout);

program
  .command('whoami')
  .description('Check current authenticated user')
  .option('--json', 'Output in JSON format')
  .action(whoami);

// ============================================================================
// Package Management Commands
// ============================================================================

program
  .command('init')
  .description('Interactively create a package.json for LPM')
  .action(init);

program
  .command('install [packages...]')
  .alias('i')
  .description('Install packages with automatic registry authentication')
  .action(install);

program
  .command('publish')
  .alias('p')
  .description('Publish a package to the registry')
  .option('--check', 'Run quality checks and display report without publishing')
  .option(
    '--min-score <score>',
    'Minimum quality score required to publish (0-100)',
  )
  .action(publish);

program
  .command('add <package>')
  .description('Download and extract a package source code to your project')
  .option('-p, --path <path>', 'Target directory for the component')
  .option('-f, --force', 'Overwrite existing files without prompting')
  .option('-y, --yes', 'Accept defaults, skip interactive config prompts')
  .action(add);

program
  .command('remove <package>')
  .alias('rm')
  .description('Remove a previously added package (e.g., MCP servers from editors)')
  .action(remove);

// ============================================================================
// Package Discovery Commands
// ============================================================================

program
  .command('search <query>')
  .description('Search for packages in the marketplace')
  .option('--limit <n>', 'Maximum number of results', '20')
  .option('--json', 'Output in JSON format')
  .action((query, options) =>
    search(query, { ...options, limit: parseInt(options.limit, 10) }),
  );

program
  .command('info <package>')
  .description('Show detailed information about a package')
  .option('--json', 'Output in JSON format')
  .option('-a, --all-versions', 'Show all versions')
  .action(info);

program
  .command('check-name <name>')
  .description('Check if a package name is available on the registry')
  .option('--json', 'Output in JSON format')
  .action(checkName);

program
  .command('quality <package>')
  .description('Show the server-side quality report for a package')
  .option('--json', 'Output in JSON format')
  .action(quality);

// ============================================================================
// Security & Maintenance Commands
// ============================================================================

program
  .command('audit [action]')
  .description('Scan dependencies for known vulnerabilities')
  .option('--json', 'Output in JSON format')
  .option(
    '--level <level>',
    'Minimum severity to report (low, moderate, high, critical)',
  )
  .action(audit);

program
  .command('outdated')
  .description('Check for outdated dependencies')
  .option('--json', 'Output in JSON format')
  .option('--all', 'Show all dependencies, not just outdated ones')
  .action(outdated);

program
  .command('doctor')
  .description('Check the health of your LPM setup')
  .action(doctor);

// ============================================================================
// Configuration Commands
// ============================================================================

program
  .command('setup')
  .description('Configure .npmrc for LPM packages (@lpm.dev scope)')
  .option('-r, --registry <url>', 'Custom registry URL')
  .action(setup);

program
  .command('config [action] [key] [value]')
  .description('Manage CLI configuration (list, get, set, delete)')
  .action(config);

program
  .command('set <key> <value>')
  .description('Shortcut for "lpm config set"')
  .action((key, value) => config('set', key, value));

program
  .command('cache <action>')
  .description('Manage local package cache (clean, list, path)')
  .action(cache);

// ============================================================================
// Utility Commands
// ============================================================================

program
  .command('open')
  .description('Open the dashboard or package page in your browser')
  .action(openDashboard);

program
  .command('run <script>')
  .description('Run npm scripts (forwards to npm run)')
  .allowUnknownOption()
  .action(run);

// ============================================================================
// Token Management (Subcommand)
// ============================================================================

const token = program
  .command('token')
  .description('Manage authentication tokens');

token
  .command('rotate')
  .description('Rotate the current token')
  .action(rotateToken);

// ============================================================================
// Pool Revenue (Subcommand)
// ============================================================================

const pool = program
  .command('pool')
  .description('Pool revenue commands');

pool
  .command('stats')
  .description('Show your Pool earnings estimate for the current month')
  .option('--json', 'Output in JSON format')
  .action(poolStats);

// ============================================================================
// MCP Server (Subcommand)
// ============================================================================

const mcp = program
  .command('mcp')
  .description('MCP server commands');

mcp
  .command('setup')
  .description('Configure the LPM MCP server in your AI coding editors')
  .option('--project', 'Add to project-level config instead of global')
  .action(mcpSetup);

mcp
  .command('remove')
  .description('Remove the LPM MCP server from all configured editors')
  .option('--project', 'Remove from project-level config only')
  .action(mcpRemove);

mcp
  .command('status')
  .description('Show where the LPM MCP server is configured')
  .action(mcpStatus);

// ============================================================================
// Marketplace (Subcommand)
// ============================================================================

const marketplace = program
  .command('marketplace')
  .description('Marketplace commands');

marketplace
  .command('compare <input>')
  .description('Find comparable packages by name or category')
  .option('--json', 'Output in JSON format')
  .option('--category <category>', 'Filter by category')
  .option('--limit <n>', 'Maximum number of results')
  .action(marketplaceCompare);

marketplace
  .command('earnings')
  .description('Show your Marketplace revenue summary')
  .option('--json', 'Output in JSON format')
  .action(marketplaceEarnings);

program.parse();
