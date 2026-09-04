import type { Func } from '@rhombus-toolkit/types';

import { normalize } from 'node:path';

import { expandGlobPath, expandTilde } from './path.js';
import { applyTemplate, cloneTemplateVars, deriveWorktreeMarker } from './template.js';

// Stands in for {owner} while the pattern is built, so the owner segment can be
// wildcarded for globbing and recaptured from each hit. Chosen never to appear
// in a real path, template literal or owner name.
const OWNER_MARK = '￿';

/** An on-disk clone and the owner segment its path carries. */
export interface LocalClone {
  path: string;
  owner: string;
}

export interface FindLocalClonesArgs {
  name: string;
  template: string;
  /** The configured `worktreeTemplate`; absent or empty falls back to the default marker. */
  worktreeTemplate?: string;
  host: string;
  hostAliases: Readonly<Record<string, string>>;
  home: string;
  /** Expands one tilde-expanded glob pattern to the directories it names. */
  expandGlob?: Func<[string], string[]>;
}

export type FindLocalClonesResult = { ok: true; clones: LocalClone[]; } | { ok: false; error: string; };

/**
 * Find every on-disk clone of `name` under the clone template, whatever owner
 * it sits beneath, so disk presence can settle a bare name before any remote
 * lookup. Each hit carries the owner segment the scan recovered, and worktree
 * siblings are excluded. Works wherever {owner} sits in the template.
 */
export function findLocalClones(args: FindLocalClonesArgs): FindLocalClonesResult {
  const marked = expandOwnerTemplate(args);
  if (!marked.ok) {
    return marked;
  }
  const worktreeMarker = deriveWorktreeMarker(args.template, args.worktreeTemplate ?? '');
  return { ok: true, clones: matchOwnerClones(marked.value, worktreeMarker, args.expandGlob ?? expandGlobPath) };
}

/** The clone template expanded with {owner} marked for wildcarding, or the template error. */
export function expandOwnerTemplate(
  args: { name: string; template: string; host: string; hostAliases: Readonly<Record<string, string>>; home: string; },
): { ok: true; value: string; } | { ok: false; error: string; } {
  const applied = applyTemplate(args.template, cloneTemplateVars(args.name, OWNER_MARK, args.host, args.hostAliases));
  if (!applied.ok) {
    return applied;
  }
  return { ok: true, value: normalize(expandTilde(applied.value, args.home)) };
}

/**
 * Glob `markedPattern` — a fully-expanded clone path with {owner} marked — and
 * recover the owner segment of each directory it names, dropping worktree
 * siblings. A pattern that never mentions {owner} names nothing to enumerate.
 */
export function matchOwnerClones(markedPattern: string, worktreeMarker: string,
  expandGlob: Func<[string], string[]>): LocalClone[]
{
  if (!markedPattern.includes(OWNER_MARK)) {
    return [];
  }
  const segments = markedPattern.split(OWNER_MARK);
  const globPattern = segments.join('*');
  const ownerRe = new RegExp(`^${segments.map(escapeRegExp).join('([^/\\\\]+)')}$`);
  return Iterator.from(expandGlob(globPattern)).map((path) => ({ path, owner: ownerRe.exec(path)?.[1] ?? '' })).filter((
    clone,
  ) => clone.owner !== '' && (worktreeMarker === '' || !clone.owner.includes(worktreeMarker))).toArray();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
