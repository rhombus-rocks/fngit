import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { previewTemplate, validateCloneTemplate, writeHostAliases, writeLocateSettings } from './settings-writer.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'fngit-sw-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('writeLocateSettings', () => {
  test('creates the file and parent dirs when nothing exists', async () => {
    const path = join(tmpRoot, 'deep/nested/settings.json');
    await writeLocateSettings({ cloneTemplate: '~/src/{repo}@{owner}' }, { path });
    const content = JSON.parse(readFileSync(path, 'utf8'));
    expect(content).toEqual({ repoSettings: { cloneTemplate: '~/src/{repo}@{owner}' } });
  });

  test('preserves unrelated top-level keys when patching', async () => {
    const path = join(tmpRoot, 'settings.json');
    writeFileSync(path, JSON.stringify({ theme: 'dark', repoSettings: { cloneTemplate: 'old' } }, null, 2));
    await writeLocateSettings({ cloneTemplate: 'new' }, { path });
    const content = JSON.parse(readFileSync(path, 'utf8'));
    expect(content.theme).toBe('dark');
    expect(content.repoSettings.cloneTemplate).toBe('new');
  });

  test('preserves top-level key order', async () => {
    const path = join(tmpRoot, 'settings.json');
    writeFileSync(path, JSON.stringify({ alpha: 1, repoSettings: { x: 'keep' }, beta: 2 }, null, 2));
    await writeLocateSettings({ cloneTemplate: '~/src/{repo}' }, { path });
    const keys = Object.keys(JSON.parse(readFileSync(path, 'utf8')));
    expect(keys).toEqual(['alpha', 'repoSettings', 'beta']);
  });

  test('preserves 4-space indentation', async () => {
    const path = join(tmpRoot, 'settings.json');
    writeFileSync(path, JSON.stringify({ existing: true }, null, 4));
    await writeLocateSettings({ cloneTemplate: '~/src/{repo}' }, { path });
    const raw = readFileSync(path, 'utf8');
    expect(raw).toMatch(/^ {4}"repoSettings"/m);
  });

  test('preserves tab indentation', async () => {
    const path = join(tmpRoot, 'settings.json');
    writeFileSync(path, '{\n\t"existing": true\n}\n');
    await writeLocateSettings({ cloneTemplate: '~/src/{repo}' }, { path });
    const raw = readFileSync(path, 'utf8');
    expect(raw).toContain('\t"repoSettings"');
  });

  test('defaults to 2-space indentation for new files', async () => {
    const path = join(tmpRoot, 'settings.json');
    await writeLocateSettings({ cloneTemplate: '~/src/{repo}' }, { path });
    const raw = readFileSync(path, 'utf8');
    expect(raw).toMatch(/^ {2}"repoSettings"/m);
  });

  test('patches only the given keys, leaving others in repoSettings intact', async () => {
    const path = join(tmpRoot, 'settings.json');
    writeFileSync(path,
      JSON.stringify({
        repoSettings: { cloneTemplate: 'old-clone', worktreeTemplate: 'old-wt', somethingElse: 'keep' },
      }, null, 2));
    await writeLocateSettings({ cloneTemplate: 'new-clone' }, { path });
    const content = JSON.parse(readFileSync(path, 'utf8'));
    expect(content.repoSettings.cloneTemplate).toBe('new-clone');
    expect(content.repoSettings.worktreeTemplate).toBe('old-wt');
    expect(content.repoSettings.somethingElse).toBe('keep');
  });

  test('writes additionalSrcDirs as an array', async () => {
    const path = join(tmpRoot, 'settings.json');
    await writeLocateSettings({ additionalSrcDirs: ['~/.local/src', '/opt/src'] }, { path });
    const content = JSON.parse(readFileSync(path, 'utf8'));
    expect(content.repoSettings.additionalSrcDirs).toEqual(['~/.local/src', '/opt/src']);
  });

  test('handles malformed existing JSON gracefully', async () => {
    const path = join(tmpRoot, 'settings.json');
    writeFileSync(path, '{ not valid json');
    await writeLocateSettings({ cloneTemplate: '~/src/{repo}' }, { path });
    const content = JSON.parse(readFileSync(path, 'utf8'));
    expect(content.repoSettings.cloneTemplate).toBe('~/src/{repo}');
  });

  test('creates repoSettings when file has no repoSettings block', async () => {
    const path = join(tmpRoot, 'settings.json');
    writeFileSync(path, JSON.stringify({ theme: 'dark' }, null, 2));
    await writeLocateSettings({ cloneTemplate: '~/src/{repo}' }, { path });
    const content = JSON.parse(readFileSync(path, 'utf8'));
    expect(content.repoSettings.cloneTemplate).toBe('~/src/{repo}');
    expect(content.theme).toBe('dark');
  });

  test('replaces non-object repoSettings', async () => {
    const path = join(tmpRoot, 'settings.json');
    writeFileSync(path, JSON.stringify({ repoSettings: 'not-an-object' }, null, 2));
    await writeLocateSettings({ cloneTemplate: '~/src/{repo}' }, { path });
    const content = JSON.parse(readFileSync(path, 'utf8'));
    expect(content.repoSettings).toEqual({ cloneTemplate: '~/src/{repo}' });
  });

  test('ignores hostAliases in the patch — those go to a separate file', async () => {
    const path = join(tmpRoot, 'settings.json');
    await writeLocateSettings({ cloneTemplate: 'tpl', hostAliases: { 'github.com': 'gh' } }, { path });
    const content = JSON.parse(readFileSync(path, 'utf8'));
    expect(content.repoSettings).toEqual({ cloneTemplate: 'tpl' });
    expect(content.repoSettings.hostAliases).toBeUndefined();
  });

  test('preserves sub-key order inside repoSettings', async () => {
    const path = join(tmpRoot, 'settings.json');
    writeFileSync(path,
      JSON.stringify({ repoSettings: { additionalSrcDirs: [], cloneTemplate: 'old', extra: true } }, null, 2));
    await writeLocateSettings({ cloneTemplate: 'new' }, { path });
    const keys = Object.keys(JSON.parse(readFileSync(path, 'utf8')).repoSettings);
    expect(keys).toEqual(['additionalSrcDirs', 'cloneTemplate', 'extra']);
  });
});

