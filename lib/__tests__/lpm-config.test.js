import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyTemplateVariables,
  evaluateCondition,
  expandSrcGlob,
  filterFiles,
  parseLpmPackageReference,
  readLpmConfig,
  resolveConditionalDependencies,
  resolveVariants,
  validateLpmConfig,
} from '../lpm-config.js';

// ============================================================================
// parseLpmPackageReference
// ============================================================================

describe('parseLpmPackageReference', () => {
  it('parses a simple package name with no version or params', () => {
    const result = parseLpmPackageReference('@lpm.dev/owner.pkg');
    expect(result.name).toBe('@lpm.dev/owner.pkg');
    expect(result.version).toBe('latest');
    expect(result.inlineConfig).toEqual({});
    expect(result.providedParams.size).toBe(0);
  });

  it('parses a package name with version', () => {
    const result = parseLpmPackageReference('@lpm.dev/owner.pkg@2.0.0');
    expect(result.name).toBe('@lpm.dev/owner.pkg');
    expect(result.version).toBe('2.0.0');
    expect(result.inlineConfig).toEqual({});
    expect(result.providedParams.size).toBe(0);
  });

  it('parses a package name with query params', () => {
    const result = parseLpmPackageReference(
      '@lpm.dev/owner.pkg?component=dialog',
    );
    expect(result.name).toBe('@lpm.dev/owner.pkg');
    expect(result.version).toBe('latest');
    expect(result.inlineConfig).toEqual({ component: 'dialog' });
    expect(result.providedParams.has('component')).toBe(true);
    expect(result.providedParams.size).toBe(1);
  });

  it('parses version and query params together', () => {
    const result = parseLpmPackageReference(
      '@lpm.dev/owner.pkg@1.0.0?component=dialog,button&styling=panda',
    );
    expect(result.name).toBe('@lpm.dev/owner.pkg');
    expect(result.version).toBe('1.0.0');
    expect(result.inlineConfig).toEqual({
      component: 'dialog,button',
      styling: 'panda',
    });
    expect(result.providedParams.has('component')).toBe(true);
    expect(result.providedParams.has('styling')).toBe(true);
  });

  it('preserves comma-separated values as strings', () => {
    const result = parseLpmPackageReference(
      '@lpm.dev/owner.pkg?component=dialog,button,tabs',
    );
    expect(result.inlineConfig.component).toBe('dialog,button,tabs');
  });

  it('tracks only provided params, not missing ones', () => {
    const result = parseLpmPackageReference('@lpm.dev/owner.pkg?styling=panda');
    expect(result.providedParams.has('styling')).toBe(true);
    expect(result.providedParams.has('component')).toBe(false);
  });

  it('handles multiple query params', () => {
    const result = parseLpmPackageReference(
      '@lpm.dev/owner.pkg?styling=panda&baseColor=orange&radius=md',
    );
    expect(result.inlineConfig).toEqual({
      styling: 'panda',
      baseColor: 'orange',
      radius: 'md',
    });
    expect(result.providedParams.size).toBe(3);
  });
});

// ============================================================================
// evaluateCondition
// ============================================================================

