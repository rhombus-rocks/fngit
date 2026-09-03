import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadHostAliases, loadLocateSettings, loadRepoSettings, type LoadRepoSettingsArgs } from './settings.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'fngit-settings-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function write(path: string, body: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
}

describe('loadRepoSettings', () => {
  let paths: LoadRepoSettingsArgs;

  beforeEach(() => {
    paths = { userPath: join(tmpRoot, 'user.json'), projectPath: join(tmpRoot, 'project.json'),
      localPath: join(tmpRoot, 'local.json'), managedPath: join(tmpRoot, 'managed.json') };
  });

  test('all tiers missing → empty templates and no extra dirs', () => {
    expect(loadRepoSettings(paths)).toEqual({ cloneTemplate: '', worktreeTemplate: '', additionalSrcDirs: [] });
  });

  test('settings.json without a repoSettings block → empty', () => {
    write(paths.userPath, { theme: 'dark' });
    expect(loadRepoSettings(paths).cloneTemplate).toBe('');
  });

  test('unrelated keys under repoSettings are ignored', () => {
    write(paths.userPath, { repoSettings: { somethingElse: 'x', cloneTemplate: '~/src/{repo}@{owner}' } });
    expect(loadRepoSettings(paths).cloneTemplate).toBe('~/src/{repo}@{owner}');
  });

  test('worktreeTemplate is read', () => {
    write(paths.projectPath, { repoSettings: { worktreeTemplate: '~/src/{repo}@{owner}+{input}' } });
    expect(loadRepoSettings(paths).worktreeTemplate).toBe('~/src/{repo}@{owner}+{input}');
  });

  test('local overrides project overrides user', () => {
    write(paths.userPath, { repoSettings: { cloneTemplate: 'user-tpl' } });
    write(paths.projectPath, { repoSettings: { cloneTemplate: 'project-tpl' } });
    write(paths.localPath, { repoSettings: { cloneTemplate: 'local-tpl' } });
    expect(loadRepoSettings(paths).cloneTemplate).toBe('local-tpl');
  });

  test('managed wins over local', () => {
    write(paths.localPath, { repoSettings: { cloneTemplate: 'local-tpl' } });
    write(paths.managedPath!, { repoSettings: { cloneTemplate: 'managed-tpl' } });
    expect(loadRepoSettings(paths).cloneTemplate).toBe('managed-tpl');
  });

  test('per-field merge — distinct fields from different tiers coexist', () => {
    write(paths.userPath, { repoSettings: { cloneTemplate: 'user-clone' } });
    write(paths.projectPath, { repoSettings: { worktreeTemplate: 'project-wt' } });
    write(paths.localPath, { repoSettings: { additionalSrcDirs: ['/opt/src'] } });
    expect(loadRepoSettings(paths)).toEqual({ cloneTemplate: 'user-clone', worktreeTemplate: 'project-wt',
      additionalSrcDirs: ['/opt/src'] });
  });

  test('a field missing from a higher tier does not clobber a lower one', () => {
    write(paths.userPath, { repoSettings: { cloneTemplate: 'user-clone' } });
    write(paths.localPath, { repoSettings: { worktreeTemplate: 'local-wt' } });
    expect(loadRepoSettings(paths).cloneTemplate).toBe('user-clone');
  });

  test('managedPath omitted → that tier is absent, lower tiers still merge', () => {
    write(paths.userPath, { repoSettings: { cloneTemplate: 'user-tpl' } });
    const { managedPath: _managed, ...withoutManaged } = paths;
    expect(loadRepoSettings(withoutManaged).cloneTemplate).toBe('user-tpl');
  });

  test('malformed JSON drops that tier only', () => {
    writeFileSync(paths.userPath, '{ not valid');
    write(paths.projectPath, { repoSettings: { cloneTemplate: 'project-tpl' } });
    expect(loadRepoSettings(paths).cloneTemplate).toBe('project-tpl');
  });

  test('non-object root is dropped', () => {
    write(paths.userPath, ['array', 'root']);
    write(paths.projectPath, { repoSettings: { cloneTemplate: 'project-tpl' } });
    expect(loadRepoSettings(paths).cloneTemplate).toBe('project-tpl');
  });

  test('repoSettings that is not an object is treated as absent', () => {
    write(paths.userPath, { repoSettings: 'a string instead of an object' });
    write(paths.projectPath, { repoSettings: { cloneTemplate: 'project-tpl' } });
    expect(loadRepoSettings(paths).cloneTemplate).toBe('project-tpl');
  });

  test('a non-string field value drops that field only', () => {
    write(paths.userPath, { repoSettings: { cloneTemplate: 42, worktreeTemplate: 'good' } });
    expect(loadRepoSettings(paths)).toEqual({ cloneTemplate: '', worktreeTemplate: 'good', additionalSrcDirs: [] });
  });

  test('a directory where a file was expected is skipped', () => {
    mkdirSync(paths.userPath);
    write(paths.projectPath, { repoSettings: { cloneTemplate: 'project-tpl' } });
    expect(loadRepoSettings(paths).cloneTemplate).toBe('project-tpl');
  });
});

