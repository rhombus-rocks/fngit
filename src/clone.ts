import type { Func } from '@rhombus-toolkit/types';
import { mkdir } from 'node:fs/promises';
import { dirname, normalize } from 'node:path';

import { type IGitHubCli, NOT_FOUND_SIGNATURES } from './IGitHubCli.js';
import { expandTilde } from './path.js';
import { effectiveHost, hasResolvedOwner, type RepoRef } from './RepoRef.js';
import { applyTemplate, cloneTemplateVars } from './template.js';

export interface ComputeCloneDestinationArgs {
  ref: RepoRef;
  template: string;
  hostAliases: Readonly<Record<string, string>>;
  home: string;
}

export type ComputeCloneDestinationResult = { ok: true; path: string; } | { ok: false; error: string; };

export interface CloneRepoArgs {
  url: string;
  destination: string;
  gh: IGitHubCli;
  cloneArgs?: readonly string[];
  mkdirp?: Func<[string], Promise<void>>;
}

export type CloneRepoResult = { ok: true; } | { ok: false; error: string; stderr: string; };

/** The URL a resolved reference is fetched from. */
export function buildCloneUrl(ref: RepoRef): string {
  if (!hasResolvedOwner(ref)) {
    throw new Error(`buildCloneUrl: ref has no owner (original=${JSON.stringify(ref.original)})`);
  }
  if (ref.name === '') {
    throw new Error(`buildCloneUrl: ref has empty name (original=${JSON.stringify(ref.original)})`);
  }
  return `https://${effectiveHost(ref)}/${ref.owner}/${ref.name}.git`;
}

/**
 * The on-disk path a reference clones into, per the configured template — the
 * base repo path, since a `+workspace` suffix names a worktree beside the
 * clone rather than a different clone.
 */
export function computeCloneDestination(args: ComputeCloneDestinationArgs): ComputeCloneDestinationResult {
  const applied = applyTemplate(args.template,
    cloneTemplateVars(args.ref.name, args.ref.owner, effectiveHost(args.ref), args.hostAliases));
  if (!applied.ok) {
    return applied;
  }
  return { ok: true, path: normalize(expandTilde(applied.value, args.home)) };
}

/** Create the destination's parent directory, then clone into it. */
export async function cloneRepo(args: CloneRepoArgs): Promise<CloneRepoResult> {
  const mkdirp = args.mkdirp ?? (async (path: string) => {
    await mkdir(path, { recursive: true });
  });
  const parent = dirname(args.destination);
  try {
    await mkdirp(parent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `failed to create parent directory ${parent}: ${message}`, stderr: '' };
  }

  const cloned = await args.gh.clone(args.url, args.destination, args.cloneArgs);
  if (!cloned.ok) {
    return { ok: false, error: `gh repo clone failed: ${cloned.error}`, stderr: cloned.stderr };
  }
  return { ok: true };
}

/**
 * Whether a failed clone's stderr says the repo doesn't exist, as opposed to
 * an auth, network or gh-missing failure — which the caller answers
 * differently.
 */
export function isRepoNotFoundError(stderr: string): boolean {
  return NOT_FOUND_SIGNATURES.some((signature) => signature.test(stderr));
}
