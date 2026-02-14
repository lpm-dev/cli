import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { getRegistryUrl } from '../config.js';
import { printHeader } from '../ui.js';
import { setup } from './setup.js';

/**
 * Parse package name in the @lpm.dev/owner.package format
 */
function parsePackageName(name) {
  if (!name.startsWith('@lpm.dev/')) {
    return { error: 'Package name must start with @lpm.dev/' };
  }

  const nameWithOwner = name.replace('@lpm.dev/', '');
  const dotIndex = nameWithOwner.indexOf('.');

  if (dotIndex === -1) {
    return { error: 'Format: @lpm.dev/owner.package-name' };
  }

  const owner = nameWithOwner.substring(0, dotIndex);
  const pkgName = nameWithOwner.substring(dotIndex + 1);

  // Validate owner format
  if (!/^[a-z][a-z0-9-]*$/.test(owner)) {
    return {
      error:
        'Owner must start with a letter and contain only lowercase letters, numbers, and hyphens',
    };
  }

  // Validate package name format
  if (!/^[a-z][a-z0-9-]*$/.test(pkgName)) {
    return {
      error:
        'Package name must start with a letter and contain only lowercase letters, numbers, and hyphens',
    };
  }

  return { owner, name: pkgName };
}

export async function init() {
  printHeader();

  p.intro(chalk.bgCyan(chalk.black(' lpm init ')));

  const project = await p.group(
    {
      name: () =>
        p.text({
          message: 'What is the name of your package?',
          placeholder: '@lpm.dev/username.package-name',
          validate: value => {
            if (!value) return 'Name is required';
            const parsed = parsePackageName(value);
            if (parsed.error) return parsed.error;
          },
        }),
      version: () =>
        p.text({
          message: 'Version',
          initialValue: '0.1.0',
        }),
      description: () =>
        p.text({
          message: 'Description',
          placeholder: 'A brief description of your package',
        }),
      entry: () =>
        p.text({
          message: 'Entry point',
          initialValue: 'index.js',
        }),
      license: () =>
        p.select({
          message: 'License type',
          options: [
            { value: 'ISC', label: 'ISC' },
            { value: 'MIT', label: 'MIT' },
            { value: 'UNLICENSED', label: 'UNLICENSED (Private/Proprietary)' },
          ],
        }),
      confirm: () =>
        p.confirm({
          message: 'Create package.json?',
          initialValue: true,
        }),
    },
    {
      onCancel: () => {
        p.cancel('Operation cancelled.');
        process.exit(0);
      },
    },
  );

  if (project.confirm) {
    const registryUrl = getRegistryUrl();
    const packageJson = {
      name: project.name,
      version: project.version,
      description: project.description,
      main: project.entry,
      scripts: {
        test: 'echo "Error: no test specified" && exit 1',
      },
      author: '',
      license: project.license,
      publishConfig: {
        registry: `${registryUrl}/api/registry/`,
      },
    };

    const filePath = path.join(process.cwd(), 'package.json');
    fs.writeFileSync(filePath, JSON.stringify(packageJson, null, 2));

    p.note(JSON.stringify(packageJson, null, 2), 'package.json');

    // Offer to setup .npmrc
    const npmrcPath = path.join(process.cwd(), '.npmrc');
    if (
      !fs.existsSync(npmrcPath) ||
      !fs.readFileSync(npmrcPath, 'utf8').includes('@lpm.dev:registry')
    ) {
      const setupNpmrc = await p.confirm({
        message: 'Create .npmrc for local development?',
        initialValue: true,
      });

      if (!p.isCancel(setupNpmrc) && setupNpmrc) {
        await setup({ registry: registryUrl });
        return;
      }
    }

    p.outro(
      `Package initialized! Run ${chalk.cyan('lpm publish')} to push to the registry.`,
    );
  } else {
    p.outro('Cancelled.');
  }
}
