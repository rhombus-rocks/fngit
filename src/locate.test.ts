import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GhApiResult, GhCloneResult, IGitHubCli } from './IGitHubCli.js';
import { locate, type LocateOptions } from './locate.js';
import { LocateError } from './LocateError.js';

let tmpRoot: string;
let HOME: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'fngit-locate-'));
  HOME = join(tmpRoot, 'home');
  mkdirSync(HOME);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

interface FakeGhLog {
  api: string[];
  clone: Array<{ url: string; destination: string; extraGitArgs?: readonly string[]; }>;
}

function fakeGh(apiTable: Record<string, GhApiResult> = {}, cloneResult: GhCloneResult = { ok: true }): IGitHubCli & {
  log: FakeGhLog;
} {
  const log: FakeGhLog = { api: [], clone: [] };
  return { log, api: async (path: string) => {
    log.api.push(path);
    return apiTable[path] ?? { ok: false, status: 404, error: 'Not Found' };
  }, clone: async (url, destination, extraGitArgs) => {
    log.clone.push({ url, destination, extraGitArgs });
    return cloneResult;
  } };
}

function options(overrides: Partial<LocateOptions> = {}): LocateOptions {
  return { home: HOME, gh: fakeGh(),
    settings: { cloneTemplate: '~/src/{repo}@{owner}', worktreeTemplate: '~/src/{repo}@{owner}+{input}',
      additionalSrcDirs: [], hostAliases: { 'github.com': 'gh' } }, ...overrides };
}

function mkdirp(...segments: string[]): string {
  const path = join(...segments);
  mkdirSync(path, { recursive: true });
  return path;
}

async function expectFailure(promise: Promise<unknown>): Promise<LocateError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LocateError);
    return error as LocateError;
  }
  throw new Error('test bug: expected the locate to reject');
}

describe('locate — a bare name settled on disk', () => {
  test('one clone under the clone template → local, with no gh call at all', async () => {
    const clone = mkdirp(HOME, 'src/fnclaude@fnclaude');
    const gh = fakeGh();
    const found = await locate('fnclaude', options({ gh }));
    expect(found).toEqual({ type: 'local', path: clone, ref: expect.objectContaining({ name: 'fnclaude' }) });
    expect(gh.log.api).toEqual([]);
  });

  test('the +workspace suffix rides through untouched', async () => {
    const clone = mkdirp(HOME, 'src/fnclaude@fnclaude');
    const found = await locate('fnclaude+feat-x', options());
    expect(found.type).toBe('local');
    expect(found.ref.workspace).toBe('feat-x');
    if (found.type === 'local') {
      expect(found.path).toBe(clone);
    }
  });

  test('a worktree sibling never counts as a second clone', async () => {
    const clone = mkdirp(HOME, 'src/fnclaude@fnclaude');
    mkdirp(HOME, 'src/fnclaude@fnclaude+feat-renderer');
    const found = await locate('fnclaude', options());
    expect(found).toMatchObject({ type: 'local', path: clone });
  });

  test('a disk hit fills in the owner segment the scan recovered', async () => {
    mkdirp(HOME, 'src/fnclaude@fnclaude');
    expect((await locate('fnclaude', options())).ref.owner).toBe('fnclaude');
  });

  test('found only in an extra source root → local there, still no gh call', async () => {
    const checkout = mkdirp(HOME, '.local/src/runtime@dotnet');
    const gh = fakeGh();
    const found = await locate('runtime',
      options({ gh,
        settings: { cloneTemplate: '~/src/{repo}@{owner}', worktreeTemplate: '~/src/{repo}@{owner}+{input}',
          additionalSrcDirs: ['~/.local/src'], hostAliases: { 'github.com': 'gh' } } }));
    expect(found).toMatchObject({ type: 'local', path: checkout });
    expect(gh.log.api).toEqual([]);
  });

  test('found via an extra root fills in the owner segment the scan recovered', async () => {
    const checkout = mkdirp(HOME, '.local/src/runtime@dotnet');
    const found = await locate('runtime',
      options({
        settings: { cloneTemplate: '~/src/{repo}@{owner}', worktreeTemplate: '~/src/{repo}@{owner}+{input}',
          additionalSrcDirs: ['~/.local/src'], hostAliases: { 'github.com': 'gh' } },
      }));
    expect(found).toMatchObject({ type: 'local', path: checkout, ref: expect.objectContaining({ owner: 'dotnet' }) });
  });

  test('the clone template root outranks the extra roots', async () => {
    const clone = mkdirp(HOME, 'src/runtime@dotnet');
    mkdirp(HOME, '.local/src/runtime@microsoft');
    const found = await locate('runtime',
      options({
        settings: { cloneTemplate: '~/src/{repo}@{owner}', worktreeTemplate: '~/src/{repo}@{owner}+{input}',
          additionalSrcDirs: ['~/.local/src'], hostAliases: { 'github.com': 'gh' } },
      }));
    expect(found).toMatchObject({ type: 'local', path: clone });
  });
});