describe('evaluateCondition', () => {
  it('returns true for include: "always"', () => {
    const result = evaluateCondition({ include: 'always' }, {}, new Set());
    expect(result).toBe(true);
  });

  it('returns true when include is missing (defaults to always)', () => {
    const result = evaluateCondition({ src: 'file.js' }, {}, new Set());
    expect(result).toBe(true);
  });

  it('returns false for include: "never"', () => {
    const result = evaluateCondition({ include: 'never' }, {}, new Set());
    expect(result).toBe(false);
  });

  it('returns true when condition param is NOT in providedParams (include all by default)', () => {
    const result = evaluateCondition(
      { include: 'when', condition: { component: 'dialog' } },
      { component: 'button' }, // default value, doesn't matter
      new Set(), // component NOT provided
    );
    expect(result).toBe(true);
  });

  it('returns true when condition param is provided and matches exactly', () => {
    const result = evaluateCondition(
      { include: 'when', condition: { component: 'dialog' } },
      { component: 'dialog' },
      new Set(['component']),
    );
    expect(result).toBe(true);
  });

  it('returns false when condition param is provided and does not match', () => {
    const result = evaluateCondition(
      { include: 'when', condition: { component: 'dialog' } },
      { component: 'button' },
      new Set(['component']),
    );
    expect(result).toBe(false);
  });

  it('returns true when comma-separated config value contains the condition value', () => {
    const result = evaluateCondition(
      { include: 'when', condition: { component: 'dialog' } },
      { component: 'dialog,button' },
      new Set(['component']),
    );
    expect(result).toBe(true);
  });

  it('returns false when comma-separated config value does not contain the condition value', () => {
    const result = evaluateCondition(
      { include: 'when', condition: { component: 'tooltip' } },
      { component: 'dialog,button' },
      new Set(['component']),
    );
    expect(result).toBe(false);
  });

  it('handles multi-key conditions with AND logic (all match)', () => {
    const result = evaluateCondition(
      {
        include: 'when',
        condition: { component: 'dialog', styling: 'panda' },
      },
      { component: 'dialog', styling: 'panda' },
      new Set(['component', 'styling']),
    );
    expect(result).toBe(true);
  });

  it('returns true when one key in multi-key condition is not in providedParams', () => {
    const result = evaluateCondition(
      {
        include: 'when',
        condition: { component: 'dialog', styling: 'panda' },
      },
      { component: 'dialog', styling: 'tailwind' },
      new Set(['component']), // styling NOT provided, so its check is skipped
    );
    expect(result).toBe(true);
  });

  it('returns false when one key in multi-key condition fails', () => {
    const result = evaluateCondition(
      {
        include: 'when',
        condition: { component: 'dialog', styling: 'panda' },
      },
      { component: 'button', styling: 'panda' },
      new Set(['component', 'styling']),
    );
    expect(result).toBe(false);
  });

  it('handles boolean condition values', () => {
    expect(
      evaluateCondition(
        { include: 'when', condition: { darkMode: 'true' } },
        { darkMode: 'true' },
        new Set(['darkMode']),
      ),
    ).toBe(true);

    expect(
      evaluateCondition(
        { include: 'when', condition: { darkMode: 'true' } },
        { darkMode: 'false' },
        new Set(['darkMode']),
      ),
    ).toBe(false);
  });

  it('coerces condition values to strings for comparison', () => {
    const result = evaluateCondition(
      { include: 'when', condition: { darkMode: true } },
      { darkMode: 'true' },
      new Set(['darkMode']),
    );
    expect(result).toBe(true);
  });
});

// ============================================================================
// filterFiles
// ============================================================================

describe('filterFiles', () => {
  const files = [
    { src: 'utils.js', include: 'always' },
    { src: 'internal.js', include: 'never' },
    {
      src: 'dialog.jsx',
      include: 'when',
      condition: { component: 'dialog' },
    },
    {
      src: 'button.jsx',
      include: 'when',
      condition: { component: 'button' },
    },
    {
      src: 'tabs.jsx',
      include: 'when',
      condition: { component: 'tabs' },
    },
  ];

  it("includes all 'when' files when no params are provided (include all by default)", () => {
    const result = filterFiles(files, {}, new Set());
    expect(result).toHaveLength(4); // always + 3 when (all included), never excluded
    expect(result.map(f => f.src)).toEqual([
      'utils.js',
      'dialog.jsx',
      'button.jsx',
      'tabs.jsx',
    ]);
  });

  it('filters to only matching files when param is provided', () => {
    const result = filterFiles(
      files,
      { component: 'dialog' },
      new Set(['component']),
    );
    expect(result).toHaveLength(2); // always + dialog
    expect(result.map(f => f.src)).toEqual(['utils.js', 'dialog.jsx']);
  });

  it('handles comma-separated values for multi-select', () => {
    const result = filterFiles(
      files,
      { component: 'dialog,button' },
      new Set(['component']),
    );
    expect(result).toHaveLength(3); // always + dialog + button
    expect(result.map(f => f.src)).toEqual([
      'utils.js',
      'dialog.jsx',
      'button.jsx',
    ]);
  });

  it("always excludes 'never' files", () => {
    const result = filterFiles(files, {}, new Set());
    expect(result.find(f => f.src === 'internal.js')).toBeUndefined();
  });
});

