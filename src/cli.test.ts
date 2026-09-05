import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI_PATH = join(import.meta.dirname, 'cli.ts');

function runCli(args: readonly string[],
  env: Readonly<Record<string, string>> = {}): { status: number | null; stdout: string; stderr: string; }
{
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    // Neutralize XDG_CONFIG_HOME/FNGIT_CONFIG so a CI runner that happens to set
    // either (e.g. for its own caching) can't pull config resolution away from
    // the test's HOME override — every test here relies on that isolation, and
    // `undefined` here removes the var entirely rather than passing "undefined".
    env: { ...process.env, XDG_CONFIG_HOME: undefined, FNGIT_CONFIG: undefined, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('fngit passthrough', () => {
  test('fngit --version matches git --version, unchanged', () => {
    const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
    const fngit = runCli(['--version']);
    expect(fngit.stdout).toBe(git.stdout);
    expect(fngit.status).toBe(0);
  });
});

describe('fngit shadowing git safely', () => {
  test('FNGIT_DEPTH already set — refuses to recurse, exit 126', () => {
    const result = runCli(['status'], { FNGIT_DEPTH: '1' });

    expect(result.status).toBe(126);
    expect(result.stderr).toContain('fngit: refusing to run recursively');
    expect(result.stderr).toContain('FNGIT_GIT');
  });

  // Shell-script fakes only work on POSIX; the FNGIT_GIT mechanism is tested
  // via the FNGIT_DEPTH guard above on all platforms.
  const posixOnly = process.platform === 'win32' ? test.skip : test;

  posixOnly('FNGIT_GIT overrides which git runs, and passthrough args arrive unchanged', () => {
    const binDir = mkdtempSync(join(tmpdir(), 'fngit-fakegit-'));
    const fakeGit = join(binDir, 'fake-git.sh');
    writeFileSync(fakeGit, '#!/bin/sh\nprintf \'%s\\n\' "$@"\n');
    chmodSync(fakeGit, 0o755);

    const result = runCli(['clone', 'somerepo', './some/path'], { FNGIT_GIT: fakeGit });

    expect(result.stdout).toBe('clone\nsomerepo\n./some/path\n');
    expect(result.status).toBe(0);
  });

  posixOnly('a git spawned by fngit carries FNGIT_DEPTH, so a shadowing loop trips the recursion guard', () => {
    const binDir = mkdtempSync(join(tmpdir(), 'fngit-fakegit-'));
    const fakeGit = join(binDir, 'fake-git.sh');
    writeFileSync(fakeGit, '#!/bin/sh\nprintf \'%s\\n\' "$FNGIT_DEPTH"\n');
    chmodSync(fakeGit, 0o755);

    const result = runCli(['status'], { FNGIT_GIT: fakeGit });

    expect(result.stdout).toBe('1\n');
    expect(result.status).toBe(0);
  });
});

describe('fngit clone — decorated path', () => {
  test('an already-present clone prints its path without touching gh', () => {
    const home = mkdtempSync(join(tmpdir(), 'fngit-home-'));
    const clonesRoot = mkdtempSync(join(tmpdir(), 'fngit-clones-'));
    const existing = join(clonesRoot, 'fnclaude@testowner');
    mkdirSync(existing, { recursive: true });
    const configDir = join(home, '.config', 'rhombus.rocks');
    mkdirSync(configDir, { recursive: true });
    // Use forward slashes in the template — expandTilde normalizes to native separators.
    const template = `${clonesRoot.replace(/\\/g, '/')}/{repo}@{owner}`;
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ repos: { cloneTemplate: template } }));

    // On win32 the home dir env var is USERPROFILE, not HOME.
    const homeEnv: Record<string, string> = process.platform === 'win32' ? { USERPROFILE: home } : { HOME: home };
    const result = runCli(['clone', 'fnclaude'], homeEnv);

    expect(result.stdout.trim()).toBe(existing);
    expect(result.status).toBe(0);
  });
});

describe('fngit install', () => {
  function tempHomeEnv(): { home: string; env: Record<string, string>; } {
    const home = mkdtempSync(join(tmpdir(), 'fngit-install-home-'));
    const env: Record<string, string> = process.platform === 'win32' ? { USERPROFILE: home } : { HOME: home };
    return { home, env };
  }

  test('--yes --dry-run --no-plugin --no-shadow-git prints the plan and writes nothing', () => {
    const { home, env } = tempHomeEnv();
    const result = runCli(['install', '--yes', '--dry-run', '--no-plugin', '--no-shadow-git'], env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('repos.*');
    expect(existsSync(join(home, '.config', 'rhombus.rocks', 'config.json'))).toBe(false);
  });

  test('--yes --no-plugin --no-shadow-git writes the recommended config to the new shared location', () => {
    const { home, env } = tempHomeEnv();
    const result = runCli(['install', '--yes', '--no-plugin', '--no-shadow-git'], env);

    expect(result.status).toBe(0);
    const configPath = join(home, '.config', 'rhombus.rocks', 'config.json');
    expect(existsSync(configPath)).toBe(true);
    const doc = JSON.parse(readFileSync(configPath, 'utf8')) as { repos: { cloneTemplate: string; }; };
    expect(doc.repos.cloneTemplate).toBe('~/src/{repo}@{owner}');
  });

  test('an unrecognized flag is a usage error, never handed to git', () => {
    const result = runCli(['install', '--bogus-flag']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: fngit install');
  });

  test('--help prints usage and exits 0', () => {
    const result = runCli(['install', '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: fngit install');
  });
});
