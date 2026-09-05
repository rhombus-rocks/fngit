import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SCHEMA_URL, writeRepoSettings } from './settings-writer.js';
import { parseConfigDocument } from './settings.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'fngit-writer-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('writeRepoSettings — no existing file', () => {
  test('creates config.json under the default dir, $schema first, created: true', () => {
    const home = join(tmpRoot, 'home');
    const result = writeRepoSettings({ home, patch: { cloneTemplate: '~/src/{repo}@{owner}' } });

    const expectedPath = join(home, '.config', 'rhombus.rocks', 'config.json');
    expect(result).toEqual({ path: expectedPath, created: true });

    const raw = readFileSync(expectedPath, 'utf8');
    expect(Object.keys(JSON.parse(raw) as Record<string, unknown>)[0]).toBe('$schema');
    expect(JSON.parse(raw)).toEqual({ $schema: SCHEMA_URL, repos: { cloneTemplate: '~/src/{repo}@{owner}' } });
  });

  test('creates parent directories as needed', () => {
    const home = join(tmpRoot, 'nested', 'deep', 'home');
    writeRepoSettings({ home, patch: { cloneTemplate: 'x' } });
    expect(parseConfigDocument(join(home, '.config', 'rhombus.rocks', 'config.json'))).toEqual({ $schema: SCHEMA_URL,
      repos: { cloneTemplate: 'x' } });
  });

  test('an explicit configPath override creates the file there, in its own format', () => {
    const target = join(tmpRoot, 'custom.yaml');
    const result = writeRepoSettings({ home: join(tmpRoot, 'home'), configPath: target,
      patch: { cloneTemplate: 'yaml-tpl' } });
    expect(result).toEqual({ path: target, created: true });
    const parsed = parseConfigDocument(target) as Record<string, unknown>;
    expect(parsed).toEqual({ $schema: SCHEMA_URL, repos: { cloneTemplate: 'yaml-tpl' } });
  });
});

describe('writeRepoSettings — merging into an existing file', () => {
  test('preserves unrelated top-level keys', () => {
    const home = join(tmpRoot, 'home');
    const configPath = join(home, '.config', 'rhombus.rocks', 'config.json');
    mkdirSync(join(configPath, '..'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ someOtherTool: { setting: true }, repos: { cloneTemplate: 'old' } }));

    const result = writeRepoSettings({ home, patch: { cloneTemplate: 'new' } });

    expect(result.created).toBe(false);
    const doc = parseConfigDocument(configPath) as Record<string, unknown>;
    expect(doc.someOtherTool).toEqual({ setting: true });
    expect((doc.repos as Record<string, unknown>).cloneTemplate).toBe('new');
  });

  test('preserves repos.branchTemplate — fngit does not own it', () => {
    const home = join(tmpRoot, 'home');
    const configPath = join(home, '.config', 'rhombus.rocks', 'config.json');
    mkdirSync(join(configPath, '..'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ repos: { branchTemplate: '{input}', cloneTemplate: 'old' } }));

    writeRepoSettings({ home, patch: { cloneTemplate: 'new' } });

    const doc = parseConfigDocument(configPath) as Record<string, unknown>;
    expect((doc.repos as Record<string, unknown>).branchTemplate).toBe('{input}');
    expect((doc.repos as Record<string, unknown>).cloneTemplate).toBe('new');
  });

  test('a partial patch only touches the given fields', () => {
    const home = join(tmpRoot, 'home');
    const configPath = join(home, '.config', 'rhombus.rocks', 'config.json');
    mkdirSync(join(configPath, '..'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ repos: { cloneTemplate: 'keep-me', worktreeTemplate: 'also-keep' } }));

    writeRepoSettings({ home, patch: { additionalSrcDirs: ['~/code'] } });

    const doc = parseConfigDocument(configPath) as { repos: Record<string, unknown>; };
    expect(doc.repos.cloneTemplate).toBe('keep-me');
    expect(doc.repos.worktreeTemplate).toBe('also-keep');
    expect(doc.repos.additionalSrcDirs).toEqual(['~/code']);
  });

  test('an existing config.toml is merged and re-serialized as toml', () => {
    const home = join(tmpRoot, 'home');
    const configPath = join(home, '.config', 'rhombus.rocks', 'config.toml');
    mkdirSync(join(configPath, '..'), { recursive: true });
    writeFileSync(configPath, '[repos]\ncloneTemplate = "old"\n');

    const result = writeRepoSettings({ home, patch: { worktreeTemplate: 'wt' } });

    expect(result.path).toBe(configPath);
    expect(result.created).toBe(false);
    const raw = readFileSync(configPath, 'utf8');
    expect(raw).not.toContain('"cloneTemplate"'); // still TOML, not JSON
    const doc = parseConfigDocument(configPath) as { repos: Record<string, unknown>; };
    expect(doc.repos.cloneTemplate).toBe('old');
    expect(doc.repos.worktreeTemplate).toBe('wt');
  });

  test('created: false when the file already existed', () => {
    const home = join(tmpRoot, 'home');
    const configPath = join(home, '.config', 'rhombus.rocks', 'config.json');
    mkdirSync(join(configPath, '..'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ repos: {} }));
    expect(writeRepoSettings({ home, patch: { cloneTemplate: 'x' } }).created).toBe(false);
  });

  test('hostAliases patch replaces the whole map, not a per-key merge', () => {
    const home = join(tmpRoot, 'home');
    const configPath = join(home, '.config', 'rhombus.rocks', 'config.json');
    mkdirSync(join(configPath, '..'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ repos: { hostAliases: { 'github.com': 'gh', 'gitlab.com': 'gl' } } }));

    writeRepoSettings({ home, patch: { hostAliases: { 'bitbucket.org': 'bb' } } });

    const doc = parseConfigDocument(configPath) as { repos: Record<string, unknown>; };
    expect(doc.repos.hostAliases).toEqual({ 'bitbucket.org': 'bb' });
  });

  test('a malformed existing file is replaced rather than crashing the write', () => {
    const home = join(tmpRoot, 'home');
    const configPath = join(home, '.config', 'rhombus.rocks', 'config.json');
    mkdirSync(join(configPath, '..'), { recursive: true });
    writeFileSync(configPath, '{ not valid json');

    writeRepoSettings({ home, patch: { cloneTemplate: 'recovered' } });

    const doc = parseConfigDocument(configPath) as { repos: Record<string, unknown>; };
    expect(doc.repos.cloneTemplate).toBe('recovered');
  });
});

describe('writeRepoSettings — FNGIT_CONFIG override', () => {
  test('writes to the env-provided path, merging any existing content there', () => {
    const target = join(tmpRoot, 'somewhere', 'my-config.json');
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, JSON.stringify({ repos: { cloneTemplate: 'old' } }));

    const result = writeRepoSettings({ home: join(tmpRoot, 'home'), env: { FNGIT_CONFIG: target },
      patch: { worktreeTemplate: 'wt' } });

    expect(result).toEqual({ path: target, created: false });
    const doc = parseConfigDocument(target) as { repos: Record<string, unknown>; };
    expect(doc.repos.cloneTemplate).toBe('old');
    expect(doc.repos.worktreeTemplate).toBe('wt');
  });
});