// ============================================================================
// applyTemplateVariables
// ============================================================================

describe('applyTemplateVariables', () => {
  it('replaces a single template variable', () => {
    const result = applyTemplateVariables('color: {{baseColor}}', {
      baseColor: 'neutral',
    });
    expect(result).toBe('color: neutral');
  });

  it('replaces multiple template variables in one string', () => {
    const result = applyTemplateVariables(
      'bg: {{baseColor}}.500, radius: {{radius}}',
      { baseColor: 'neutral', radius: 'md' },
    );
    expect(result).toBe('bg: neutral.500, radius: md');
  });

  it('leaves unmatched variables as-is', () => {
    const result = applyTemplateVariables('font: {{unknown}}', {
      baseColor: 'neutral',
    });
    expect(result).toBe('font: {{unknown}}');
  });

  it('returns content unchanged when no template vars are present', () => {
    const content = 'const x = 42';
    const result = applyTemplateVariables(content, { baseColor: 'neutral' });
    expect(result).toBe(content);
  });

  it('does not match single braces', () => {
    const result = applyTemplateVariables('{single}', { single: 'nope' });
    expect(result).toBe('{single}');
  });

  it('matches double braces inside triple braces (regex behavior)', () => {
    // {{{triple}}} contains {{triple}} which IS a valid match
    const result = applyTemplateVariables('{{{triple}}}', {
      triple: 'replaced',
    });
    expect(result).toBe('{replaced}');
  });

  it('converts non-string config values to strings', () => {
    const result = applyTemplateVariables('enabled: {{darkMode}}', {
      darkMode: true,
    });
    expect(result).toBe('enabled: true');
  });
});

// ============================================================================
// validateLpmConfig
// ============================================================================