describe('loadRepoSettings — additionalSrcDirs accepts one path or a list', () => {
  let paths: LoadRepoSettingsArgs;

  beforeEach(() => {
    paths = { userPath: join(tmpRoot, 'user.json'), projectPath: join(tmpRoot, 'project.json'),
      localPath: join(tmpRoot, 'local.json') };
  });

  test('a single string is normalized to a one-entry list', () => {
    write(paths.userPath, { repoSettings: { additionalSrcDirs: '~/.local/src' } });
    expect(loadRepoSettings(paths).additionalSrcDirs).toEqual(['~/.local/src']);
  });

  test('a list is kept in the order written', () => {
    write(paths.userPath, {
      repoSettings: { additionalSrcDirs: ['~/.local/src', '/usr/local/src', '~/.cache/yay/*'] },
    });
    expect(loadRepoSettings(paths).additionalSrcDirs).toEqual(['~/.local/src', '/usr/local/src', '~/.cache/yay/*']);
  });

  test('an empty list is a real value — it does not fall back to a lower tier', () => {
    write(paths.userPath, { repoSettings: { additionalSrcDirs: '~/.local/src' } });
    write(paths.localPath, { repoSettings: { additionalSrcDirs: [] } });
    expect(loadRepoSettings(paths).additionalSrcDirs).toEqual([]);
  });

  test('a tier that sets it replaces the lower tier wholesale', () => {
    write(paths.userPath, { repoSettings: { additionalSrcDirs: ['~/.local/src'] } });
    write(paths.projectPath, { repoSettings: { additionalSrcDirs: ['/opt/src'] } });
    expect(loadRepoSettings(paths).additionalSrcDirs).toEqual(['/opt/src']);
  });

  test('a tier that omits it leaves the lower tier intact', () => {
    write(paths.userPath, { repoSettings: { additionalSrcDirs: ['~/.local/src'] } });
    write(paths.projectPath, { repoSettings: { cloneTemplate: 'project-tpl' } });
    expect(loadRepoSettings(paths).additionalSrcDirs).toEqual(['~/.local/src']);
  });

  test('a wrong-shaped value drops the field for that tier only', () => {
    write(paths.userPath, { repoSettings: { additionalSrcDirs: ['~/.local/src'] } });
    write(paths.localPath, { repoSettings: { additionalSrcDirs: 42, cloneTemplate: 'local-tpl' } });
    expect(loadRepoSettings(paths).additionalSrcDirs).toEqual(['~/.local/src']);
    expect(loadRepoSettings(paths).cloneTemplate).toBe('local-tpl');
  });

  test('a list carrying a non-string entry is rejected whole, not filtered', () => {
    write(paths.userPath, { repoSettings: { additionalSrcDirs: ['~/.local/src', 7] } });
    expect(loadRepoSettings(paths).additionalSrcDirs).toEqual([]);
  });
});

describe('loadHostAliases', () => {
  let systemPath: string;
  let userPath: string;

  beforeEach(() => {
    systemPath = join(tmpRoot, 'system.json');
    userPath = join(tmpRoot, 'user-aliases.json');
  });

  test('both files missing → empty', () => {
    expect(loadHostAliases({ systemPath, userPath })).toEqual({});
  });

  test('only the system file → reads it', () => {
    write(systemPath, { 'github.com': 'gh' });
    expect(loadHostAliases({ systemPath, userPath })).toEqual({ 'github.com': 'gh' });
  });

  test('only the user file → reads it', () => {
    write(userPath, { 'gitlab.com': 'gl' });
    expect(loadHostAliases({ systemPath, userPath })).toEqual({ 'gitlab.com': 'gl' });
  });

  test('user wins on conflict, both keys present otherwise', () => {
    write(systemPath, { 'github.com': 'gh-sys', 'gitlab.com': 'gl' });
    write(userPath, { 'github.com': 'gh-user', 'bitbucket.org': 'bb' });
    expect(loadHostAliases({ systemPath, userPath })).toEqual({ 'github.com': 'gh-user', 'gitlab.com': 'gl',
      'bitbucket.org': 'bb' });
  });

  test('malformed JSON drops that file, keeps the other', () => {
    writeFileSync(systemPath, '{ not valid json');
    write(userPath, { 'github.com': 'gh' });
    expect(loadHostAliases({ systemPath, userPath })).toEqual({ 'github.com': 'gh' });
  });

  test('non-object roots are dropped', () => {
    write(systemPath, ['github.com', 'gh']);
    write(userPath, { 'gitlab.com': 'gl' });
    expect(loadHostAliases({ systemPath, userPath })).toEqual({ 'gitlab.com': 'gl' });
  });

  test('null root is dropped', () => {
    writeFileSync(systemPath, 'null');
    expect(loadHostAliases({ systemPath, userPath })).toEqual({});
  });

  test('a non-string value drops that key, keeps the others', () => {
    write(systemPath, { 'github.com': 'gh', 'gitlab.com': 42, 'bitbucket.org': 'bb' });
    expect(loadHostAliases({ systemPath, userPath })).toEqual({ 'github.com': 'gh', 'bitbucket.org': 'bb' });
  });

  test('a directory where a file was expected is skipped', () => {
    mkdirSync(systemPath);
    write(userPath, { 'github.com': 'gh' });
    expect(loadHostAliases({ systemPath, userPath })).toEqual({ 'github.com': 'gh' });
  });

  test('an empty alias value is kept verbatim', () => {
    write(systemPath, { 'github.com': '', 'gitlab.com': '  gl  ' });
    expect(loadHostAliases({ systemPath, userPath })).toEqual({ 'github.com': '', 'gitlab.com': '  gl  ' });
  });
});

