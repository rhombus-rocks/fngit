import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findLocalClones, type FindLocalClonesArgs, type FindLocalClonesResult } from './local-clones.js';

let tmpRoot: string;
let HOME: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'fngit-local-clones-'));
  HOME = join(tmpRoot, 'home');
  mkdirSync(HOME);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function args(overrides: Partial<FindLocalClonesArgs> = {}): FindLocalClonesArgs {
  return { name: 'fnclaude', template: '~/src/{repo}@{owner}', worktreeTemplate: '~/src/{repo}@{owner}+{input}',
    host: 'github.com', hostAliases: { 'github.com': 'gh' }, home: HOME, ...overrides };
}

function assertPaths(result: FindLocalClonesResult): string[] {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('test bug: expected ok');
  }
  return [...result.paths].sort();
}

function mkdirp(...segments: string[]): string {
  const path = join(...segments);
  mkdirSync(path, { recursive: true });
  return path;
}

describe('findLocalClones — the owner wildcard', () => {
  test('one clone → exactly that path', () => {
    const clone = mkdirp(HOME, 'src/fnclaude@fnclaude');
    expect(assertPaths(findLocalClones(args()))).toEqual([clone]);
  });

  test('two owners → both paths, for the caller to call ambiguous', () => {
    mkdirp(HOME, 'src/fnclaude@fnclaude');
    mkdirp(HOME, 'src/fnclaude@fnrhombus');
    expect(assertPaths(findLocalClones(args()))).toEqual(
      [join(HOME, 'src/fnclaude@fnclaude'), join(HOME, 'src/fnclaude@fnrhombus')].sort(),
    );
  });

  test('a different repo name in the same directory is not a match', () => {
    mkdirp(HOME, 'src/other@fnclaude');
    expect(assertPaths(findLocalClones(args()))).toEqual([]);
  });

  test('a missing scan directory → no matches, not an error', () => {
    expect(assertPaths(findLocalClones(args()))).toEqual([]);
  });

  test('a template nesting by host resolves the concrete parent directory', () => {
    const clone = mkdirp(HOME, 'src/gh/fnclaude@fnclaude');
    const found = assertPaths(findLocalClones(args({ template: '~/src/{host-short}/{repo}@{owner}' })));
    expect(found).toEqual([clone]);
  });

  test('a template whose {owner} is above the last segment has nothing to enumerate', () => {
    mkdirp(HOME, 'src/fnclaude/fnclaude');
    expect(assertPaths(findLocalClones(args({ template: '~/src/{owner}/{repo}' })))).toEqual([]);
  });
});

describe('findLocalClones — worktree siblings are excluded', () => {
  test('a clone plus its + worktree resolves to the one clone', () => {
    const clone = mkdirp(HOME, 'src/fnclaude@fnclaude');
    mkdirp(HOME, 'src/fnclaude@fnclaude+feat-renderer');
    expect(assertPaths(findLocalClones(args()))).toEqual([clone]);
  });

  test('the marker comes from the configured worktreeTemplate, not a hardcoded +', () => {
    const clone = mkdirp(HOME, 'src/fnclaude@fnclaude');
    mkdirp(HOME, 'src/fnclaude@fnclaude--wt--feat-renderer');
    const found = assertPaths(findLocalClones(args({ worktreeTemplate: '~/src/{repo}@{owner}--wt--{input}' })));
    expect(found).toEqual([clone]);
  });

  test('an absent worktreeTemplate still excludes + siblings', () => {
    const clone = mkdirp(HOME, 'src/fnclaude@fnclaude');
    mkdirp(HOME, 'src/fnclaude@fnclaude+feat-renderer');
    expect(assertPaths(findLocalClones(args({ worktreeTemplate: undefined })))).toEqual([clone]);
  });
});

describe('findLocalClones — degenerate templates', () => {
  test('a template with no {owner} has nothing to enumerate', () => {
    mkdirp(HOME, 'src/fnclaude');
    expect(assertPaths(findLocalClones(args({ template: '~/src/{repo}' })))).toEqual([]);
  });

  test('an empty template has nothing to enumerate', () => {
    expect(assertPaths(findLocalClones(args({ template: '' })))).toEqual([]);
  });

  test('an unknown placeholder surfaces the template error', () => {
    const result = findLocalClones(args({ template: '~/src/{nope}/{repo}@{owner}' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('{nope}');
    }
  });

  test('a missing host-short alias surfaces the template error', () => {
    const result = findLocalClones(args({ template: '~/src/{host-short}/{repo}@{owner}', hostAliases: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('github.com');
    }
  });
});

describe('findLocalClones — injectable seams', () => {
  test('readdir replaces the real directory listing', () => {
    const found = assertPaths(
      findLocalClones(args({ readdir: (dir) => (dir === join(HOME, 'src') ? ['fnclaude@dotnet', 'unrelated'] : []) })),
    );
    expect(found).toEqual([join(HOME, 'src/fnclaude@dotnet')]);
  });

  test('scanRoot re-roots the template last segment into another directory', () => {
    const found = assertPaths(
      findLocalClones(
        args({ scanRoot: '/virtual/extra', readdir: (dir) => (dir === '/virtual/extra' ? ['fnclaude@dotnet'] : []) }),
      ),
    );
    expect(found).toEqual(['/virtual/extra/fnclaude@dotnet']);
  });

  test('a scanRoot with the owner above the last segment has nothing to enumerate', () => {
    const found = assertPaths(
      findLocalClones(
        args({ template: '~/src/{owner}/{repo}', scanRoot: '/virtual/extra', readdir: () => ['fnclaude'] }),
      ),
    );
    expect(found).toEqual([]);
  });
});
