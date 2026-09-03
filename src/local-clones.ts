import type { Func } from '@rhombus-toolkit/types';
import { readdirSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';

import { expandTilde } from './path.js';
import { applyTemplate, cloneTemplateVars, deriveWorktreeMarker } from './template.js';

// Substituted for {owner} so the owner segment can be located in the
// fully-expanded path. Chosen never to collide with a real owner name or any
// literal template text.
const OWNER_SENTINEL = '￿';

export interface FindLocalClonesArgs {
  name: string;
  template: string;
  /** The configured `worktreeTemplate`; absent or empty falls back to the default marker. */
  worktreeTemplate?: string;
  host: string;
  hostAliases: Readonly<Record<string, string>>;
  home: string;
  /**
   * Directory to scan in place of the one the template resolves into. Only the
   * template's last segment is re-rooted, so a template whose {owner} lives in
   * an earlier segment matches nothing here.
   */
  scanRoot?: string;
  readdir?: Func<[string], string[]>;
}

export type FindLocalClonesResult = { ok: true; paths: string[]; } | { ok: false; error: string; };

/**
 * Find every on-disk clone of `name` under the clone template, whatever owner
 * it sits beneath, so disk presence can settle a bare name before any remote
 * lookup.
 *
 * The template is expanded with every placeholder resolved except {owner},
 * which the scan wildcards: nesting by host or any other placeholder therefore
 * lands in the same concrete directory a real clone would. Worktree siblings
 * are rejected, since their owner segment carries the marker
 * {@link deriveWorktreeMarker} derives and a clone's never does.
 */
export function findLocalClones(args: FindLocalClonesArgs): FindLocalClonesResult {
  const readdir = args.readdir ?? readdirSync;

  const applied = applyTemplate(args.template,
    cloneTemplateVars(args.name, OWNER_SENTINEL, args.host, args.hostAliases));
  if (!applied.ok) {
    return applied;
  }
  const expanded = expandTilde(applied.value, args.home);

  // The owner segment lives within a single directory level, so the scan reads
  // the parent directory the template resolves into and rebuilds each entry's
  // full path to match against prefix + <owner> + suffix. A scanRoot swaps that
  // parent for the caller's, carrying the template's last segment along.
  const scanDir = args.scanRoot ?? dirname(expanded.replace(OWNER_SENTINEL, ''));
  const rooted = args.scanRoot === undefined ? expanded : join(args.scanRoot, basename(expanded));

  const sentinelIdx = rooted.indexOf(OWNER_SENTINEL);
  if (sentinelIdx < 0) {
    // The template never mentions {owner} (or mentions it above the segment a
    // scanRoot re-roots), so there is nothing to enumerate by owner.
    return { ok: true, paths: [] };
  }
  const prefix = rooted.slice(0, sentinelIdx);
  const suffix = rooted.slice(sentinelIdx + OWNER_SENTINEL.length);
  const worktreeMarker = deriveWorktreeMarker(args.template, args.worktreeTemplate ?? '');

  let entries: string[];
  try {
    entries = readdir(scanDir);
  } catch {
    return { ok: true, paths: [] };
  }

  return { ok: true, paths: entries.map((entry) => join(scanDir, entry)).filter((candidate) => {
    const owner = extractOwnerSegment(candidate, prefix, suffix);
    if (owner === null || owner === '' || owner.includes('/') || owner.includes(sep)) {
      return false;
    }
    return worktreeMarker === '' || !owner.includes(worktreeMarker);
  }) };
}

/**
 * The owner segment `candidate` carries between the given literals, or null
 * when it doesn't have their shape at all.
 */
function extractOwnerSegment(candidate: string, prefix: string, suffix: string): string | null {
  if (!candidate.startsWith(prefix) || (suffix !== '' && !candidate.endsWith(suffix))) {
    return null;
  }
  return candidate.slice(prefix.length, candidate.length - suffix.length);
}
