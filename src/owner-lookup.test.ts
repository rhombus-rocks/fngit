import type { Func } from '@rhombus-toolkit/types';
import { describe, expect, test } from 'bun:test';

import type { GhApiResult } from './IGitHubCli.js';
import { findOwner } from './owner-lookup.js';

type GhApiCall = Func<[string], Promise<GhApiResult>>;

function makeApi(table: Record<string, GhApiResult>): GhApiCall {
  return async (path: string) => table[path] ?? { ok: false, status: 404, error: 'not in mock table' };
}

describe('findOwner — happy path', () => {
  test('the authenticated user owns the repo → their login wins', async () => {
    const result = await findOwner({ name: 'myrepo',
      api: makeApi({ user: { ok: true, body: 'fnrhombus\n' }, '/user/orgs': { ok: true, body: 'anthropics\nopenai\n' },
        'repos/fnrhombus/myrepo': { ok: true, body: '{"id":1}' } }) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.owner).toBe('fnrhombus');
    }
  });

  test('the user does not own it → the matching org wins', async () => {
    const result = await findOwner({ name: 'coolthing',
      api: makeApi({ user: { ok: true, body: 'fnrhombus\n' }, '/user/orgs': { ok: true, body: 'anthropics\nopenai\n' },
        'repos/anthropics/coolthing': { ok: true, body: '{"id":2}' } }) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.owner).toBe('anthropics');
    }
  });

  test('candidates are probed user-first, then orgs in API order', async () => {
    const calls: string[] = [];
    const result = await findOwner({ name: 'x', api: async (path: string) => {
      calls.push(path);
      if (path === 'user') {
        return { ok: true, body: 'me\n' };
      }
      if (path === '/user/orgs') {
        return { ok: true, body: 'orgA\norgB\n' };
      }
      if (path === 'repos/orgB/x') {
        return { ok: true, body: '{}' };
      }
      return { ok: false, status: 404, error: 'not found' };
    } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.owner).toBe('orgB');
    }
    expect(calls).toEqual(['user', '/user/orgs', 'repos/me/x', 'repos/orgA/x', 'repos/orgB/x']);
  });

  test('the candidate probes fire concurrently, not one round-trip at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probed: string[] = [];
    const pending = findOwner({ name: 'x', api: async (path: string) => {
      if (path === 'user') {
        return { ok: true, body: 'me\n' };
      }
      if (path === '/user/orgs') {
        return { ok: true, body: 'orgA\norgB\n' };
      }
      probed.push(path);
      await gate;
      return { ok: false, status: 404, error: 'nope' };
    } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // All three probes are in flight before any resolves; a sequential loop
    // would have dispatched only the first.
    expect(probed.sort()).toEqual(['repos/me/x', 'repos/orgA/x', 'repos/orgB/x']);
    release();
    await pending;
  });
});

describe('findOwner — ambiguity', () => {
  test('two orgs both have it → ambiguous, listing both', async () => {
    const result = await findOwner({ name: 'dupe',
      api: makeApi({ user: { ok: true, body: 'fnrhombus\n' }, '/user/orgs': { ok: true, body: 'anthropics\nopenai\n' },
        'repos/anthropics/dupe': { ok: true, body: '{"id":1}' },
        'repos/openai/dupe': { ok: true, body: '{"id":2}' } }) });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'ambiguous') {
      expect(result.owners).toEqual(['anthropics', 'openai']);
    }
  });

  test('the user and an org both have it → the user is listed first', async () => {
    const result = await findOwner({ name: 'x',
      api: makeApi({ user: { ok: true, body: 'me\n' }, '/user/orgs': { ok: true, body: 'orgA\norgB\n' },
        'repos/me/x': { ok: true, body: '{}' }, 'repos/orgB/x': { ok: true, body: '{}' } }) });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'ambiguous') {
      expect(result.owners).toEqual(['me', 'orgB']);
    }
  });
});

describe('findOwner — failure paths', () => {
  test('the user call failing with no other candidates → gh-failed', async () => {
    const result = await findOwner({ name: 'x',
      api: makeApi({ user: { ok: false, status: 401, error: 'not logged in' } }) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('gh-failed');
    }
  });

  test('the orgs call failing still probes the user', async () => {
    const result = await findOwner({ name: 'x',
      api: makeApi({ user: { ok: true, body: 'me\n' }, '/user/orgs': { ok: false, status: 500, error: 'srv err' },
        'repos/me/x': { ok: true, body: '{}' } }) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.owner).toBe('me');
    }
  });

  test('no candidate has the repo → not-found', async () => {
    const result = await findOwner({ name: 'nothere',
      api: makeApi({ user: { ok: true, body: 'me\n' }, '/user/orgs': { ok: true, body: 'orgA\norgB\n' } }) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not-found');
    }
  });

  test('an empty user login with no orgs → gh-failed, since there is nothing to probe', async () => {
    const result = await findOwner({ name: 'x',
      api: makeApi({ user: { ok: true, body: '\n' }, '/user/orgs': { ok: false, status: 500, error: 'srv err' } }) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('gh-failed');
    }
  });
});

describe('findOwner — parsing', () => {
  test('blank lines and carriage returns are filtered out of the org list', async () => {
    const result = await findOwner({ name: 'x',
      api: makeApi({ user: { ok: true, body: 'me\n' }, '/user/orgs': { ok: true, body: '\norgA\r\n\norgB\n\n' },
        'repos/orgB/x': { ok: true, body: '{}' } }) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.owner).toBe('orgB');
    }
  });
});
