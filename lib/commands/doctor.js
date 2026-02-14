import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { getRegistryUrl, getToken } from '../config.js';
import { createSpinner, log, printHeader } from '../ui.js';

export async function doctor() {
  printHeader();
  log.info('Running health checks...\n');

  const checks = [];

  // 1. Check Auth
  const spinnerAuth = createSpinner('Checking authentication...').start();
  const token = await getToken();
  if (token) {
    spinnerAuth.succeed('Authentication token found.');
    checks.push({ name: 'Auth Token', status: 'ok' });
  } else {
    spinnerAuth.fail('No authentication token found. Run `lpm login`.');
    checks.push({ name: 'Auth Token', status: 'fail' });
  }

  // 2. Check Registry Reachability
  const spinnerApi = createSpinner('Checking registry connection...').start();
  try {
    // Assuming we have a health endpoint or similar. Using the registry URL from config or default.
    const registryUrl = getRegistryUrl();
    const res = await fetch(`${registryUrl}/api/registry/health`);
    if (res.ok) {
      spinnerApi.succeed(`Registry reachable at ${registryUrl}`);
      checks.push({ name: 'Registry API', status: 'ok' });
    } else {
      spinnerApi.fail(`Registry returned status ${res.status}`);
      checks.push({ name: 'Registry API', status: 'fail' });
    }
  } catch (err) {
    spinnerApi.fail(`Could not connect to registry: ${err.message}`);
    checks.push({ name: 'Registry API', status: 'fail' });
  }

  // 3. Check Quota (via whoami)
  if (token) {
    const spinnerQuota = createSpinner('Checking account quota...').start();
    try {
      // We can reuse the whoami logic or fetch directly
      // Since we are in doctor, let's fetch directly using the token
      const registryUrl = getRegistryUrl();
      const res = await fetch(`${registryUrl}/api/registry/-/whoami`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.plan_tier) {
          const limits = data.limits || {};
          let isOverLimit = false;
          const statusMsg = `Plan: ${data.plan_tier.toUpperCase()}`;

          if (limits.storageBytes) {
            if (data.usage.storage_bytes > limits.storageBytes)
              isOverLimit = true;
          }
          if (
            limits.privatePackages &&
            limits.privatePackages !== Number.POSITIVE_INFINITY &&
            limits.privatePackages !== null
          ) {
            if (data.usage.private_packages > limits.privatePackages)
              isOverLimit = true;
          }

          if (isOverLimit) {
            spinnerQuota.fail(`${statusMsg} | OVER LIMIT`);
            checks.push({ name: 'Account Quota', status: 'fail' });
          } else {
            spinnerQuota.succeed(
              `${statusMsg} | Storage: ${(data.usage.storage_bytes / 1024 / 1024).toFixed(0)}MB`,
            );
            checks.push({ name: 'Account Quota', status: 'ok' });
          }
        } else {
          spinnerQuota.info('Could not retrieve detailed quota info.');
          checks.push({ name: 'Account Quota', status: 'info' });
        }
      } else {
        spinnerQuota.warn('Could not fetch account details.');
        checks.push({ name: 'Account Quota', status: 'warn' });
      }
    } catch (err) {
      spinnerQuota.warn(`Quota check failed: ${err.message}`);
      checks.push({ name: 'Account Quota', status: 'warn' });
    }
  }

  // 4. Check .npmrc
  const spinnerNpmrc = createSpinner(
    'Checking .npmrc configuration...',
  ).start();
  const npmrcPath = path.join(process.cwd(), '.npmrc');
  if (fs.existsSync(npmrcPath)) {
    const content = fs.readFileSync(npmrcPath, 'utf-8');
    if (content.includes('registry=')) {
      spinnerNpmrc.succeed('.npmrc found and configured.');
      checks.push({ name: '.npmrc', status: 'ok' });
    } else {
      spinnerNpmrc.warn('.npmrc found but might be missing registry config.');
      checks.push({ name: '.npmrc', status: 'warn' });
    }
  } else {
    spinnerNpmrc.info('No local .npmrc found (global config might be used).');
    checks.push({ name: '.npmrc', status: 'info' });
  }

  console.log('\nSummary:');
  checks.forEach(c => {
    const symbol =
      c.status === 'ok'
        ? '✔'
        : c.status === 'fail'
          ? '✖'
          : c.status === 'warn'
            ? '⚠'
            : 'ℹ';
    const color =
      c.status === 'ok'
        ? chalk.green
        : c.status === 'fail'
          ? chalk.red
          : c.status === 'warn'
            ? chalk.yellow
            : chalk.blue;
    console.log(color(`${symbol} ${c.name}`));
  });

  if (checks.some(c => c.status === 'fail')) {
    console.log(
      chalk.red('\nSome checks failed. Please fix the issues above.'),
    );
    process.exit(1);
  } else {
    console.log(chalk.green('\nAll systems operational.'));
  }
}
