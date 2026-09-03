#!/usr/bin/env node
import { assertNever } from '@rhombus-toolkit/type-guards';
import { spawnSync } from 'node:child_process';

import { planInvocation, renderLocateFailure } from './cli-plan.js';
import { locate } from './locate.js';
import { LocateError } from './LocateError.js';

await main(process.argv.slice(2));

async function main(argv: readonly string[]): Promise<void> {
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

/** Run `git` with `args` inherited on this process's stdio, mapping its outcome to an exit code. */
function runGit(args: readonly string[]): number {
  const result = spawnSync('git', args, { stdio: 'inherit' });
  if (result.error !== undefined) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      process.stderr.write('fngit: git not found on PATH\n');
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
