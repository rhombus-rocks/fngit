import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findLocalClones, type FindLocalClonesArgs, type FindLocalClonesResult,
  type LocalClone } from './local-clones.js';

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

function assertClones(result: FindLocalClonesResult): LocalClone[] {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('test bug: expected ok');
  }
  return [...result.clones].sort((a, b) => a.path.localeCompare(b.path));
}

function assertPaths(result: FindLocalClonesResult): string[] {
  return assertClones(result).map((clone) => clone.path);
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

  test('each hit carries the owner segment the scan recovered', () => {
    mkdirp(HOME, 'src/fnclaude@fnclaude');
    mkdirp(HOME, 'src/fnclaude@fnrhombus');
    expect(assertClones(findLocalClones(args()))).toEqual([{ path: join(HOME, 'src/fnclaude@fnclaude'),
      owner: 'fnclaude' }, { path: join(HOME, 'src/fnclaude@fnrhombus'), owner: 'fnrhombus' }]);
  });

  test('a different repo name in the same directory is not a match', () => {
    mkdirp(HOME, 'src/other@fnclaude');
    expect(assertPaths(findLocalClones(args()))).toEqual([]);
  });

  test('a plain file with the clone shape is not a match', () => {
    mkdirp(HOME, 'src');
    writeFileSync(join(HOME, 'src/fnclaude@fnclaude'), 'x');
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

  test('a template whose {owner} sits above the last segment still resolves', () => {
    const clone = mkdirp(HOME, 'src/fnclaude/fnclaude');
    expect(assertPaths(findLocalClones(args({ template: '~/src/{owner}/{repo}' })))).toEqual([clone]);
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

describe('findLocalClones — the injectable glob seam', () => {
  test('expandGlob replaces the real filesystem glob', () => {
    const seen: string[] = [];
    const found = findLocalClones(args({ expandGlob: (pattern) => {
      seen.push(pattern);
      return [join(HOME, 'src/fnclaude@dotnet')];
    } }));
    expect(seen).toEqual([join(HOME, 'src/fnclaude@*')]);
    expect(assertClones(found)).toEqual([{ path: join(HOME, 'src/fnclaude@dotnet'), owner: 'dotnet' }]);
  });
});
