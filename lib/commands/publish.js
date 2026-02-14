import { exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import * as p from '@clack/prompts';
import { request, verifyTokenScope } from '../api.js';
import { getRegistryUrl } from '../config.js';
import { SUCCESS_MESSAGES, WARNING_MESSAGES } from '../constants.js';
import { generateIntegrity } from '../integrity.js';
import { displayQualityReport } from '../quality/display.js';
import { runQualityChecks } from '../quality/score.js';
import { createSpinner, log, printHeader } from '../ui.js';

const execAsync = promisify(exec);
const readFileAsync = promisify(fs.readFile);

/**
 * Parse package name in the @lpm.dev/owner.package format
 * @returns {{ owner: string, pkgName: string } | { error: string }}
 */
function parsePackageName(name) {
  // New format: @lpm.dev/owner.package-name
  if (name.startsWith('@lpm.dev/')) {
    const nameWithOwner = name.replace('@lpm.dev/', '');
    const dotIndex = nameWithOwner.indexOf('.');
    if (dotIndex === -1) {
      return { error: 'Invalid format. Expected @lpm.dev/owner.package-name' };
    }
    return {
      owner: nameWithOwner.substring(0, dotIndex),
      pkgName: nameWithOwner.substring(dotIndex + 1),
    };
  }

  // Legacy format: @scope/package-name
  if (name.startsWith('@')) {
    const match = name.match(/^@([^/]+)\/(.+)$/);
    if (match) {
      return {
        owner: match[1],
        pkgName: match[2],
        isLegacy: true,
      };
    }
  }

  return {
    error: 'Invalid package name. Use @lpm.dev/owner.package-name format',
  };
}

export async function publish(options = {}) {
  const checkOnly = !!options.check;
  const minScore = options.minScore ? parseInt(options.minScore, 10) : null;

  printHeader();

  // 1. Read package.json first (before spinner, for confirmation)
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    log.error('No package.json found in current directory.');
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const { name, version } = pkg;

  // --check mode: skip confirmation prompt
  if (!checkOnly) {
    // 2. Confirmation prompt
    const shouldPublish = await p.confirm({
      message: `Publish ${name}@${version}?`,
      initialValue: true,
    });

    if (p.isCancel(shouldPublish) || !shouldPublish) {
      p.cancel('Publish cancelled.');
      process.exit(0);
    }
  }

  // Parse package name to extract owner
  const parsed = parsePackageName(name);
  if (parsed.error) {
    log.error(parsed.error);
    log.info('LPM packages must use format: @lpm.dev/owner.package-name');
    log.info(`Your current name: ${name}`);

    // Suggest fix for legacy format
    const oldMatch = name.match(/^@([^/]+)\/(.+)$/);
    if (oldMatch) {
      const suggested = `@lpm.dev/${oldMatch[1]}.${oldMatch[2]}`;
      log.info(`Suggested: ${suggested}`);
    }
    process.exit(1);
  }

  const { owner, pkgName: packageName, isLegacy } = parsed;

  // Warn about legacy format
  if (isLegacy) {
    log.warn(`Legacy format detected: ${name}`);
    log.warn(`Please migrate to: @lpm.dev/${owner}.${packageName}`);
    console.log('');
  }

  const spinner = createSpinner(
    checkOnly ? 'Running quality checks...' : 'Preparing to publish...',
  ).start();

  // Track tarball path for cleanup in finally block
  let tarballPath = null;
  // Hoist whoami for success message
  let whoami = null;

  try {
    // Skip auth and owner checks in --check mode
    if (!checkOnly) {
      // 3. Verify token has publish scope
      spinner.text = 'Verifying authentication...';
      const scopeResult = await verifyTokenScope('publish');

      if (!scopeResult.valid) {
        throw new Error(scopeResult.error);
      }

      spinner.text = `Publishing ${name}@${version}...`;

      // 4. Validate package owner against user's available owners
      spinner.text = 'Checking owner permissions...';

      const whoamiResponse = await request('/-/whoami');
      if (whoamiResponse.ok) {
        whoami = await whoamiResponse.json();

        // Build list of available owners (username + org slugs)
        const availableOwners = [];
        if (whoami.profile_username) {
          availableOwners.push(whoami.profile_username);
        }
        whoami.organizations?.forEach(org => {
          availableOwners.push(org.slug);
        });

        if (!availableOwners.includes(owner)) {
          // Owner doesn't match - block the publish
          spinner.stop();
          const registryUrl = getRegistryUrl();

          log.error(
            `You don't have permission to publish under "@lpm.dev/${owner}".`,
          );
          console.log('');

          if (!whoami.profile_username) {
            log.warn(WARNING_MESSAGES.usernameNotSet);
            log.warn(`  Set it at: ${registryUrl}/dashboard/settings`);
            console.log('');
          }

          if (whoami.organizations?.length > 0) {
            log.info('Your available owners:');
            if (whoami.profile_username) {
              log.info(`  @lpm.dev/${whoami.profile_username}.* (personal)`);
            }
            for (const org of whoami.organizations) {
              log.info(`  @lpm.dev/${org.slug}.* (organization)`);
            }
          } else {
            log.warn(WARNING_MESSAGES.noOrganizations);
            log.warn(WARNING_MESSAGES.createOrgHint(registryUrl));
          }

          console.log('');
          log.info(WARNING_MESSAGES.ownerFixHint);
          process.exit(1);
        }
      }
    }

    // 3. Create tarball using npm pack
    // npm pack returns the filename and metadata about the tarball
    spinner.text = 'Packing tarball...';
    const { stdout } = await execAsync('npm pack --json');
    const packResult = JSON.parse(stdout);
    const packInfo = packResult[0];
    const tarballFilename = packInfo.filename;
    // Store tarballPath for cleanup in finally block
    tarballPath = path.resolve(process.cwd(), tarballFilename);

    // Extract metadata from npm pack output
    const npmPackMeta = {
      unpackedSize: packInfo.unpackedSize,
      fileCount: packInfo.files?.length || 0,
      files: packInfo.files || [],
    };

    // 4.5. Read README with security validation
    spinner.text = 'Reading README...';
    let readme = null;
    const readmeFilenames = [
      'README.md',
      'readme.md',
      'README',
      'Readme.md',
      'README.txt',
    ];

    for (const filename of readmeFilenames) {
      const readmePath = path.resolve(process.cwd(), filename);

      // Security: Ensure file is in current directory (prevent path traversal)
      if (!readmePath.startsWith(process.cwd())) {
        continue;
      }

      if (fs.existsSync(readmePath)) {
        try {
          const stats = fs.statSync(readmePath);

          // Security: Limit README size to 1MB
          const MAX_README_SIZE = 1024 * 1024; // 1MB
          if (stats.size > MAX_README_SIZE) {
            log.warn(
              `README file is too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Maximum size is 1MB. Skipping README.`,
            );
            break;
          }

          const readmeBuffer = fs.readFileSync(readmePath);

          // Security: Check for binary content (README should be text)
          const isBinary = readmeBuffer.some(
            byte =>
              byte === 0 ||
              (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13),
          );
          if (isBinary) {
            log.warn('README appears to be binary. Skipping.');
            break;
          }

          // Convert to UTF-8 string and trim
          readme = readmeBuffer.toString('utf8').trim();

          // Security: Final size check after conversion
          if (readme.length > MAX_README_SIZE) {
            readme = readme.substring(0, MAX_README_SIZE);
            log.warn('README truncated to 1MB.');
          }

          break; // Found valid README
        } catch (_err) {}
      }
    }

    // 4.6. Read lpm.config.json if present
    let lpmConfig = null;
    const lpmConfigPath = path.resolve(process.cwd(), 'lpm.config.json');
    if (fs.existsSync(lpmConfigPath)) {
      try {
        const lpmConfigRaw = fs.readFileSync(lpmConfigPath, 'utf-8');
        lpmConfig = JSON.parse(lpmConfigRaw);
      } catch (_err) {
        log.warn('Could not parse lpm.config.json. Skipping.');
      }
    }

    // 4.7. Run quality checks
    spinner.text = 'Running quality checks...';
    const qualityResult = runQualityChecks({
      packageJson: pkg,
      readme,
      lpmConfig,
      files: packInfo.files || [],
      unpackedSize: packInfo.unpackedSize,
    });

    spinner.stop();
    displayQualityReport(qualityResult);

    // --check mode: display report and exit
    if (checkOnly) {
      if (minScore && qualityResult.score < minScore) {
        log.error(
          `Quality score ${qualityResult.score} is below minimum ${minScore}.`,
        );
        process.exit(1);
      }
      process.exit(0);
    }

    // --min-score gate: block publish if score is too low
    if (minScore && qualityResult.score < minScore) {
      log.error(
        `Quality score ${qualityResult.score} is below minimum ${minScore}. Publish blocked.`,
      );
      log.info('Run "lpm publish --check" to see improvement suggestions.');
      process.exit(1);
    }

    // 4. Read tarball and generate integrity hashes
    spinner.text = 'Reading tarball...';
    spinner.start();
    const tarballData = await readFileAsync(tarballPath);
    const tarballBase64 = tarballData.toString('base64');
    const shasum = createHash('sha1').update(tarballData).digest('hex');
    const integrity = generateIntegrity(tarballData, 'sha512');

    // 5. Construct payload (NPM Registry format)
    spinner.text = 'Uploading to registry...';
    const payload = {
      _id: name,
      name: name,
      description: pkg.description,
      'dist-tags': {
        latest: version,
      },
      versions: {
        [version]: {
          ...pkg,
          _id: `${name}@${version}`,
          name: name,
          version: version,
          readme: readme,
          dist: {
            shasum: shasum,
            integrity: integrity,
            tarball: `${getRegistryUrl()}/api/registry/${name}/-/${name}-${version}.tgz`,
          },
          // Include npm pack metadata for the API to process
          _npmPackMeta: npmPackMeta,
          // Include lpm config for source package detection
          ...(lpmConfig && { _lpmConfig: lpmConfig }),
          // Include quality check results
          _qualityChecks: qualityResult.checks,
          _qualityMeta: qualityResult.meta,
        },
      },
      _attachments: {
        [`${name}-${version}.tgz`]: {
          content_type: 'application/octet-stream',
          data: tarballBase64,
          length: tarballData.length,
        },
      },
    };

    // 6. Send PUT request
    const response = await request(`/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
      },
      onRetry: (attempt, max) => {
        spinner.text = `Uploading to registry (retry ${attempt}/${max})...`;
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Publish failed: ${response.status} ${errorText}`);
    }

    // Success message with dashboard link
    const registryUrl = getRegistryUrl();
    const isOrgOwner = whoami?.organizations?.some(org => org.slug === owner);

    if (isOrgOwner) {
      spinner.succeed(
        SUCCESS_MESSAGES.publishOrg(registryUrl, owner, packageName, version),
      );
    } else {
      spinner.succeed(
        SUCCESS_MESSAGES.publishPersonal(
          registryUrl,
          owner,
          packageName,
          version,
        ),
      );
    }
  } catch (error) {
    spinner.fail(`Publish error: ${error.message}`);

    // Show upgrade link for personal account limit errors
    const registryUrl = getRegistryUrl();
    const isLimitError =
      error.message.includes('limit exceeded') ||
      error.message.includes('Upgrade to Pro');

    if (isLimitError) {
      // Only show upgrade link for personal accounts (orgs have overage billing)
      const isOrgOwner = whoami?.organizations?.some(org => org.slug === owner);
      if (!isOrgOwner) {
        console.log('');
        log.info(`Upgrade plan: ${registryUrl}/dashboard/settings/billing`);
      }
    }

    process.exit(1);
  } finally {
    // Cleanup tarball (even on error)
    if (tarballPath && fs.existsSync(tarballPath)) {
      try {
        fs.unlinkSync(tarballPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
