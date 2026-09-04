import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LocalClone } from './local-clones.js';
import { findInSrcDirs, type FindInSrcDirsArgs } from './src-dirs.js';

let tmpRoot: string;
let HOME: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'fngit-src-dirs-'));
  HOME = join(tmpRoot, 'home');
  mkdirSync(HOME);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function args(overrides: Partial<FindInSrcDirsArgs> = {}): FindInSrcDirsArgs {
  return { name: 'runtime', owner: null, srcDirs: ['~/extra'], cloneTemplate: '~/src/{repo}@{owner}',
    worktreeTemplate: '~/src/{repo}@{owner}+{input}', host: 'github.com', hostAliases: { 'github.com': 'gh' },
    home: HOME, ...overrides };
}

function mkdirp(...segments: string[]): string {
  const path = join(...segments);
  mkdirSync(path, { recursive: true });
  return path;
}

/** A rung-2 hit: a path plus the owner segment it recovered. */
function clone(path: string, owner: string): LocalClone {
  return { path, owner };
}

/** A rung-1 hit: a bare `<dir>/<name>` match, which carries no owner. */
function bareHit(path: string): LocalClone {
  return { path, owner: '' };
}

function byPath(a: LocalClone, b: LocalClone): number {
  return a.path.localeCompare(b.path);
}

describe('findInSrcDirs — the two rungs', () => {
  test('rung 1: a directory named exactly <name>', () => {
    const dir = mkdirp(HOME, 'extra/runtime');
    expect(findInSrcDirs(args())).toEqual([bareHit(dir)]);
  });

  test('rung 2: the cloneTemplate shape with {owner} wildcarded', () => {
    const dir = mkdirp(HOME, 'extra/runtime@dotnet');
    expect(findInSrcDirs(args())).toEqual([clone(dir, 'dotnet')]);
  });

  test('rung 1 outranks rung 2 inside the same directory', () => {
    const exact = mkdirp(HOME, 'extra/runtime');
    mkdirp(HOME, 'extra/runtime@dotnet');
    expect(findInSrcDirs(args())).toEqual([bareHit(exact)]);
  });

  test('a symlink to a checkout resolves', () => {
    const target = mkdirp(HOME, 'extra/dotnet-runtime');
    // 'junction' is ignored on POSIX but required on win32 for directory symlinks.
    symlinkSync(target, join(HOME, 'extra/runtime@dotnet'), 'junction');
    expect(findInSrcDirs(args())).toEqual([clone(join(HOME, 'extra/runtime@dotnet'), 'dotnet')]);
  });

  test('a different repo in the directory is not a match', () => {
    mkdirp(HOME, 'extra/other@dotnet');
    expect(findInSrcDirs(args())).toEqual([]);
  });

  test('a worktree sibling is excluded, leaving exactly one clone', () => {
    const dir = mkdirp(HOME, 'extra/runtime@dotnet');
    mkdirp(HOME, 'extra/runtime@dotnet+feat-x');
    expect(findInSrcDirs(args())).toEqual([clone(dir, 'dotnet')]);
  });

  test('two owners in one directory → both reported', () => {
    mkdirp(HOME, 'extra/runtime@dotnet');
    mkdirp(HOME, 'extra/runtime@microsoft');
    expect(findInSrcDirs(args()).sort(byPath)).toEqual(
      [clone(join(HOME, 'extra/runtime@dotnet'), 'dotnet'), clone(join(HOME, 'extra/runtime@microsoft'), 'microsoft')]
        .sort(byPath),
    );
  });
});

describe('findInSrcDirs — a resolved owner matches only its own', () => {
  test('the owner segment must be the resolved owner', () => {
    const dir = mkdirp(HOME, 'extra/runtime@dotnet');
    expect(findInSrcDirs(args({ owner: 'dotnet' }))).toEqual([clone(dir, 'dotnet')]);
  });

  test('another owner is never a match, so the search can never be ambiguous', () => {
    mkdirp(HOME, 'extra/runtime@dotnet');
    mkdirp(HOME, 'extra/runtime@microsoft');
    expect(findInSrcDirs(args({ owner: 'aspnet' }))).toEqual([]);
  });

  test('rung 1 still applies with an owner resolved', () => {
    const dir = mkdirp(HOME, 'extra/runtime');
    expect(findInSrcDirs(args({ owner: 'dotnet' }))).toEqual([bareHit(dir)]);
  });
});