describe('validateLpmConfig', () => {
  it('returns no errors for a valid config', () => {
    const errors = validateLpmConfig({
      configSchema: {
        component: {
          type: 'select',
          options: [
            { value: 'dialog', label: 'Dialog' },
            { value: 'button', label: 'Button' },
          ],
        },
        darkMode: {
          type: 'boolean',
        },
      },
      files: [
        { src: 'dialog.jsx', dest: 'components/dialog.jsx', include: 'always' },
        {
          src: 'button.jsx',
          dest: 'components/button.jsx',
          include: 'when',
          condition: { component: 'button' },
        },
      ],
      transform: 'hybrid',
    });
    expect(errors).toEqual([]);
  });

  it('rejects src with path traversal', () => {
    const errors = validateLpmConfig({
      files: [{ src: '../../etc/passwd', dest: 'out.txt', include: 'always' }],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('path traversal');
  });

  it('rejects src starting with /', () => {
    const errors = validateLpmConfig({
      files: [{ src: '/etc/passwd', dest: 'out.txt', include: 'always' }],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('relative path');
  });

  it('rejects dest with path traversal', () => {
    const errors = validateLpmConfig({
      files: [
        { src: 'file.js', dest: '../../../malicious.js', include: 'always' },
      ],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('path traversal');
  });

  it('rejects select type with no options', () => {
    const errors = validateLpmConfig({
      configSchema: {
        component: {
          type: 'select',
          options: [],
        },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('no options');
  });

  it('rejects unknown type in configSchema', () => {
    const errors = validateLpmConfig({
      configSchema: {
        component: {
          type: 'multiselect',
        },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('"select" or "boolean"');
  });

  it('rejects too many file rules', () => {
    const files = Array.from({ length: 1001 }, (_, i) => ({
      src: `file${i}.js`,
      dest: `file${i}.js`,
      include: 'always',
    }));
    const errors = validateLpmConfig({ files });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Too many file rules');
  });

  it('rejects when condition without condition object', () => {
    const errors = validateLpmConfig({
      files: [{ src: 'file.js', dest: 'file.js', include: 'when' }],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('no condition object');
  });

  it('rejects invalid include value', () => {
    const errors = validateLpmConfig({
      files: [{ src: 'file.js', dest: 'file.js', include: 'sometimes' }],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('"always", "never", or "when"');
  });

  it('rejects invalid transform value', () => {
    const errors = validateLpmConfig({ transform: 'magic' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('"template", "variants", or "hybrid"');
  });

  it('accepts valid importAlias', () => {
    const errors = validateLpmConfig({ importAlias: '@/' });
    expect(errors).toEqual([]);
  });

  it('accepts importAlias with custom prefix', () => {
    const errors = validateLpmConfig({ importAlias: '~/' });
    expect(errors).toEqual([]);
  });

  it('rejects importAlias without trailing slash', () => {
    const errors = validateLpmConfig({ importAlias: '@' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('must end with');
  });

  it('rejects non-string importAlias', () => {
    const errors = validateLpmConfig({ importAlias: 123 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('must be a string');
  });
});

// ============================================================================
// resolveConditionalDependencies
// ============================================================================

describe('resolveConditionalDependencies', () => {
  const depConfig = {
    styling: {
      panda: ['@pandacss/dev'],
      tailwind: ['tailwindcss', 'autoprefixer'],
    },
    iconLibrary: {
      lucide: ['lucide-react'],
      custom: ['@lpm.dev/acme.icons'],
    },
  };

  it('returns correct npm deps for selected config', () => {
    const result = resolveConditionalDependencies(depConfig, {
      styling: 'panda',
      iconLibrary: 'lucide',
    });
    expect(result.npm).toEqual(
      expect.arrayContaining(['@pandacss/dev', 'lucide-react']),
    );
    expect(result.lpm).toEqual([]);
  });

  it('separates @lpm.dev/ packages from npm packages', () => {
    const result = resolveConditionalDependencies(depConfig, {
      styling: 'panda',
      iconLibrary: 'custom',
    });
    expect(result.npm).toEqual(['@pandacss/dev']);
    expect(result.lpm).toEqual(['@lpm.dev/acme.icons']);
  });

  it('returns no deps for missing config key', () => {
    const result = resolveConditionalDependencies(depConfig, {
      styling: 'panda',
      // iconLibrary not provided
    });
    expect(result.npm).toEqual(['@pandacss/dev']);
    expect(result.lpm).toEqual([]);
  });

  it('deduplicates dependencies', () => {
    const depConfigWithDupes = {
      a: { x: ['react', 'lodash'] },
      b: { y: ['react', 'chalk'] },
    };
    const result = resolveConditionalDependencies(depConfigWithDupes, {
      a: 'x',
      b: 'y',
    });
    expect(result.npm).toEqual(
      expect.arrayContaining(['react', 'lodash', 'chalk']),
    );
    // react should appear only once
    expect(result.npm.filter(d => d === 'react')).toHaveLength(1);
  });
});

// ============================================================================
// resolveVariants
// ============================================================================

describe('resolveVariants', () => {
  const variants = {
    styling: {
      panda: 'styles/panda.config.js',
      tailwind: 'styles/tailwind.config.js',
    },
    iconLibrary: {
      lucide: 'icons/lucide.js',
      heroicons: 'icons/heroicons.js',
    },
  };
  const output = {
    styling: 'lib/style-config.js',
    iconLibrary: 'lib/icons.js',
  };

  it('resolves variant files based on config', () => {
    const result = resolveVariants(
      variants,
      {
        styling: 'panda',
        iconLibrary: 'lucide',
      },
      output,
    );
    expect(result).toEqual([
      { src: 'styles/panda.config.js', dest: 'lib/style-config.js' },
      { src: 'icons/lucide.js', dest: 'lib/icons.js' },
    ]);
  });

  it('uses src as dest when no output mapping exists', () => {
    const result = resolveVariants(variants, { styling: 'panda' });
    expect(result[0].dest).toBe('styles/panda.config.js');
  });

  it('skips variants for missing config keys', () => {
    const result = resolveVariants(variants, { styling: 'panda' }, output);
    expect(result).toHaveLength(1);
  });
});

// ============================================================================
// readLpmConfig
// ============================================================================

describe('readLpmConfig', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when lpm.config.json does not exist', () => {
    const result = readLpmConfig(tmpDir);
    expect(result).toBeNull();
  });

  it('reads and parses a valid lpm.config.json', () => {
    const config = {
      configSchema: {
        component: {
          type: 'select',
          options: [{ value: 'dialog', label: 'Dialog' }],
        },
      },
      files: [{ src: 'dialog.jsx', dest: 'dialog.jsx', include: 'always' }],
    };
    fs.writeFileSync(
      path.join(tmpDir, 'lpm.config.json'),
      JSON.stringify(config),
    );

    const result = readLpmConfig(tmpDir);
    expect(result).toEqual(config);
  });

  it('throws on invalid config', () => {
    const config = {
      files: [{ src: '../../etc/passwd', dest: 'out.txt', include: 'always' }],
    };
    fs.writeFileSync(
      path.join(tmpDir, 'lpm.config.json'),
      JSON.stringify(config),
    );

    expect(() => readLpmConfig(tmpDir)).toThrow('path traversal');
  });

  it('throws on invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'lpm.config.json'), 'not json{{{');
    expect(() => readLpmConfig(tmpDir)).toThrow();
  });
});

// ============================================================================
// expandSrcGlob
// ============================================================================

describe('expandSrcGlob', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-test-'));
    // Create test file structure
    fs.mkdirSync(path.join(tmpDir, 'components', 'dialog'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'components', 'dialog', 'Dialog.jsx'),
      '',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'components', 'dialog', 'Dialog.style.jsx'),
      '',
    );
    fs.writeFileSync(path.join(tmpDir, 'lib', 'utils.js'), '');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns exact path when it exists', () => {
    const result = expandSrcGlob('lib/utils.js', tmpDir);
    expect(result).toEqual(['lib/utils.js']);
  });

  it('returns empty array when exact path does not exist', () => {
    const result = expandSrcGlob('lib/missing.js', tmpDir);
    expect(result).toEqual([]);
  });

  it('expands ** to all files in directory recursively', () => {
    const result = expandSrcGlob('components/dialog/**', tmpDir);
    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Dialog.jsx'),
        expect.stringContaining('Dialog.style.jsx'),
      ]),
    );
  });

  it('returns empty array for non-existent directory with **', () => {
    const result = expandSrcGlob('nonexistent/**', tmpDir);
    expect(result).toEqual([]);
  });

  it('expands *.ext pattern in a directory', () => {
    const result = expandSrcGlob('components/dialog/*.jsx', tmpDir);
    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        'components/dialog/Dialog.jsx',
        'components/dialog/Dialog.style.jsx',
      ]),
    );
  });

  it('filters by extension with *.ext pattern', () => {
    fs.writeFileSync(path.join(tmpDir, 'lib', 'config.json'), '');
    const result = expandSrcGlob('lib/*.js', tmpDir);
    expect(result).toEqual(['lib/utils.js']);
  });

  it('returns empty array for *.ext in non-existent directory', () => {
    const result = expandSrcGlob('missing/*.js', tmpDir);
    expect(result).toEqual([]);
  });

  it('handles *.* pattern to match all files with extensions', () => {
    const result = expandSrcGlob('lib/*.*', tmpDir);
    expect(result).toEqual(['lib/utils.js']);
  });

  it('handles root-level * pattern', () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), '');
    const result = expandSrcGlob('*.md', tmpDir);
    expect(result).toEqual(['readme.md']);
  });
});
