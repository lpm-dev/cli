import { exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import * as Diff from 'diff';
import ora from 'ora';
import * as tar from 'tar';
import { getRegistryUrl, getToken } from '../config.js';
import { verifyIntegrity } from '../integrity.js';
import {
  applyTemplateVariables,
  expandSrcGlob,
  filterFiles,
  parseLpmPackageReference,
  readLpmConfig,
  resolveConditionalDependencies,
  resolveVariants,
} from '../lpm-config.js';
import { promptForMissingConfig } from '../lpm-config-prompts.js';
import {
  detectFramework,
  getDefaultPath,
  getUserImportPrefix,
} from '../project-utils.js';
import { validateComponentPath, validateTarballPaths } from '../safe-path.js';

const execAsync = promisify(exec);

export async function add(pkgName, options) {
  const spinner = ora().start();

  try {
    // 1. Auth Check
    const token = await getToken();
    if (!token) {
      spinner.fail('Not logged in. Run `lpm login` first.');
      return;
    }

    // 2. Resolve Package Name, Version & URL Config Params
    const { name, version, inlineConfig, providedParams } =
      parseLpmPackageReference(pkgName);

    spinner.text = `Resolving ${chalk.cyan(name)}@${chalk.green(version)}...`;

    // 3. Fetch Metadata to get Tarball URL
    const baseRegistryUrl = getRegistryUrl();
    const registryUrl = baseRegistryUrl.endsWith('/api/registry')
      ? baseRegistryUrl
      : `${baseRegistryUrl}/api/registry`;
    const encodedName = name.replace('/', '%2f');

    let meta;
    try {
      const res = await fetch(`${registryUrl}/${encodedName}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const error = new Error(res.statusText);
        error.response = { status: res.status };
        throw error;
      }

      meta = await res.json();
    } catch (err) {
      if (err.response?.status === 404) {
        throw new Error(`Package '${name}' not found.`);
      }
      if (err.response?.status === 401 || err.response?.status === 403) {
        throw new Error(
          `Unauthorized access to '${name}'. Check your permissions.`,
        );
      }
      throw err;
    }

    // Resolve version
    const distTags = meta['dist-tags'] || {};
    const targetVersion = version === 'latest' ? distTags.latest : version;

    if (!targetVersion || !meta.versions[targetVersion]) {
      throw new Error(`Version '${version}' not found for package '${name}'.`);
    }

    const versionData = meta.versions[targetVersion];
    const tarballUrl = versionData.dist?.tarball;
    const expectedIntegrity = versionData.dist?.integrity;

    if (!tarballUrl) {
      throw new Error('No tarball URL found in package metadata.');
    }

    // 4. Download Tarball
    spinner.text = `Downloading ${chalk.cyan(name)}...`;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-add-'));
    const tarballPath = path.join(tmpDir, 'package.tgz');

    const response = await fetch(tarballUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to download tarball: ${response.statusText}`);
    }

    const tarballBuffer = Buffer.from(await response.arrayBuffer());

    // 4.1 Verify Tarball Integrity
    if (expectedIntegrity) {
      spinner.text = 'Verifying package integrity...';
      const integrityResult = verifyIntegrity(tarballBuffer, expectedIntegrity);

      if (!integrityResult.valid) {
        throw new Error(
          `${integrityResult.error}\nExpected: ${expectedIntegrity}\nActual: ${integrityResult.actual || 'unknown'}`,
        );
      }
    }

    fs.writeFileSync(tarballPath, tarballBuffer);

    // 5. Extract Tarball
    spinner.text = 'Extracting...';
    const extractDir = path.join(tmpDir, 'extracted');
    fs.mkdirSync(extractDir);

    const tarFiles = [];
    await tar.t({
      file: tarballPath,
      onReadEntry: entry => {
        tarFiles.push(entry.path);
      },
    });

    const pathValidation = validateTarballPaths(extractDir, tarFiles);
    if (!pathValidation.valid) {
      throw new Error(
        `Package contains unsafe paths: ${pathValidation.invalidPaths.join(', ')}`,
      );
    }

    await tar.x({
      file: tarballPath,
      cwd: extractDir,
      strip: 1,
    });

    // 5.1 Read lpm.config.json (if present)
    spinner.text = 'Reading package configuration...';
    const lpmConfig = readLpmConfig(extractDir);

    // Track config-based file list (null = use legacy flow)
    let configuredFiles = null;
    let mergedConfig = {};

    if (lpmConfig?.configSchema) {
      // Prompt for missing config params (unless --yes)
      let interactiveAnswers = {};
      if (!options.yes) {
        spinner.stop();
        interactiveAnswers = await promptForMissingConfig(
          lpmConfig.configSchema,
          inlineConfig,
          lpmConfig.defaultConfig || {},
        );
        spinner.start();
      }

      // Interactive answers count as "provided" — the user explicitly chose
      for (const key of Object.keys(interactiveAnswers)) {
        providedParams.add(key);
      }

      // Merge config: defaults < interactive < inline (inline wins)
      mergedConfig = {
        ...(lpmConfig.defaultConfig || {}),
        ...interactiveAnswers,
        ...inlineConfig,
      };

      // For --yes with required fields: add them to providedParams
      // so they use the default value instead of "include all"
      if (options.yes && lpmConfig.configSchema) {
        for (const [key, schema] of Object.entries(lpmConfig.configSchema)) {
          if (schema.required && !providedParams.has(key)) {
            providedParams.add(key);
          }
        }
      }

      // Filter files based on conditions and providedParams
      if (lpmConfig.files) {
        configuredFiles = filterFiles(
          lpmConfig.files,
          mergedConfig,
          providedParams,
        );
      }
    } else if (lpmConfig?.files) {
      // lpm.config.json with files but no configSchema (simple conditional includes)
      mergedConfig = { ...(lpmConfig.defaultConfig || {}), ...inlineConfig };

      configuredFiles = filterFiles(
        lpmConfig.files,
        mergedConfig,
        providedParams,
      );
    }

    // 6. Determine Target Path
    let targetDir;
    const projectRoot = process.cwd();

    if (options.path) {
      const pathResult = validateComponentPath(projectRoot, options.path);
      if (!pathResult.valid) {
        throw new Error(pathResult.error);
      }
      targetDir = pathResult.resolvedPath;
    } else {
      spinner.stop();
      const pkgBaseName = name.split('/')[1];
      const framework = detectFramework();
      const defaultPath = getDefaultPath(framework, pkgBaseName);

      const installPath = await p.text({
        message: 'Where would you like to install this component?',
        initialValue: defaultPath,
      });

      if (p.isCancel(installPath)) {
        p.cancel('Operation cancelled.');
        fs.rmSync(tmpDir, { recursive: true, force: true });
        process.exit(0);
      }

      const pathResult = validateComponentPath(projectRoot, installPath);
      if (!pathResult.valid) {
        throw new Error(pathResult.error);
      }
      targetDir = pathResult.resolvedPath;
      spinner.start();
    }

    // 7. Determine source (legacy flow or config-based)
    const pkgJsonPath = path.join(extractDir, 'package.json');
    let pkgJson = {};
    if (fs.existsSync(pkgJsonPath)) {
      pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    }

    let sourcePath = extractDir;

    if (configuredFiles) {
      // Config-based flow: skip legacy source detection
      // Files are already determined by configuredFiles
    } else if (pkgJson.lpm?.source) {
      sourcePath = path.join(extractDir, pkgJson.lpm.source);
    } else {
      spinner.stop();

      const files = fs
        .readdirSync(extractDir)
        .filter(
          f =>
            ![
              'package.json',
              'node_modules',
              '.git',
              'lpm.config.json',
            ].includes(f),
        );

      const selectedSource = await p.select({
        message:
          'No `lpm.source` found in package.json. What would you like to copy?',
        options: [
          { value: '.', label: 'Copy everything (root)' },
          ...files.map(f => ({ value: f, label: f })),
        ],
      });

      if (p.isCancel(selectedSource)) {
        p.cancel('Operation cancelled.');
        fs.rmSync(tmpDir, { recursive: true, force: true });
        process.exit(0);
      }

      sourcePath = path.join(extractDir, selectedSource);
      spinner.start();
    }

    // Check source exists (for legacy flow)
    if (!configuredFiles && !fs.existsSync(sourcePath)) {
      spinner.fail(`Source path '${sourcePath}' does not exist.`);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return;
    }

    // 8. Copy Files
    spinner.text = `Installing to ${chalk.dim(targetDir)}...`;
    spinner.stop();

    const userPrefix = getUserImportPrefix();

    if (configuredFiles) {
      // ---- Config-based file copy ----
      const isTemplate =
        lpmConfig.transform === 'template' || lpmConfig.transform === 'hybrid';

      for (const fileRule of configuredFiles) {
        // Expand glob patterns in src
        const srcPaths = expandSrcGlob(fileRule.src, extractDir);

        for (const relativeSrc of srcPaths) {
          const srcFile = path.join(extractDir, relativeSrc);

          // Determine destination path
          let destRelative;
          if (fileRule.dest) {
            if (fileRule.dest.endsWith('/')) {
              // Directory dest: preserve filename
              const fileName = path.basename(relativeSrc);
              destRelative = path.join(fileRule.dest, fileName);
            } else if (srcPaths.length > 1) {
              // Multiple src files mapped to a dest: use relative structure
              const baseSrc = fileRule.src.replace(/\/\*\*$/, '');
              const relFromBase = path.relative(
                path.join(extractDir, baseSrc),
                srcFile,
              );
              destRelative = path.join(fileRule.dest, relFromBase);
            } else {
              destRelative = fileRule.dest;
            }
          } else {
            destRelative = relativeSrc;
          }

          // Apply template variables to dest path if needed
          if (isTemplate) {
            destRelative = applyTemplateVariables(destRelative, mergedConfig);
          }

          const destFile = path.join(targetDir, destRelative);

          // Read source content
          let srcContent;
          try {
            srcContent = fs.readFileSync(srcFile, 'utf-8');

            // Apply template replacement if flagged
            if (fileRule.template && isTemplate) {
              srcContent = applyTemplateVariables(srcContent, mergedConfig);
            }

            // Import rewriting
            if (userPrefix !== '@') {
              srcContent = srcContent.replace(
                /from ['"]@\//g,
                `from '${userPrefix}/`,
              );
              srcContent = srcContent.replace(
                /import ['"]@\//g,
                `import '${userPrefix}/`,
              );
            }
          } catch (_e) {
            // Binary file
          }

          await smartCopyFile(srcFile, destFile, srcContent, options);
        }
      }

      // Handle variant files
      if (
        lpmConfig.variants &&
        (lpmConfig.transform === 'variants' || lpmConfig.transform === 'hybrid')
      ) {
        const variantPairs = resolveVariants(
          lpmConfig.variants,
          mergedConfig,
          lpmConfig.output,
        );

        for (const { src, dest } of variantPairs) {
          const srcFile = path.join(extractDir, src);
          const destFile = path.join(targetDir, dest);

          let srcContent;
          try {
            srcContent = fs.readFileSync(srcFile, 'utf-8');

            if (lpmConfig.transform === 'hybrid') {
              srcContent = applyTemplateVariables(srcContent, mergedConfig);
            }

            if (userPrefix !== '@') {
              srcContent = srcContent.replace(
                /from ['"]@\//g,
                `from '${userPrefix}/`,
              );
              srcContent = srcContent.replace(
                /import ['"]@\//g,
                `import '${userPrefix}/`,
              );
            }
          } catch (_e) {
            // Binary
          }

          await smartCopyFile(srcFile, destFile, srcContent, options);
        }
      }
    } else {
      // ---- Legacy recursive copy ----
      const smartCopy = async (src, dest) => {
        const exists = fs.existsSync(src);
        const stats = exists && fs.statSync(src);
        const isDirectory = exists && stats.isDirectory();

        if (isDirectory) {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          const entries = fs.readdirSync(src);
          for (const childItemName of entries) {
            await smartCopy(
              path.join(src, childItemName),
              path.join(dest, childItemName),
            );
          }
        } else {
          let srcContent;
          try {
            srcContent = fs.readFileSync(src, 'utf-8');
            if (userPrefix !== '@') {
              srcContent = srcContent.replace(
                /from ['"]@\//g,
                `from '${userPrefix}/`,
              );
              srcContent = srcContent.replace(
                /import ['"]@\//g,
                `import '${userPrefix}/`,
              );
            }
          } catch (_e) {
            // Binary
          }

          await smartCopyFile(src, dest, srcContent, options);
        }
      };

      const stat = fs.statSync(sourcePath);
      if (stat.isFile()) {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        const fileName = path.basename(sourcePath);
        await smartCopy(sourcePath, path.join(targetDir, fileName));
      } else {
        await smartCopy(sourcePath, targetDir);
      }
    }

    spinner.start();

    // 9. Handle Dependencies
    if (lpmConfig?.dependencies) {
      // Config-based conditional dependencies
      const { npm: npmDeps, lpm: lpmDeps } = resolveConditionalDependencies(
        lpmConfig.dependencies,
        mergedConfig,
      );

      if (npmDeps.length > 0 || lpmDeps.length > 0) {
        spinner.stop();

        if (npmDeps.length > 0) {
          console.log(chalk.blue(`\nnpm dependencies: ${npmDeps.join(', ')}`));
        }
        if (lpmDeps.length > 0) {
          console.log(chalk.blue(`\nLPM dependencies: ${lpmDeps.join(', ')}`));
        }

        const installDeps = await p.confirm({
          message: 'Install these dependencies now?',
          initialValue: true,
        });

        if (p.isCancel(installDeps)) {
          p.cancel('Operation cancelled.');
          fs.rmSync(tmpDir, { recursive: true, force: true });
          process.exit(0);
        }

        if (installDeps) {
          if (npmDeps.length > 0) {
            const installSpinner = ora(
              'Installing npm dependencies...',
            ).start();
            try {
              const pm = detectPackageManager();
              const installCmd = pm === 'npm' ? 'install' : 'add';
              await execAsync(`${pm} ${installCmd} ${npmDeps.join(' ')}`);
              installSpinner.succeed('npm dependencies installed.');
            } catch (err) {
              installSpinner.fail('Failed to install npm dependencies.');
              console.error(err.message);
            }
          }

          if (lpmDeps.length > 0) {
            console.log(chalk.dim('\nTo install LPM dependencies, run:'));
            for (const dep of lpmDeps) {
              console.log(chalk.cyan(`  lpm install ${dep}`));
            }
          }
        }

        spinner.start();
      }
    } else {
      // Legacy: dependencies from package.json
      const dependencies = pkgJson.dependencies || {};
      const peerDependencies = pkgJson.peerDependencies || {};
      const allDeps = { ...dependencies, ...peerDependencies };

      const depNames = Object.keys(allDeps);

      if (depNames.length > 0) {
        spinner.stop();
        console.log(
          chalk.blue(
            `\nComponent requires dependencies: ${depNames.join(', ')}`,
          ),
        );

        const installDeps = await p.confirm({
          message: 'Install these dependencies now?',
          initialValue: true,
        });

        if (p.isCancel(installDeps)) {
          p.cancel('Operation cancelled.');
          fs.rmSync(tmpDir, { recursive: true, force: true });
          process.exit(0);
        }

        if (installDeps) {
          const installSpinner = ora('Installing dependencies...').start();
          try {
            const pm = detectPackageManager();
            const installCmd = pm === 'npm' ? 'install' : 'add';
            const depsString = depNames
              .map(d => `${d}@${allDeps[d]}`)
              .join(' ');

            await execAsync(`${pm} ${installCmd} ${depsString}`);
            installSpinner.succeed('Dependencies installed.');
          } catch (err) {
            installSpinner.fail('Failed to install dependencies.');
            console.error(err.message);
          }
        }

        spinner.start();
      }
    }

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Show config summary if applicable
    if (configuredFiles && Object.keys(mergedConfig).length > 0) {
      const configSummary = Object.entries(mergedConfig)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      spinner.succeed(
        `Successfully added ${chalk.green(name)} to ${chalk.dim(targetDir)}\n  ${chalk.dim(`Config: ${configSummary}`)}`,
      );
    } else {
      spinner.succeed(
        `Successfully added ${chalk.green(name)} to ${chalk.dim(targetDir)}`,
      );
    }
  } catch (error) {
    spinner.fail(`Failed to add package: ${error.message}`);
    if (process.env.DEBUG) console.error(error);
  }
}

/**
 * Copy a single file with conflict handling.
 *
 * @param {string} src - Source file path
 * @param {string} dest - Destination file path
 * @param {string | undefined} srcContent - Pre-read source content (undefined for binary)
 * @param {object} options - Command options (force flag)
 */
async function smartCopyFile(src, dest, srcContent, options) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(dest)) {
    let destContent;
    try {
      destContent = fs.readFileSync(dest, 'utf-8');
    } catch (_e) {
      // Binary
    }

    // Binary files
    if (srcContent === undefined || destContent === undefined) {
      fs.copyFileSync(src, dest);
      return;
    }

    if (srcContent !== destContent) {
      if (options.force) {
        fs.writeFileSync(dest, srcContent);
        console.log(chalk.green(`Overwrote ${path.basename(dest)}`));
        return;
      }

      let action = 'diff';
      while (action === 'diff') {
        const answer = await p.select({
          message: `Conflict in ${chalk.bold(path.basename(dest))}. What do you want to do?`,
          options: [
            { value: 'overwrite', label: 'Overwrite' },
            { value: 'skip', label: 'Skip' },
            { value: 'diff', label: 'Show Diff' },
          ],
        });

        if (p.isCancel(answer)) {
          p.cancel('Operation cancelled.');
          process.exit(0);
        }

        action = answer;

        if (action === 'diff') {
          const diff = Diff.diffLines(destContent, srcContent);
          for (const part of diff) {
            const color = part.added ? 'green' : part.removed ? 'red' : 'grey';
            process.stdout.write(chalk[color](part.value));
          }
          console.log('\n');
        } else if (action === 'overwrite') {
          fs.writeFileSync(dest, srcContent);
          console.log(chalk.green(`Overwrote ${path.basename(dest)}`));
        } else {
          console.log(chalk.yellow(`Skipped ${path.basename(dest)}`));
        }
      }
    }
    // Identical: skip silently
  } else {
    if (srcContent !== undefined) {
      fs.writeFileSync(dest, srcContent);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

/**
 * Detect the package manager used in the current project.
 *
 * @returns {string} Package manager name (npm, pnpm, yarn, bun)
 */
function detectPackageManager() {
  if (fs.existsSync('pnpm-lock.yaml')) return 'pnpm';
  if (fs.existsSync('yarn.lock')) return 'yarn';
  if (fs.existsSync('bun.lockb')) return 'bun';
  return 'npm';
}
