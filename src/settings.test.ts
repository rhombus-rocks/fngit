import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BUILTIN_HOST_ALIASES, defaultConfigDir, loadLocateSettings, resolveConfigPath } from './settings.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'fngit-settings-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function write(path: string, body: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, body);
}

function writeJson(path: string, body: unknown): void {
  write(path, JSON.stringify(body));
}

describe('defaultConfigDir', () => {
  test('defaults to <home>/.config/rhombus.rocks', () => {
    expect(defaultConfigDir('/home/tom', {})).toBe(join('/home/tom', '.config', 'rhombus.rocks'));
  });

  test('honors XDG_CONFIG_HOME', () => {
    expect(defaultConfigDir('/home/tom', { XDG_CONFIG_HOME: '/custom/config' })).toBe(
      join('/custom/config', 'rhombus.rocks'),
    );
  });
});

describe('resolveConfigPath', () => {
  test('no override, nothing on disk → config.json at the default dir, marked absent', () => {
    const home = join(tmpRoot, 'home');
    const resolved = resolveConfigPath({ home, env: {} });
    expect(resolved).toEqual({ path: join(home, '.config', 'rhombus.rocks', 'config.json'), exists: false,
      overridden: false });
  });

  test('scans json, jsonc, toml, yaml in that order — first existing file wins', () => {
    const home = join(tmpRoot, 'home');
    const dir = join(home, '.config', 'rhombus.rocks');
    writeJson(join(dir, 'config.toml'), {});
    writeJson(join(dir, 'config.yaml'), {});
    const resolved = resolveConfigPath({ home, env: {} });
    expect(resolved.path).toBe(join(dir, 'config.toml'));
    expect(resolved.exists).toBe(true);
    expect(resolved.overridden).toBe(false);
  });

  test('a config.json present wins over config.jsonc even when jsonc is also present', () => {
    const home = join(tmpRoot, 'home');
    const dir = join(home, '.config', 'rhombus.rocks');
    writeJson(join(dir, 'config.json'), {});
    writeJson(join(dir, 'config.jsonc'), {});
    expect(resolveConfigPath({ home, env: {} }).path).toBe(join(dir, 'config.json'));
  });

  test('FNGIT_CONFIG env overrides the scan, whether or not the path exists', () => {
    const home = join(tmpRoot, 'home');
    const explicit = join(tmpRoot, 'elsewhere', 'my-config.yaml');
    const resolved = resolveConfigPath({ home, env: { FNGIT_CONFIG: explicit } });
    expect(resolved).toEqual({ path: explicit, exists: false, overridden: true });
  });

  test('configPath argument outranks FNGIT_CONFIG', () => {
    const home = join(tmpRoot, 'home');
    const argPath = join(tmpRoot, 'arg-config.json');
    writeJson(argPath, {});
    const resolved = resolveConfigPath({ home, env: { FNGIT_CONFIG: '/should/not/be/used.json' },
      configPath: argPath });
    expect(resolved).toEqual({ path: argPath, exists: true, overridden: true });
  });
});

