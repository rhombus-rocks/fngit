#!/usr/bin/env node
import { assertNever } from '@rhombus-toolkit/type-guards';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { planInvocation, renderLocateFailure } from './cli-plan.js';
import { locate } from './locate.js';
import { LocateError } from './LocateError.js';
import { resolveRealGit } from './real-git.js';

// fngit's own install directory — the directory holding its package.json — so
// a `git` lookup that resolves back inside it (a shadowing alias/shim pointing
// at fngit itself) can be told apart from the real git.
const OWN_PACKAGE_DIR = findOwnPackageDir(fileURLToPath(import.meta.url));

const RECURSION_MESSAGE = "fngit: refusing to run recursively — is 'git' on PATH pointing back at fngit? "
  + 'Set FNGIT_GIT to the real git binary.\n';

await main(process.argv.slice(2));

async function main(argv: readonly string[]): Promise<void> {
  if (process.env.FNGIT_DEPTH !== undefined) {
    process.stderr.write(RECURSION_MESSAGE);
    process.exitCode = 126;
    return;
  }
  const plan = planInvocation(argv);
  switch (plan.kind) {
    case 'passthrough': {
      process.exitCode = runGit(plan.args);
      return;
    }
    case 'reject-workspace': {
      process.stderr.write('fngit clone: the +workspace suffix is not supported yet\n');
      process.exitCode = 2;
      return;
    }
    case 'clone': {
      process.exitCode = await runClone(plan.input, plan.cloneArgs);
      return;
    }
    default: {
      assertNever(plan);
    }
  }
}

/** Resolve `input` to a checkout, cloning it if needed, and print its path — the effects side of `planInvocation`'s `clone` outcome. */
async function runClone(input: string, cloneArgs: readonly string[]): Promise<number> {
  try {
    const repo = await locate(input, { clone: true, cloneArgs });
    process.stdout.write(`${repo.path}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof LocateError)) {
      throw error;
    }
    const render = renderLocateFailure(error.failure);
    process.stderr.write(`${[error.message, ...render.extraLines].join('\n')}\n`);
    return render.exitCode;
  }
}

/** Run the real `git` with `args` inherited on this process's stdio, mapping its outcome to an exit code. */
function runGit(args: readonly string[]): number {
  const gitPath = resolveRealGit(process.env, OWN_PACKAGE_DIR);
  if (gitPath === undefined) {
    process.stderr.write('fngit: git not found on PATH (set FNGIT_GIT to the real git binary)\n');
    return 127;
  }
  // FNGIT_DEPTH marks this as an fngit-spawned child, so a `git` alias/shim that
  // loops back to fngit trips the recursion guard instead of spawning forever.
  const result = spawnSync(gitPath, args, { stdio: 'inherit', env: { ...process.env, FNGIT_DEPTH: '1' } });
  if (result.error !== undefined) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      process.stderr.write('fngit: git not found on PATH (set FNGIT_GIT to the real git binary)\n');
      return 127;
    }
    throw result.error;
  }
  if (result.signal !== null) {
    process.kill(process.pid, result.signal);
    return 1;
  }
  return result.status ?? 1;
}

/** Walk up from `startFile` to the nearest directory holding a `package.json` — fngit's own install root. */
function findOwnPackageDir(startFile: string): string {
  let dir = dirname(startFile);
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return dir;
    }
    dir = parent;
  }
}
