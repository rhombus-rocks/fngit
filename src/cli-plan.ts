import { assertNever } from '@rhombus-toolkit/type-guards';

import type { LocateFailure } from './LocateError.js';
import { parseRepoRef } from './RepoRef.js';

export type CliPlan = { kind: 'passthrough'; args: readonly string[]; } | { kind: 'clone'; input: string;
  cloneArgs: readonly string[]; } | { kind: 'reject-workspace'; input: string; };

const PATH_LIKE_PREFIXES = ['.', '/', '~'];

/**
 * Decide whether a `git` invocation is a decoratable `clone <ref>` — a bare
 * reference (not a filesystem path) with no explicit destination argument of
 * its own — or should pass straight through to `git` unchanged.
 */
export function planInvocation(argv: readonly string[]): CliPlan {
  const [command, input, second, ...rest] = argv;
  if (command !== 'clone' || input === undefined || !isDecoratable(input)) {
    return { kind: 'passthrough', args: argv };
  }
  if (second !== undefined && !second.startsWith('-')) {
    // A second positional is the destination the user chose — git's job, not ours.
    return { kind: 'passthrough', args: argv };
  }
  const parsed = parseRepoRef(input);
  if (!parsed.ok) {
    return { kind: 'passthrough', args: argv };
  }
  const cloneArgs = second === undefined ? [] : [second, ...rest];
  return parsed.ref.workspace !== '' ? { kind: 'reject-workspace', input } : { kind: 'clone', input, cloneArgs };
}

/** Whether `input` could name a repo reference, ruling out flags and filesystem paths up front. */
function isDecoratable(input: string): boolean {
  return !input.startsWith('-') && !PATH_LIKE_PREFIXES.some((prefix) => input.startsWith(prefix));
}

export interface LocateFailureRender {
  readonly exitCode: number;
  readonly extraLines: readonly string[];
}

/** How to report a `LocateError`'s failure on the CLI — its exit code and any lines beyond the message itself. */
export function renderLocateFailure(failure: LocateFailure): LocateFailureRender {
  switch (failure.reason) {
    case 'unparseable':
    case 'config':
    case 'gh-failed':
    case 'not-found':
    case 'clone-failed': {
      return { exitCode: 1, extraLines: [] };
    }
    case 'ambiguous-owner': {
      return { exitCode: 1, extraLines: failure.owners };
    }
    case 'ambiguous-local': {
      return { exitCode: 1, extraLines: failure.paths };
    }
    default: {
      return assertNever(failure);
    }
  }
}