describe('writeHostAliases', () => {
  test('creates the file and parent dirs', async () => {
    const path = join(tmpRoot, 'deep/host-aliases.json');
    await writeHostAliases({ 'github.com': 'gh', 'gitlab.com': 'gl' }, { path });
    const content = JSON.parse(readFileSync(path, 'utf8'));
    expect(content).toEqual({ 'github.com': 'gh', 'gitlab.com': 'gl' });
  });

  test('overwrites an existing file completely', async () => {
    const path = join(tmpRoot, 'host-aliases.json');
    writeFileSync(path, JSON.stringify({ old: 'value' }));
    await writeHostAliases({ 'github.com': 'gh' }, { path });
    const content = JSON.parse(readFileSync(path, 'utf8'));
    expect(content).toEqual({ 'github.com': 'gh' });
  });
});

describe('validateCloneTemplate', () => {
  test('valid template with {repo}', () => {
    expect(validateCloneTemplate('~/src/{repo}@{owner}')).toEqual({ ok: true });
  });

  test('rejects template without {repo}', () => {
    const result = validateCloneTemplate('~/src/{owner}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('{repo}');
    }
  });

  test('rejects template with unknown placeholder', () => {
    const result = validateCloneTemplate('~/src/{repo}/{unknown}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('{unknown}');
    }
  });

  test('template with {host-short} validates with default preview aliases', () => {
    expect(validateCloneTemplate('~/src/{host-short}/{repo}')).toEqual({ ok: true });
  });

  test('empty template is rejected', () => {
    const result = validateCloneTemplate('');
    expect(result.ok).toBe(false);
  });
});

describe('previewTemplate', () => {
  test('renders with default example values', () => {
    expect(previewTemplate('~/src/{repo}@{owner}')).toEqual({ ok: true, value: '~/src/fngit@rhombus-rocks' });
  });

  test('renders with custom example values', () => {
    expect(previewTemplate('~/src/{repo}@{owner}', { repo: 'myrepo', owner: 'myorg' })).toEqual({ ok: true,
      value: '~/src/myrepo@myorg' });
  });

  test('renders worktree template with {input}', () => {
    expect(previewTemplate('~/src/{repo}@{owner}+{input}')).toEqual({ ok: true,
      value: '~/src/fngit@rhombus-rocks+feat-x' });
  });

  test('renders {host-short} with default aliases', () => {
    expect(previewTemplate('~/src/{host-short}/{repo}')).toEqual({ ok: true, value: '~/src/gh/fngit' });
  });

  test('error for unknown placeholder', () => {
    const result = previewTemplate('{nope}');
    expect(result.ok).toBe(false);
  });
});
