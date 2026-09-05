import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { resolveRealGit, type ResolveRealGitDeps } from './real-git.js';

const OWN_PACKAGE_DIR = '/opt/fngit-install';

/** A fake fs seam: `existing` names which candidates exist, `realpaths` maps a candidate to its realpath. */
function fakeDeps(existing: ReadonlySet<string>, realpaths: ReadonlyMap<string, string> = new Map(),
  platform: NodeJS.Platform = 'linux'): ResolveRealGitDeps
{
  // Windows path lookups are case-insensitive, so the fake mirrors that rather than
  // forcing every test to spell out PATHEXT's case to match a fixture's literal name.
  const existingLower = new Set([...existing].map((path) => path.toLowerCase()));
  return { platform, existsSync: (path) => existingLower.has(path.toLowerCase()),
    realpathSync: (path) => realpaths.get(path) ?? path };
}

describe('resolveRealGit', () => {
  test('FNGIT_GIT override wins outright, without touching PATH', () => {
    const env = { FNGIT_GIT: '/custom/git', PATH: '/usr/bin' };
    const deps = fakeDeps(new Set()); // nothing on "disk" — override must short-circuit the walk
    expect(resolveRealGit(env, OWN_PACKAGE_DIR, deps)).toBe('/custom/git');
  });

  test('finds the real git on PATH', () => {
    const realGit = join('/usr/bin', 'git');
    const env = { PATH: '/usr/bin' };
    const deps = fakeDeps(new Set([realGit]));
    expect(resolveRealGit(env, OWN_PACKAGE_DIR, deps)).toBe(realGit);
  });

  test('skips a candidate whose realpath lies inside ownPackageDir', () => {
    const shadowed = join('/usr/local/bin', 'git');
    const realGit = join('/usr/bin', 'git');
    const env = { PATH: ['/usr/local/bin', '/usr/bin'].join(':') };
    const deps = fakeDeps(new Set([shadowed, realGit]), new Map([[shadowed, join(OWN_PACKAGE_DIR, 'dist', 'cli.js')]]));
    expect(resolveRealGit(env, OWN_PACKAGE_DIR, deps)).toBe(realGit);
  });

  test('skips a git symlink that realpaths to fngit', () => {
    const shadowed = join('/usr/local/bin', 'git');
    const realGit = join('/usr/bin', 'git');
    const env = { PATH: ['/usr/local/bin', '/usr/bin'].join(':') };
    const deps = fakeDeps(new Set([shadowed, realGit]), new Map([[shadowed, '/somewhere/else/fngit']]));
    expect(resolveRealGit(env, OWN_PACKAGE_DIR, deps)).toBe(realGit);
  });

  test('skips a git shim that realpaths to cli.js', () => {
    const shadowed = join('/usr/local/bin', 'git');
    const realGit = join('/usr/bin', 'git');
    const env = { PATH: ['/usr/local/bin', '/usr/bin'].join(':') };
    const deps = fakeDeps(new Set([shadowed, realGit]), new Map([[shadowed, '/somewhere/else/cli.js']]));
    expect(resolveRealGit(env, OWN_PACKAGE_DIR, deps)).toBe(realGit);
  });

  test('PATHEXT on win32 finds git.exe over a bare git', () => {
    // The on-disk file is lowercase, as a real Git-for-Windows install ships it; PATHEXT's own
    // casing is what the resolver tries, and Windows path lookups are case-insensitive either way.
    const onDisk = join('C:\\Program Files\\Git\\cmd', 'git.exe');
    const env = { PATH: 'C:\\Program Files\\Git\\cmd', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    const deps = fakeDeps(new Set([onDisk]), new Map(), 'win32');
    expect(resolveRealGit(env, OWN_PACKAGE_DIR, deps)?.toLowerCase()).toBe(onDisk.toLowerCase());
  });

  test('nothing found on PATH — undefined', () => {
    const env = { PATH: ['/usr/local/bin', '/usr/bin'].join(':') };
    const deps = fakeDeps(new Set());
    expect(resolveRealGit(env, OWN_PACKAGE_DIR, deps)).toBeUndefined();
  });

  test("skips a git shim living in the configured shim directory, even though it is not fngit's own install", () => {
    const shimDir = '/home/tom/.local/share/rhombus.rocks/fngit/shims';
    const shim = join(shimDir, 'git');
    const realGit = join('/usr/bin', 'git');
    const env = { PATH: [shimDir, '/usr/bin'].join(':') };
    // The shim is a plain wrapper script, not a symlink — its realpath is itself, and its
    // basename is "git", so only an explicit shimDir check (not SELF_BASENAMES) can skip it.
    const deps = fakeDeps(new Set([shim, realGit]));
    expect(resolveRealGit(env, OWN_PACKAGE_DIR, deps, shimDir)).toBe(realGit);
  });

  test('with no shimDir given, a shim-shaped path is not specially skipped', () => {
    const shimDir = '/home/tom/.local/share/rhombus.rocks/fngit/shims';
    const shim = join(shimDir, 'git');
    const env = { PATH: shimDir };
    const deps = fakeDeps(new Set([shim]));
    expect(resolveRealGit(env, OWN_PACKAGE_DIR, deps)).toBe(shim);
  });
});
