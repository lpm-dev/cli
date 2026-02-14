import chalk from 'chalk';

const TIER_COLORS = {
  excellent: chalk.green,
  good: chalk.blue,
  fair: chalk.yellow,
  'needs-work': chalk.gray,
};

const TIER_LABELS = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  'needs-work': 'Needs Work',
};

const CATEGORY_LABELS = {
  documentation: 'Documentation',
  code: 'Code Quality',
  testing: 'Testing',
  health: 'Package Health',
};

/**
 * Render a progress bar string
 * @param {number} value
 * @param {number} max
 * @param {number} width
 * @returns {string}
 */
function progressBar(value, max, width = 18) {
  const ratio = Math.min(value / max, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

/**
 * Display quality report in the terminal.
 *
 * @param {{ score: number, checks: Array, meta: object }} result
 */
export function displayQualityReport({ score, checks, meta }) {
  const tierColor = TIER_COLORS[meta.tier] || chalk.white;
  const tierLabel = TIER_LABELS[meta.tier] || meta.tier;

  const hasServerOnly = checks.some(c => c.serverOnly);

  console.log('');
  console.log(
    `  ${chalk.bold('Quality Score:')} ${tierColor(`${score}/100`)} ${tierColor(`(${tierLabel})`)}${hasServerOnly ? chalk.dim(' — estimated, final score after publish') : ''}`,
  );
  console.log('');

  // Category bars
  for (const [cat, { score: catScore, max }] of Object.entries(
    meta.categories,
  )) {
    const label = (CATEGORY_LABELS[cat] || cat).padEnd(16);
    const bar = progressBar(catScore, max);
    console.log(`  ${label}${bar}  ${catScore}/${max}`);
  }
  console.log('');

  // Individual checks
  for (const check of checks) {
    if (check.serverOnly) {
      // Show server-only checks dimmed with ~ icon
      const icon = chalk.dim('~');
      const label = chalk.dim(check.label);
      const detail = chalk.dim(' (verified after publish)');
      console.log(`  ${icon} ${label}${detail}`);
      continue;
    }
    const icon = check.passed ? chalk.green('✓') : chalk.red('✗');
    const label = check.passed ? check.label : chalk.dim(check.label);
    const detail = check.detail ? chalk.dim(` (${check.detail})`) : '';
    console.log(`  ${icon} ${label}${detail}`);
  }

  // Tips for failed checks (exclude server-only)
  const failed = checks.filter(c => !c.passed && !c.serverOnly);
  if (failed.length > 0) {
    console.log('');
    const tips = failed.slice(0, 3);
    for (const check of tips) {
      console.log(
        chalk.dim(`  Tip: ${getTip(check.id)} (+${check.maxPoints} points)`),
      );
    }
  }

  console.log('');
}

/**
 * Get a human-readable tip for a failed check
 * @param {string} checkId
 * @returns {string}
 */
function getTip(checkId) {
  const tips = {
    'has-readme': 'Add a README.md with at least 100 characters',
    'readme-install': 'Add an install/getting started section to your README',
    'readme-usage': 'Add usage examples with code blocks to your README',
    'readme-api': 'Add an API/reference section to your README',
    'has-changelog': 'Add a CHANGELOG.md file',
    'has-license': 'Add a LICENSE file',
    'has-types': 'Add TypeScript types ("types" field or .d.ts files)',
    'intellisense-coverage':
      'Add .d.ts type definitions or JSDoc @param/@returns comments',
    'esm-exports': 'Add "type": "module" or "exports" to package.json',
    'tree-shakable':
      'Add "sideEffects": false to package.json for tree-shaking',
    'no-eval': 'Remove eval() and new Function() usage',
    'has-engines': 'Add "engines": { "node": ">=18" } to package.json',
    'has-exports-map': 'Add an "exports" map to package.json',
    'small-deps': 'Reduce the number of production dependencies',
    'source-maps': 'Include .js.map source maps for easier debugging',
    'has-test-files': 'Add test files (*.test.js, *.spec.js)',
    'has-test-script': 'Add a test script to package.json',
    'has-ci-config': 'Add a CI config (.github/workflows/)',
    'has-description': 'Add a description (>10 chars) to package.json',
    'has-keywords': 'Add keywords to package.json',
    'has-repository': 'Add a repository field to package.json',
    'has-homepage': 'Add a homepage field to package.json',
    'reasonable-size': 'Reduce unpacked size (check for unnecessary files)',
    'no-vulnerabilities': 'Fix known vulnerabilities in dependencies',
    'maintenance-health': 'Publish updates regularly (within 90 days)',
    'semver-consistency': 'Use valid semantic versioning (major.minor.patch)',
    'author-verified': 'Link your GitHub or LinkedIn in your profile settings',
  };
  return tips[checkId] || `Improve: ${checkId}`;
}
