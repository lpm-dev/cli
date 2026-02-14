import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getRegistryUrl, getToken } from '../config.js';
import { createSpinner, log, printHeader } from '../ui.js';

/**
 * Check if a package name is an LPM package
 * LPM packages use the @lpm.dev scope
 */
function isLpmPackage(pkgName) {
  return pkgName.startsWith('@lpm.dev/');
}

export async function install(packages, _options) {
  printHeader();
  const token = await getToken();
  if (!token) {
    log.error(
      'You must be logged in to install packages. Run "lpm login" first.',
    );
    process.exit(1);
  }

  if (!packages || packages.length === 0) {
    // No packages specified - read from package.json
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      log.error('No packages specified and no package.json found.');
      process.exit(1);
    }

    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    // Filter to LPM packages only (@lpm.dev scope)
    packages = Object.keys(allDeps).filter(isLpmPackage);

    if (packages.length === 0) {
      log.info('No LPM packages (@lpm.dev/*) found in package.json.');
      process.exit(0);
    }

    log.info(`Installing ${packages.length} LPM packages from package.json...`);
  }

  const spinner = createSpinner(
    `Preparing to install ${packages.join(', ')}...`,
  ).start();

  const baseRegistryUrl = getRegistryUrl();
  // Ensure we have the full registry path for npm
  const registryUrl = baseRegistryUrl.endsWith('/api/registry')
    ? baseRegistryUrl
    : `${baseRegistryUrl}/api/registry`;
  // Remove protocol for auth token config (e.g. https://registry.com/ -> //registry.com/)
  const registryHost = registryUrl.replace(/^https?:/, '');

  // Create temporary .npmrc content
  // Simple configuration - all LPM packages use @lpm.dev scope
  const npmrcContent = `${registryHost}/:_authToken=${token}
@lpm.dev:registry=${registryUrl}
`;

  // Write to temp file
  const tempNpmrcPath = path.resolve(process.cwd(), `.npmrc.lpm-${Date.now()}`);
  fs.writeFileSync(tempNpmrcPath, npmrcContent);

  spinner.succeed('Configuration generated. Running npm install...');

  // Run npm install
  // We use --userconfig to point to our temp file.
  // Note: This replaces the user's ~/.npmrc for this command, but project .npmrc is still respected.
  // If the project .npmrc conflicts, it might be an issue, but usually project .npmrc is for scope mapping.

  const npmArgs = ['install', ...packages, '--userconfig', tempNpmrcPath];

  // Pass the token as LPM_TOKEN env var so project .npmrc with ${LPM_TOKEN} works
  const child = spawn('npm', npmArgs, {
    stdio: 'inherit',
    env: { ...process.env, LPM_TOKEN: token },
  });

  const cleanup = () => {
    if (fs.existsSync(tempNpmrcPath)) {
      fs.unlinkSync(tempNpmrcPath);
    }
  };

  child.on('close', code => {
    cleanup();
    if (code !== 0) {
      log.error(`npm install failed with code ${code}`);
      process.exit(code);
    } else {
      log.success('Packages installed successfully.');
    }
  });

  child.on('error', err => {
    log.error(`Failed to start npm: ${err.message}`);
    cleanup();
    process.exit(1);
  });

  // Handle interrupt to cleanup
  process.on('SIGINT', () => {
    cleanup();
    process.exit();
  });
}
