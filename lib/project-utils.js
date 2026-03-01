import fs from 'node:fs';
import path from 'node:path';

/**
 * Detect the consumer project type.
 * Returns a framework string for JS projects, or a Swift project type.
 * Priority: Package.swift → .xcodeproj → .xcworkspace → JS frameworks → unknown
 */
export function detectFramework() {
  const cwd = process.cwd();

  // Check for Swift projects first
  if (fs.existsSync(path.join(cwd, 'Package.swift'))) return 'swift-spm';

  // Check for Xcode projects (without Package.swift = app project)
  const entries = fs.readdirSync(cwd);
  if (entries.some(e => e.endsWith('.xcodeproj'))) return 'swift-xcode';
  if (entries.some(e => e.endsWith('.xcworkspace'))) return 'swift-xcode';

  // JS frameworks
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

/**
 * Check if the detected framework is a Swift project.
 * @param {string} framework
 * @returns {boolean}
 */
export function isSwiftProject(framework) {
  return framework === 'swift-spm' || framework === 'swift-xcode';
}

export function getDefaultPath(framework, swiftTarget) {
  switch (framework) {
    case 'swift-spm':
      return swiftTarget ? `Sources/${swiftTarget}` : 'Sources';
    case 'swift-xcode':
      return 'Packages/LPMComponents/Sources/LPMComponents';
    case 'next-app':
      if (fs.existsSync(path.join(process.cwd(), 'components'))) {
        return 'components';
      }
      return 'src/components';
    case 'next-pages':
    case 'vite':
    case 'remix':
      return 'src/components';
    default:
      return 'components';
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
