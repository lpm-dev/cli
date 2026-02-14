import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { getRegistryUrl } from '../config.js';
import { log, printHeader } from '../ui.js';

/**
 * Configure .npmrc for LPM packages.
 * Sets up the @lpm.dev scope to point to the LPM registry.
 */
export async function setup(options) {
  printHeader();

  p.intro(chalk.bgCyan(chalk.black(' lpm setup ')));

  const registryUrl = options?.registry || getRegistryUrl();
  const projectRoot = process.cwd();
  const npmrcPath = path.join(projectRoot, '.npmrc');

  // Check for package.json
  const pkgJsonPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    log.warn('No package.json found. Run this command in your project root.');
  }

  // Check for existing .npmrc
  let npmrcContent = '';
  if (fs.existsSync(npmrcPath)) {
    npmrcContent = fs.readFileSync(npmrcPath, 'utf8');

    // Check if already configured
    if (npmrcContent.includes('@lpm.dev:registry')) {
      const overwrite = await p.confirm({
        message: '.npmrc already has LPM configuration. Overwrite?',
        initialValue: false,
      });

      if (p.isCancel(overwrite) || !overwrite) {
        p.outro('Setup cancelled.');
        return;
      }

      // Remove existing LPM config lines
      npmrcContent = npmrcContent
        .split('\n')
        .filter(line => {
          return (
            !line.includes('@lpm.dev:registry') &&
            !line.includes('lpm.dev/api/registry/:_authToken') &&
            !line.includes('# LPM Registry')
          );
        })
        .join('\n')
        .trim();
    }
  }

  // Build registry URL
  const fullRegistryUrl = registryUrl.endsWith('/api/registry')
    ? registryUrl
    : `${registryUrl}/api/registry`;

  // Remove protocol for auth token config
  const registryHost = fullRegistryUrl.replace(/^https?:/, '');

  // Add LPM registry config
  const lpmConfig = `
# LPM Registry
@lpm.dev:registry=${fullRegistryUrl}
${registryHost}/:_authToken=\${LPM_TOKEN}
`.trim();

  // Combine with existing content
  npmrcContent = npmrcContent ? `${npmrcContent}\n\n${lpmConfig}` : lpmConfig;

  // Write .npmrc
  fs.writeFileSync(npmrcPath, `${npmrcContent}\n`);

  p.note(
    `@lpm.dev:registry=${fullRegistryUrl}\n${registryHost}/:_authToken=\${LPM_TOKEN}`,
    '.npmrc configuration',
  );

  console.log('');
  log.success('.npmrc configured for LPM packages.');
  log.info('For local development: Run `lpm login` to authenticate.');
  log.info('For CI/CD: Set the LPM_TOKEN environment variable.');
  console.log('');

  p.outro('Setup complete!');
}