describe('loadLocateSettings — the wired-up chain', () => {
  // The managed tier and system host-aliases live at absolute system paths; the
  // tests point them at tmpdir so the chain never reads the developer's real
  // /etc/claude-code/managed-settings.json or /usr/share host-aliases file.
  let hermetic: { managedPath: string; systemAliasesPath: string; };

  beforeEach(() => {
    hermetic = { managedPath: join(tmpRoot, 'no-managed.json'), systemAliasesPath: join(tmpRoot, 'no-system.json') };
  });

  test('reads repoSettings from the user tier and aliases from the user data dir', () => {
    const home = join(tmpRoot, 'home');
    const cwd = join(tmpRoot, 'project');
    mkdirSync(cwd, { recursive: true });
    write(join(home, '.claude/settings.json'), {
      repoSettings: { cloneTemplate: '~/src/{repo}@{owner}', additionalSrcDirs: '~/.local/src' },
    });
    write(join(home, '.local/share/fnrhombus/host-aliases.json'), { 'github.com': 'gh' });
    const settings = loadLocateSettings({ home, cwd, ...hermetic });
    expect(settings.cloneTemplate).toBe('~/src/{repo}@{owner}');
    expect(settings.worktreeTemplate).toBe('');
    expect(settings.additionalSrcDirs).toEqual(['~/.local/src']);
    expect(settings.hostAliases).toEqual({ 'github.com': 'gh' });
  });

  test('the project tier overrides the user tier, and local overrides project', () => {
    const home = join(tmpRoot, 'home');
    const cwd = join(tmpRoot, 'project');
    write(join(home, '.claude/settings.json'), { repoSettings: { cloneTemplate: 'user-tpl' } });
    write(join(cwd, '.claude/settings.json'), { repoSettings: { cloneTemplate: 'project-tpl' } });
    expect(loadLocateSettings({ home, cwd, ...hermetic }).cloneTemplate).toBe('project-tpl');
    write(join(cwd, '.claude/settings.local.json'), { repoSettings: { cloneTemplate: 'local-tpl' } });
    expect(loadLocateSettings({ home, cwd, ...hermetic }).cloneTemplate).toBe('local-tpl');
  });

  test('the injected managed tier outranks the local tier', () => {
    const home = join(tmpRoot, 'home');
    const cwd = join(tmpRoot, 'project');
    write(join(cwd, '.claude/settings.local.json'), { repoSettings: { cloneTemplate: 'local-tpl' } });
    write(hermetic.managedPath, { repoSettings: { cloneTemplate: 'managed-tpl' } });
    expect(loadLocateSettings({ home, cwd, ...hermetic }).cloneTemplate).toBe('managed-tpl');
  });

  test('the injected system host-aliases file is read, the user file winning on conflict', () => {
    const home = join(tmpRoot, 'home');
    const cwd = join(tmpRoot, 'project');
    mkdirSync(cwd, { recursive: true });
    write(hermetic.systemAliasesPath, { 'github.com': 'gh-sys', 'gitlab.com': 'gl' });
    write(join(home, '.local/share/fnrhombus/host-aliases.json'), { 'github.com': 'gh-user' });
    expect(loadLocateSettings({ home, cwd, ...hermetic }).hostAliases).toEqual({ 'github.com': 'gh-user',
      'gitlab.com': 'gl' });
  });

  test('nothing configured anywhere → empty settings rather than a throw', () => {
    const home = join(tmpRoot, 'bare-home');
    const cwd = join(tmpRoot, 'bare-project');
    mkdirSync(home);
    mkdirSync(cwd);
    const settings = loadLocateSettings({ home, cwd, ...hermetic });
    expect(settings.cloneTemplate).toBe('');
    expect(settings.worktreeTemplate).toBe('');
    expect(settings.additionalSrcDirs).toEqual([]);
    expect(settings.hostAliases).toEqual({});
  });
});