describe('loadLocateSettings — new config file', () => {
  test('reads repos.* from config.json', () => {
    const home = join(tmpRoot, 'home');
    writeJson(join(home, '.config', 'rhombus.rocks', 'config.json'), {
      repos: { cloneTemplate: '~/src/{repo}@{owner}', worktreeTemplate: '~/src/{repo}@{owner}+{input}',
        additionalSrcDirs: ['~/.local/src'], hostAliases: { 'git.example.com': 'ex' } },
    });
    const settings = loadLocateSettings({ home });
    expect(settings.cloneTemplate).toBe('~/src/{repo}@{owner}');
    expect(settings.worktreeTemplate).toBe('~/src/{repo}@{owner}+{input}');
    expect(settings.additionalSrcDirs).toEqual(['~/.local/src']);
    expect(settings.hostAliases).toEqual({ ...BUILTIN_HOST_ALIASES, 'git.example.com': 'ex' });
  });

  test('a config.toml is parsed too', () => {
    const home = join(tmpRoot, 'home');
    write(join(home, '.config', 'rhombus.rocks', 'config.toml'), '[repos]\ncloneTemplate = "~/src/{repo}@{owner}"\n');
    expect(loadLocateSettings({ home }).cloneTemplate).toBe('~/src/{repo}@{owner}');
  });

  test('a config.yaml is parsed too', () => {
    const home = join(tmpRoot, 'home');
    write(join(home, '.config', 'rhombus.rocks', 'config.yaml'), 'repos:\n  cloneTemplate: "~/src/{repo}@{owner}"\n');
    expect(loadLocateSettings({ home }).cloneTemplate).toBe('~/src/{repo}@{owner}');
  });

  test('a config.jsonc with comments is parsed', () => {
    const home = join(tmpRoot, 'home');
    write(join(home, '.config', 'rhombus.rocks', 'config.jsonc'),
      '{\n  // comment\n  "repos": { "cloneTemplate": "~/src/{repo}@{owner}" }\n}\n');
    expect(loadLocateSettings({ home }).cloneTemplate).toBe('~/src/{repo}@{owner}');
  });

  test('a repos.hostAliases entry overrides a built-in default', () => {
    const home = join(tmpRoot, 'home');
    writeJson(join(home, '.config', 'rhombus.rocks', 'config.json'), {
      repos: { hostAliases: { 'github.com': 'my-gh' } },
    });
    expect(loadLocateSettings({ home }).hostAliases['github.com']).toBe('my-gh');
  });

  test('unrelated top-level keys and unowned repos.* keys are ignored, not erroring', () => {
    const home = join(tmpRoot, 'home');
    writeJson(join(home, '.config', 'rhombus.rocks', 'config.json'), {
      $schema: 'https://json.schemastore.org/rhombus-rocks-config.json',
      somethingElse: { nested: true },
      repos: { cloneTemplate: '~/src/{repo}@{owner}', branchTemplate: '{input}' },
    });
    expect(loadLocateSettings({ home }).cloneTemplate).toBe('~/src/{repo}@{owner}');
  });

  test('malformed file → empty settings plus built-in aliases, not a throw', () => {
    const home = join(tmpRoot, 'home');
    write(join(home, '.config', 'rhombus.rocks', 'config.json'), '{ not valid');
    const settings = loadLocateSettings({ home });
    expect(settings.cloneTemplate).toBe('');
    expect(settings.hostAliases).toEqual(BUILTIN_HOST_ALIASES);
  });

  test('FNGIT_CONFIG env is honored', () => {
    const home = join(tmpRoot, 'home');
    const explicit = join(tmpRoot, 'custom.json');
    writeJson(explicit, { repos: { cloneTemplate: 'custom-tpl' } });
    expect(loadLocateSettings({ home, env: { FNGIT_CONFIG: explicit } }).cloneTemplate).toBe('custom-tpl');
  });

  test('an explicit configPath argument is honored over FNGIT_CONFIG', () => {
    const home = join(tmpRoot, 'home');
    const explicit = join(tmpRoot, 'explicit.json');
    writeJson(explicit, { repos: { cloneTemplate: 'explicit-tpl' } });
    const settings = loadLocateSettings({ home, env: { FNGIT_CONFIG: '/nope.json' }, configPath: explicit });
    expect(settings.cloneTemplate).toBe('explicit-tpl');
  });
});

describe('loadLocateSettings — no new config file → falls back to ~/.fngitrc', () => {
  test('reads top-level (not repos-nested) fields from ~/.fngitrc', () => {
    const home = join(tmpRoot, 'home');
    writeJson(join(home, '.fngitrc'), { cloneTemplate: '~/src/{repo}@{owner}',
      worktreeTemplate: '~/src/{repo}@{owner}+{input}', additionalSrcDirs: ['~/.local/src'],
      hostAliases: { 'git.example.com': 'ex' } });
    const settings = loadLocateSettings({ home });
    expect(settings.cloneTemplate).toBe('~/src/{repo}@{owner}');
    expect(settings.additionalSrcDirs).toEqual(['~/.local/src']);
    expect(settings.hostAliases).toEqual({ ...BUILTIN_HOST_ALIASES, 'git.example.com': 'ex' });
  });

  test('the new file, once present, is used instead — ~/.fngitrc is never consulted', () => {
    const home = join(tmpRoot, 'home');
    writeJson(join(home, '.fngitrc'), { cloneTemplate: 'legacy-tpl' });
    writeJson(join(home, '.config', 'rhombus.rocks', 'config.json'), { repos: { cloneTemplate: 'new-tpl' } });
    expect(loadLocateSettings({ home }).cloneTemplate).toBe('new-tpl');
  });

  test('neither file present → empty settings plus built-in aliases', () => {
    const home = join(tmpRoot, 'home');
    const settings = loadLocateSettings({ home });
    expect(settings.cloneTemplate).toBe('');
    expect(settings.worktreeTemplate).toBe('');
    expect(settings.additionalSrcDirs).toEqual([]);
    expect(settings.hostAliases).toEqual(BUILTIN_HOST_ALIASES);
  });

  test('a single-string additionalSrcDirs is normalized to a one-entry list', () => {
    const home = join(tmpRoot, 'home');
    writeJson(join(home, '.fngitrc'), { additionalSrcDirs: '~/.local/src' });
    expect(loadLocateSettings({ home }).additionalSrcDirs).toEqual(['~/.local/src']);
  });

  test('a legacyPath override is honored', () => {
    const home = join(tmpRoot, 'home');
    const legacy = join(tmpRoot, 'custom-legacy.json');
    writeJson(legacy, { cloneTemplate: 'legacy-custom-tpl' });
    expect(loadLocateSettings({ home, legacyPath: legacy }).cloneTemplate).toBe('legacy-custom-tpl');
  });
});