describe('locate — a resolved owner', () => {
  test('the destination already exists → local', async () => {
    const clone = mkdirp(HOME, 'src/arch-setup@fnrhombus');
    expect(await locate('fnrhombus/arch-setup', options())).toMatchObject({ type: 'local', path: clone });
  });

  test('the name@owner form resolves to the same destination', async () => {
    const clone = mkdirp(HOME, 'src/arch-setup@fnrhombus');
    expect(await locate('arch-setup@fnrhombus', options())).toMatchObject({ type: 'local', path: clone });
  });

  test('nothing on disk → remote, carrying the URL and the destination', async () => {
    const found = await locate('fnrhombus/arch-setup', options());
    expect(found).toEqual({ type: 'remote', url: 'https://github.com/fnrhombus/arch-setup.git',
      destination: join(HOME, 'src/arch-setup@fnrhombus'),
      ref: expect.objectContaining({ owner: 'fnrhombus', name: 'arch-setup' }) });
  });

  test('a full URL keeps its host', async () => {
    const found = await locate('https://gitlab.com/org/thing', options());
    expect(found).toMatchObject({ type: 'remote', url: 'https://gitlab.com/org/thing.git',
      destination: join(HOME, 'src/thing@org') });
  });

  test('the scp-style form derives an https URL', async () => {
    expect(await locate('git@gitlab.com:org/thing', options())).toMatchObject({
      url: 'https://gitlab.com/org/thing.git',
    });
  });

  test('the gh: shorthand pins github.com', async () => {
    expect(await locate('gh:fnrhombus/arch-setup', options())).toMatchObject({
      url: 'https://github.com/fnrhombus/arch-setup.git',
    });
  });

  test('a workspace rides through without moving the destination', async () => {
    const found = await locate('fnrhombus/arch-setup+my-feature', options());
    expect(found.ref.workspace).toBe('my-feature');
    if (found.type === 'remote') {
      expect(found.destination).toBe(join(HOME, 'src/arch-setup@fnrhombus'));
    }
  });

  test('an extra source root is the last chance before a clone', async () => {
    const checkout = mkdirp(HOME, '.local/src/runtime@dotnet');
    const found = await locate('dotnet/runtime',
      options({
        settings: { cloneTemplate: '~/src/{repo}@{owner}', worktreeTemplate: '~/src/{repo}@{owner}+{input}',
          additionalSrcDirs: ['~/.local/src'], hostAliases: { 'github.com': 'gh' } },
      }));
    expect(found).toMatchObject({ type: 'local', path: checkout });
  });

  test("a resolved owner never lands in another owner's checkout", async () => {
    mkdirp(HOME, '.local/src/runtime@microsoft');
    const found = await locate('dotnet/runtime',
      options({
        settings: { cloneTemplate: '~/src/{repo}@{owner}', worktreeTemplate: '~/src/{repo}@{owner}+{input}',
          additionalSrcDirs: ['~/.local/src'], hostAliases: { 'github.com': 'gh' } },
      }));
    expect(found).toMatchObject({ type: 'remote', destination: join(HOME, 'src/runtime@dotnet') });
  });
});

