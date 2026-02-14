import { request } from '../api.js';
import { getRegistryUrl } from '../config.js';
import { log, printHeader } from '../ui.js';

export async function whoami() {
  printHeader();
  try {
    const response = await request('/-/whoami');

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();
    log.success(`Logged in as: ${data.username}`);

    if (data.plan_tier) {
      console.log(''); // Spacer
      log.info(`Plan: ${data.plan_tier.toUpperCase()}`);

      // Pool subscription status
      if (data.has_pool_access) {
        log.success('Pool: Active');
      } else {
        log.info('Pool: Not subscribed');
      }

      if (data.usage) {
        const storageMB = (data.usage.storage_bytes / (1024 * 1024)).toFixed(2);
        const limits = data.limits || {};

        // Storage Check - backend returns storageBytes (not storage_gb)
        if (limits.storageBytes) {
          const limitMB = (limits.storageBytes / (1024 * 1024)).toFixed(0);
          const storageMsg = `Storage Used: ${storageMB}MB / ${limitMB}MB`;
          if (data.usage.storage_bytes > limits.storageBytes) {
            log.error(`${storageMsg} (OVER LIMIT)`);
          } else {
            log.info(storageMsg);
          }
        } else {
          log.info(`Storage Used: ${storageMB}MB`);
        }

        // Package Count Check - backend returns privatePackages (not private_packages)
        if (limits.privatePackages !== undefined) {
          if (
            limits.privatePackages === Number.POSITIVE_INFINITY ||
            limits.privatePackages === null
          ) {
            log.info(
              `Private Packages: ${data.usage.private_packages} (Unlimited)`,
            );
          } else {
            const pkgMsg = `Private Packages: ${data.usage.private_packages} / ${limits.privatePackages}`;
            if (data.usage.private_packages > limits.privatePackages) {
              log.error(`${pkgMsg} (OVER LIMIT)`);
            } else {
              log.info(pkgMsg);
            }
          }
        } else {
          log.info(`Private Packages: ${data.usage.private_packages}`);
        }

        // Over limit warning
        const overStorage =
          limits.storageBytes && data.usage.storage_bytes > limits.storageBytes;
        const overPackages =
          limits.privatePackages &&
          limits.privatePackages !== Number.POSITIVE_INFINITY &&
          limits.privatePackages !== null &&
          data.usage.private_packages > limits.privatePackages;

        if (overStorage || overPackages) {
          const registryUrl = getRegistryUrl();
          console.log('');
          log.warn('Your account is over its plan limits.');
          log.warn(
            'Write access (publishing, inviting members) is restricted.',
          );
          log.warn(
            `Upgrade your plan: ${registryUrl}/dashboard/settings/billing`,
          );
        }
      }
    }

    // Display available scopes for publishing
    const registryUrl = getRegistryUrl();
    console.log('');
    log.info('Available Scopes:');

    // Personal scope
    if (data.profile_username) {
      log.info(`  Personal: @lpm.dev/${data.profile_username}.*`);
    } else {
      log.warn(`  Personal: Not set (${registryUrl}/dashboard/settings)`);
    }

    // Organization scopes
    if (data.organizations?.length > 0) {
      log.info('  Organizations:');
      for (const org of data.organizations) {
        log.info(`    @lpm.dev/${org.slug}.* (${org.role})`);
      }
    }
  } catch (error) {
    log.error(`Error: ${error.message}`);
  }
}
