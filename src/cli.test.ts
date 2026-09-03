import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