describe('locate — the owner lookup', () => {
  test('a bare name the user owns resolves and fills the owner in', async () => {
    const gh = fakeGh({ user: { ok: true, body: 'fnrhombus\n' }, '/user/orgs': { ok: true, body: 'anthropics\n' },
      'repos/fnrhombus/arch-setup': { ok: true, body: '{}' } });
    const found = await locate('arch-setup', options({ gh }));
    expect(found).toMatchObject({ type: 'remote', url: 'https://github.com/fnrhombus/arch-setup.git',
      destination: join(HOME, 'src/arch-setup@fnrhombus') });
    expect(found.ref.owner).toBe('fnrhombus');
  });

  test('a looked-up owner whose destination exists comes back local', async () => {
    const clone = mkdirp(HOME, 'src/arch-setup@anthropics');
    const gh = fakeGh({ user: { ok: true, body: 'fnrhombus\n' }, '/user/orgs': { ok: true, body: 'anthropics\n' },
      'repos/anthropics/arch-setup': { ok: true, body: '{}' } });
    expect(await locate('arch-setup', options({ gh }))).toMatchObject({ type: 'local', path: clone });
  });
});

describe('locate — cloning on demand', () => {
  test('a remote result is cloned to its destination and comes back local', async () => {
    const gh = fakeGh();
    const found = await locate('fnrhombus/arch-setup', { ...options({ gh }), clone: true });
    expect(found).toEqual({ type: 'local', path: join(HOME, 'src/arch-setup@fnrhombus'),
      ref: expect.objectContaining({ owner: 'fnrhombus' }) });
    expect(gh.log.clone).toEqual([{ url: 'https://github.com/fnrhombus/arch-setup.git',
      destination: join(HOME, 'src/arch-setup@fnrhombus'), extraGitArgs: undefined }]);
    expect(existsSync(join(HOME, 'src'))).toBe(true);
  });

  test('extra git arguments reach gh', async () => {
    const gh = fakeGh();
    await locate('fnrhombus/arch-setup', { ...options({ gh }), clone: true, cloneArgs: ['--depth', '1'] });
    expect(gh.log.clone[0]?.extraGitArgs).toEqual(['--depth', '1']);
  });

  test('an already-local result is returned without cloning', async () => {
    const clone = mkdirp(HOME, 'src/arch-setup@fnrhombus');
    const gh = fakeGh();
    const found = await locate('fnrhombus/arch-setup', { ...options({ gh }), clone: true });
    expect(found).toMatchObject({ type: 'local', path: clone });
    expect(gh.log.clone).toEqual([]);
  });

  test('a failed clone rejects with the URL, destination and stderr', async () => {
    const gh = fakeGh({}, { ok: false, error: 'gh exited 1', stderr: 'fatal: could not read Username' });
    const error = await expectFailure(locate('fnrhombus/arch-setup', { ...options({ gh }), clone: true }));
    expect(error.failure).toEqual({ reason: 'clone-failed', ref: expect.objectContaining({ owner: 'fnrhombus' }),
      url: 'https://github.com/fnrhombus/arch-setup.git', destination: join(HOME, 'src/arch-setup@fnrhombus'),
      stderr: 'fatal: could not read Username', repoNotFound: false });
  });

  test('a clone failing because the repo does not exist is flagged as such', async () => {
    const gh = fakeGh({}, { ok: false, error: 'gh exited 1',
      stderr: "GraphQL: Could not resolve to a Repository with the name 'fnrhombus/arch-setup'." });
    const error = await expectFailure(locate('fnrhombus/arch-setup', { ...options({ gh }), clone: true }));
    expect(error.failure).toMatchObject({ reason: 'clone-failed', repoNotFound: true });
  });
});

