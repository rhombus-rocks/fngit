import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI_PATH = join(import.meta.dirname, 'cli.ts');

function runCli(args: readonly string[],
  env: Readonly<Record<string, string>> = {}): { status: number | null; stdout: string; stderr: string; }
{
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: 'utf8',
    env: { ...process.env, ...env } });
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

  test('FNGIT_GIT overrides which git runs, and passthrough args arrive unchanged', () => {
    const binDir = mkdtempSync(join(tmpdir(), 'fngit-fakegit-'));
    const fakeGit = join(binDir, 'fake-git.sh');
    writeFileSync(fakeGit, '#!/bin/sh\nprintf \'%s\\n\' "$@"\n');
    chmodSync(fakeGit, 0o755);

    const result = runCli(['clone', 'somerepo', './some/path'], { FNGIT_GIT: fakeGit });

    expect(result.stdout).toBe('clone\nsomerepo\n./some/path\n');
    expect(result.status).toBe(0);
  });

  test('a git spawned by fngit carries FNGIT_DEPTH, so a shadowing loop trips the recursion guard', () => {
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
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'),
      JSON.stringify({ repoSettings: { cloneTemplate: `${clonesRoot}/{repo}@{owner}` } }));

    const result = runCli(['clone', 'fnclaude'], { HOME: home });

    expect(result.stdout).toBe(`${existing}\n`);
    expect(result.status).toBe(0);
  });
});
