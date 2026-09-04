import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildCloneUrl, cloneRepo, computeCloneDestination, isRepoNotFoundError } from './clone.js';
import type { GhApiResult, GhCloneResult, IGitHubCli } from './IGitHubCli.js';
import type { RepoRef } from './RepoRef.js';

function ref(partial: Partial<RepoRef> = {}): RepoRef {
  return { host: 'github.com', owner: 'fnrhombus', name: 'arch-setup', workspace: '', original: 'arch-setup@fnrhombus',
    ...partial };
}

function fakeGh(result: GhCloneResult,
  capture?: { url?: string; destination?: string; args?: readonly string[]; }): IGitHubCli
{
  return { api: async (): Promise<GhApiResult> => ({ ok: false, status: 404, error: 'unused' }),
    clone: async (url, destination, extraGitArgs) => {
      if (capture !== undefined) {
        capture.url = url;
        capture.destination = destination;
        capture.args = extraGitArgs;
      }
      return result;
    } };
}

describe('buildCloneUrl', () => {
  test('github.com → an https URL with the .git suffix', () => {
    expect(buildCloneUrl(ref())).toBe('https://github.com/fnrhombus/arch-setup.git');
  });

  test('another host is honoured', () => {
    expect(buildCloneUrl(ref({ host: 'gitlab.com', owner: 'org', name: 'thing' }))).toBe(
      'https://gitlab.com/org/thing.git',
    );
  });

  test('an empty host defaults to github.com', () => {
    expect(buildCloneUrl(ref({ host: '' }))).toBe('https://github.com/fnrhombus/arch-setup.git');
  });

  test('an empty owner throws — the caller resolves the owner first', () => {
    expect(() => buildCloneUrl(ref({ owner: '' }))).toThrow(/owner/);
  });

  test('an empty name throws', () => {
    expect(() => buildCloneUrl(ref({ name: '' }))).toThrow(/name/);
  });
});

describe('computeCloneDestination', () => {
  const HOME = '/home/tom';
  const ALIASES = { 'github.com': 'gh', 'gitlab.com': 'gl' };

  test('a template using host-short, owner and repo', () => {
    expect(
      computeCloneDestination({ ref: ref(), template: '~/src/{host-short}/{owner}/{repo}', hostAliases: ALIASES,
        home: HOME }),
    ).toEqual({ ok: true, path: join(HOME, 'src/gh/fnrhombus/arch-setup') });
  });

  test('a {repo}@{owner} template', () => {
    expect(computeCloneDestination({ ref: ref(), template: '~/src/{repo}@{owner}', hostAliases: ALIASES, home: HOME }))
      .toEqual({ ok: true, path: join(HOME, 'src/arch-setup@fnrhombus') });
  });

  test('a template without a tilde is left absolute as written', () => {
    expect(
      computeCloneDestination({ ref: ref(), template: '/srv/repos/{owner}/{repo}', hostAliases: ALIASES, home: HOME }),
    ).toEqual({ ok: true, path: '/srv/repos/fnrhombus/arch-setup' });
  });

  test('a host-short miss surfaces the template error naming the host', () => {
    const result = computeCloneDestination({ ref: ref({ host: 'codeberg.org' }),
      template: '~/src/{host-short}/{owner}/{repo}', hostAliases: ALIASES, home: HOME });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('codeberg.org');
    }
  });

  test('an unknown placeholder errors', () => {
    const result = computeCloneDestination({ ref: ref(), template: '~/src/{bogus}', hostAliases: ALIASES, home: HOME });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('{bogus}');
    }
  });

  test('an empty host on the ref defaults to github.com for host-plain', () => {
    expect(
      computeCloneDestination({ ref: ref({ host: '' }), template: '~/{host-plain}/{owner}/{repo}', hostAliases: ALIASES,
        home: HOME }),
    ).toEqual({ ok: true, path: join(HOME, 'github/fnrhombus/arch-setup') });
  });

  test('a workspace on the ref never reaches the destination', () => {
    expect(
      computeCloneDestination({ ref: ref({ workspace: 'my-feature' }), template: '~/src/{repo}@{owner}',
        hostAliases: ALIASES, home: HOME }),
    ).toEqual({ ok: true, path: join(HOME, 'src/arch-setup@fnrhombus') });
  });
});

describe('cloneRepo', () => {
  test('forwards url and destination, succeeding when gh does', async () => {
    const capture: { url?: string; destination?: string; } = {};
    const result = await cloneRepo({ url: 'https://github.com/anthropics/cool.git',
      destination: '/home/u/src/cool@anthropics', gh: fakeGh({ ok: true }, capture), mkdirp: async () => {} });
    expect(result.ok).toBe(true);
    expect(capture.url).toBe('https://github.com/anthropics/cool.git');
    expect(capture.destination).toBe('/home/u/src/cool@anthropics');
  });

  test('extra git arguments reach gh', async () => {
    const capture: { args?: readonly string[]; } = {};
    await cloneRepo({ url: 'https://github.com/x/y.git', destination: '/tmp/y@x', gh: fakeGh({ ok: true }, capture),
      cloneArgs: ['--depth', '1'], mkdirp: async () => {} });
    expect(capture.args).toEqual(['--depth', '1']);
  });

  test('the parent directory is created before the clone runs', async () => {
    let parentCreated = '';
    const result = await cloneRepo({ url: 'https://github.com/x/y.git', destination: '/home/u/deep/nested/y@x',
      gh: fakeGh({ ok: true }), mkdirp: async (path: string) => {
        parentCreated = path;
      } });
    expect(result.ok).toBe(true);
    expect(parentCreated).toBe('/home/u/deep/nested');
  });

  test('a gh failure carries its error and stderr through', async () => {
    const result = await cloneRepo({ url: 'https://github.com/x/y.git', destination: '/tmp/y@x',
      gh: fakeGh({ ok: false, error: 'gh exited 1', stderr: 'gh auth login' }), mkdirp: async () => {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('gh exited 1');
      expect(result.stderr).toContain('gh auth login');
    }
  });

  test('a mkdirp failure fails the clone without attempting it', async () => {
    let cloneCalled = false;
    const gh: IGitHubCli = { api: async (): Promise<GhApiResult> => ({ ok: false, status: 404, error: 'unused' }),
      clone: async () => {
        cloneCalled = true;
        return { ok: true };
      } };
    const result = await cloneRepo({ url: 'https://github.com/x/y.git', destination: '/tmp/y@x', gh,
      mkdirp: async () => {
        throw new Error('permission denied');
      } });
    expect(result.ok).toBe(false);
    expect(cloneCalled).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('permission denied');
    }
  });
});

describe('isRepoNotFoundError', () => {
  test('true for the GraphQL not-found signature', () => {
    expect(isRepoNotFoundError("GraphQL: Could not resolve to a Repository with the name 'rhombus-toolkit/ioc'.")).toBe(
      true,
    );
  });

  test('true for "Repository not found"', () => {
    expect(isRepoNotFoundError('remote: Repository not found.')).toBe(true);
    expect(isRepoNotFoundError('Repository not found')).toBe(true);
  });

  test('false for an auth failure', () => {
    expect(isRepoNotFoundError('To get started with GitHub CLI, please run: gh auth login')).toBe(false);
  });

  test('false for a network failure', () => {
    expect(isRepoNotFoundError('dial tcp: lookup api.github.com: no such host')).toBe(false);
  });

  test('false for empty stderr', () => {
    expect(isRepoNotFoundError('')).toBe(false);
  });
});