describe('locate — failures', () => {
  test('an unparseable reference', async () => {
    const error = await expectFailure(locate('a/b/c', options()));
    expect(error.failure).toMatchObject({ reason: 'unparseable', input: 'a/b/c' });
    expect(error.message).toMatch(/ambiguous|unparseable/);
  });

  test('an empty workspace suffix is a parse failure', async () => {
    const error = await expectFailure(locate('arch-setup+', options()));
    expect(error.failure.reason).toBe('unparseable');
    expect(error.message).toMatch(/empty workspace/);
  });

  test('no cloneTemplate configured', async () => {
    const error = await expectFailure(locate('fnrhombus/arch-setup', options({ settings: { cloneTemplate: '' } })));
    expect(error.failure.reason).toBe('config');
    expect(error.message).toContain('cloneTemplate');
  });

  test('a template referencing a host with no alias', async () => {
    const error = await expectFailure(
      locate('org/name',
        options({ settings: { cloneTemplate: '~/src/{host-short}/{owner}/{repo}', hostAliases: {} } })),
    );
    expect(error.failure.reason).toBe('config');
    expect(error.message).toContain('github.com');
  });

  test('a template with an unknown placeholder', async () => {
    const error = await expectFailure(locate('org/name', options({ settings: { cloneTemplate: '~/src/{bogus}' } })));
    expect(error.failure.reason).toBe('config');
    expect(error.message).toContain('{bogus}');
  });

  test('a bare name with a broken cloneTemplate fails config before any gh call', async () => {
    const gh = fakeGh();
    const error = await expectFailure(
      locate('arch-setup', options({ gh, settings: { cloneTemplate: '~/src/{bogus}' } })),
    );
    expect(error.failure.reason).toBe('config');
    expect(error.message).toContain('{bogus}');
    expect(gh.log.api).toEqual([]);
  });

  test('an empty cloneTemplate is config for a bare name too, before any gh call', async () => {
    const gh = fakeGh();
    const error = await expectFailure(locate('arch-setup', options({ gh, settings: { cloneTemplate: '' } })));
    expect(error.failure.reason).toBe('config');
    expect(gh.log.api).toEqual([]);
  });

  test('the gh lookup failing outright', async () => {
    const gh = fakeGh({ user: { ok: false, status: 401, error: 'not logged in' } });
    const error = await expectFailure(locate('arch-setup', options({ gh })));
    expect(error.failure.reason).toBe('gh-failed');
    expect(error.message).toMatch(/gh auth login/);
  });

  test('no owner has the repo', async () => {
    const gh = fakeGh({ user: { ok: true, body: 'me\n' }, '/user/orgs': { ok: true, body: 'orgA\n' } });
    const error = await expectFailure(locate('arch-setup', options({ gh })));
    expect(error.failure).toMatchObject({ reason: 'not-found' });
    expect(error.message).toContain('no repo named "arch-setup"');
  });

  test('several owners have the repo', async () => {
    const gh = fakeGh({ user: { ok: true, body: 'me\n' }, '/user/orgs': { ok: true, body: 'orgA\n' },
      'repos/me/dupe': { ok: true, body: '{}' }, 'repos/orgA/dupe': { ok: true, body: '{}' } });
    const error = await expectFailure(locate('dupe', options({ gh })));
    expect(error.failure).toMatchObject({ reason: 'ambiguous-owner', owners: ['me', 'orgA'] });
    expect(error.message).toContain('me/dupe');
    expect(error.message).toContain('orgA/dupe');
  });

  test('two clones on disk under different owners', async () => {
    mkdirp(HOME, 'src/fnclaude@fnclaude');
    mkdirp(HOME, 'src/fnclaude@fnrhombus');
    const error = await expectFailure(locate('fnclaude', options()));
    expect(error.failure.reason).toBe('ambiguous-local');
    if (error.failure.reason === 'ambiguous-local') {
      expect([...error.failure.paths].sort()).toEqual(
        [join(HOME, 'src/fnclaude@fnclaude'), join(HOME, 'src/fnclaude@fnrhombus')].sort(),
      );
    }
    expect(error.message).toContain('fnclaude');
  });

  test('two checkouts under different owners inside one extra root', async () => {
    mkdirp(HOME, '.local/src/runtime@dotnet');
    mkdirp(HOME, '.local/src/runtime@microsoft');
    const error = await expectFailure(
      locate('runtime',
        options({
          settings: { cloneTemplate: '~/src/{repo}@{owner}', worktreeTemplate: '~/src/{repo}@{owner}+{input}',
            additionalSrcDirs: ['~/.local/src'], hostAliases: { 'github.com': 'gh' } },
        })),
    );
    expect(error.failure.reason).toBe('ambiguous-local');
  });

  test('LocateError is a real Error, named, carrying its failure', async () => {
    const error = await expectFailure(locate('', options()));
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('LocateError');
    expect(error.failure.reason).toBe('unparseable');
  });
});