describe('findInSrcDirs — directory order and misses', () => {
  test('directories are tried in array order; the first with a match wins', () => {
    mkdirp(HOME, 'first/runtime@dotnet');
    mkdirp(HOME, 'second/runtime@microsoft');
    expect(findInSrcDirs(args({ srcDirs: ['~/first', '~/second'] }))).toEqual([
      clone(join(HOME, 'first/runtime@dotnet'), 'dotnet'),
    ]);
    expect(findInSrcDirs(args({ srcDirs: ['~/second', '~/first'] }))).toEqual([
      clone(join(HOME, 'second/runtime@microsoft'), 'microsoft'),
    ]);
  });

  test('a non-existent entry is skipped silently, later entries still searched', () => {
    const dir = mkdirp(HOME, 'extra/runtime@dotnet');
    expect(findInSrcDirs(args({ srcDirs: ['/no/such/place', '~/extra'] }))).toEqual([clone(dir, 'dotnet')]);
  });

  test('a file where a directory was configured is skipped', () => {
    writeFileSync(join(HOME, 'notadir'), 'x');
    const dir = mkdirp(HOME, 'extra/runtime@dotnet');
    expect(findInSrcDirs(args({ srcDirs: ['~/notadir', '~/extra'] }))).toEqual([clone(dir, 'dotnet')]);
  });

  test('no entries configured → no search', () => {
    mkdirp(HOME, 'extra/runtime@dotnet');
    expect(findInSrcDirs(args({ srcDirs: [] }))).toEqual([]);
  });

  test('absolute entries work as well as ~-rooted ones', () => {
    const dir = mkdirp(HOME, 'extra/runtime@dotnet');
    expect(findInSrcDirs(args({ srcDirs: [join(HOME, 'extra')] }))).toEqual([clone(dir, 'dotnet')]);
  });
});

describe('findInSrcDirs — glob entries', () => {
  test('a glob expands to every directory it names, in sorted order', () => {
    mkdirp(HOME, 'cache/bbb/runtime@dotnet');
    mkdirp(HOME, 'cache/aaa/runtime@microsoft');
    expect(findInSrcDirs(args({ srcDirs: ['~/cache/*'] }))).toEqual([
      clone(join(HOME, 'cache/aaa/runtime@microsoft'), 'microsoft'),
    ]);
  });

  test('a glob matching nothing is skipped, later entries still searched', () => {
    const dir = mkdirp(HOME, 'extra/runtime@dotnet');
    expect(findInSrcDirs(args({ srcDirs: ['~/cache/*', '~/extra'] }))).toEqual([clone(dir, 'dotnet')]);
  });

  test('expandGlob feeds both the entry expansion and the clone-shape rung', () => {
    const seen: string[] = [];
    const found = findInSrcDirs(args({ srcDirs: ['~/cache/*'], expandGlob: (pattern) => {
      seen.push(pattern);
      if (pattern === join(HOME, 'cache/*')) {
        return [join(HOME, 'extra')];
      }
      if (pattern === join(HOME, 'extra/runtime@*')) {
        return [join(HOME, 'extra/runtime@dotnet')];
      }
      return [];
    } }));
    expect(seen).toEqual([join(HOME, 'cache/*'), join(HOME, 'extra/runtime@*')]);
    expect(found).toEqual([clone(join(HOME, 'extra/runtime@dotnet'), 'dotnet')]);
  });

  test('a literal src-dir entry is searched directly, only the clone-shape pattern is globbed', () => {
    const globbed: string[] = [];
    findInSrcDirs(args({ srcDirs: ['~/extra'], expandGlob: (pattern) => {
      globbed.push(pattern);
      return [];
    } }));
    expect(globbed).toEqual([join(HOME, 'extra/runtime@*')]);
  });
});

describe('findInSrcDirs — degenerate templates', () => {
  test('an empty cloneTemplate leaves rung 1 working and rung 2 silent', () => {
    const dir = mkdirp(HOME, 'extra/runtime');
    mkdirp(HOME, 'extra/runtime@dotnet');
    expect(findInSrcDirs(args({ cloneTemplate: '' }))).toEqual([bareHit(dir)]);
  });

  test('a cloneTemplate with no {owner} matches nothing on rung 2', () => {
    mkdirp(HOME, 'extra/runtime@dotnet');
    expect(findInSrcDirs(args({ cloneTemplate: '~/src/{repo}' }))).toEqual([]);
  });

  test('a cloneTemplate with an unknown placeholder matches nothing on rung 2', () => {
    mkdirp(HOME, 'extra/runtime@dotnet');
    expect(findInSrcDirs(args({ cloneTemplate: '~/src/{nope}/{repo}@{owner}' }))).toEqual([]);
    expect(findInSrcDirs(args({ cloneTemplate: '~/src/{nope}/{repo}@{owner}', owner: 'dotnet' }))).toEqual([]);
  });
});
