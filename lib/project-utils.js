import fs from 'node:fs';
import path from 'node:path';

export function detectFramework() {
  const cwd = process.cwd();
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return 'unknown';

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps.next) {
      if (fs.existsSync(path.join(cwd, 'app'))) return 'next-app';
      return 'next-pages';
    }
    if (deps['@remix-run/react']) return 'remix';
    if (deps.vite) return 'vite';
  } catch (_e) {
    return 'unknown';
  }
  return 'unknown';
}

export function getDefaultPath(framework, pkgBaseName) {
  switch (framework) {
    case 'next-app':
      // App Router often puts components in root components/ or app/components/
      // Let's default to components/ if it exists, else src/components/
      if (fs.existsSync(path.join(process.cwd(), 'components'))) {
        return `components/${pkgBaseName}`;
      }
      return `src/components/${pkgBaseName}`;
    case 'next-pages':
    case 'vite':
    case 'remix':
      return `src/components/${pkgBaseName}`;
    default:
      return `src/components/${pkgBaseName}`;
  }
}

export function getProjectAliases() {
  const cwd = process.cwd();
  const tsConfigPath = path.join(cwd, 'tsconfig.json');
  const jsConfigPath = path.join(cwd, 'jsconfig.json');

  let configPath;
  if (fs.existsSync(tsConfigPath)) configPath = tsConfigPath;
  else if (fs.existsSync(jsConfigPath)) configPath = jsConfigPath;

  if (!configPath) return {};

  try {
    // Simple JSON parse (might fail with comments)
    const content = fs.readFileSync(configPath, 'utf-8');
    // Basic comment stripping
    const jsonContent = content.replace(
      /\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm,
      '$1',
    );
    const config = JSON.parse(jsonContent);
    return config.compilerOptions?.paths || {};
  } catch (_e) {
    return {};
  }
}

export function getUserImportPrefix() {
  const aliases = getProjectAliases();
  // Look for an alias that points to ./src or ./
  for (const [alias, paths] of Object.entries(aliases)) {
    if (
      Array.isArray(paths) &&
      paths.some(p => p.startsWith('./src') || p.startsWith('src'))
    ) {
      return alias.replace('/*', '');
    }
  }
  return '@'; // Default fallback
}

/**
 * Resolve the import alias that maps to a given directory.
 *
 * Given a target directory like "src/components/design-system" and aliases
 * like { "@/*": ["./src/*"] }, returns "@/components/design-system".
 *
 * @param {string} targetDirRelative - Target directory relative to project root
 * @param {Record<string, string[]>} aliases - Parsed tsconfig/jsconfig paths
 * @returns {string | null} The resolved alias path, or null if no alias covers this directory
 */
export function resolveAliasForDirectory(targetDirRelative, aliases) {
  const normalized = targetDirRelative
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');

  for (const [aliasPattern, aliasPaths] of Object.entries(aliases)) {
    if (!aliasPattern.endsWith('/*')) continue;
    if (!Array.isArray(aliasPaths)) continue;

    const aliasPrefix = aliasPattern.slice(0, -2); // "@/*" → "@"

    for (const aliasPath of aliasPaths) {
      const mappedDir = aliasPath
        .replace(/^\.\//, '')
        .replace(/\/\*$/, '')
        .replace(/\/$/, '');

      if (normalized.startsWith(mappedDir + '/')) {
        const remainder = normalized.slice(mappedDir.length + 1);
        return `${aliasPrefix}/${remainder}`;
      }
      if (normalized === mappedDir) {
        return aliasPrefix;
      }
    }
  }

  return null;
}
