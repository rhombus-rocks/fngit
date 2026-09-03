import type { Func } from '@rhombus-toolkit/types';
import { statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { expandOwnerTemplate, type LocalClone, matchOwnerClones } from './local-clones.js';
import { expandGlobPath, expandTilde, GLOB_MAGIC } from './path.js';
import { applyTemplate, cloneTemplateVars, deriveWorktreeMarker } from './template.js';

export interface FindInSrcDirsArgs {
  name: string;
  /** The resolved owner, or null for a bare name — null matches any owner segment. */
  owner: string | null;
  srcDirs: readonly string[];
  cloneTemplate: string;
  worktreeTemplate?: string;
  host: string;
  hostAliases: Readonly<Record<string, string>>;
  home: string;
  /** Expands one tilde-expanded glob pattern to the directories it names. */
  expandGlob?: Func<[string], string[]>;
  isDirectory?: Func<[string], boolean>;
}

/**
 * Search the configured extra source directories for a checkout that already
 * exists, in the order they were configured, first hit winning.
 *
 * Each directory gets two rungs: `<dir>/<name>`, then the clone template's
 * last segment re-rooted at `<dir>`. Rung 2 wildcards {owner} only for a bare
 * name — a resolved owner is applied literally, so the search can never land
 * in a different owner's checkout and can never come back with more than one
 * path. A rung-2 hit carries the owner segment it recovered; a rung-1 hit
 * can't know the owner, so it carries `''`. These directories are search-only:
 * a miss never turns one of them into a clone destination.
 */
export function findInSrcDirs(args: FindInSrcDirsArgs): LocalClone[] {
  const isDirectory = args.isDirectory ?? isDirectorySync;
  const expandGlob = args.expandGlob ?? expandGlobPath;
  const worktreeMarker = deriveWorktreeMarker(args.cloneTemplate, args.worktreeTemplate ?? '');
  const marked = args.owner === null
    ? expandOwnerTemplate({ name: args.name, template: args.cloneTemplate, host: args.host,
      hostAliases: args.hostAliases, home: args.home })
    : null;

  for (const dir of expandSrcDirs(args.srcDirs, args.home, expandGlob)) {
    const named = join(dir, args.name);
    if (isDirectory(named)) {
      return [{ path: named, owner: '' }];
    }
    // Rung 2: the clone template's last segment re-rooted at `dir`. A bare name
    // globs the owner and drops worktree siblings; a resolved owner is literal.
    if (marked !== null) {
      if (marked.ok) {
        const clones = matchOwnerClones(join(dir, basename(marked.value)), worktreeMarker, expandGlob);
        if (clones.length) {
          return clones;
        }
      }
      continue;
    }
    const applied = applyTemplate(args.cloneTemplate,
      cloneTemplateVars(args.name, args.owner!, args.host, args.hostAliases));
    if (applied.ok) {
      const candidate = join(dir, basename(expandTilde(applied.value, args.home)));
      if (isDirectory(candidate)) {
        return [{ path: candidate, owner: args.owner! }];
      }
    }
  }

  return [];
}

/**
 * Walk the configured entries in order, expanding the glob ones. Paths that
 * don't exist aren't filtered here: both rungs fail closed on a directory that
 * isn't there, so a dead entry costs one failed stat.
 */
function* expandSrcDirs(entries: readonly string[], home: string,
  expandGlob: Func<[string], string[]>): Generator<string>
{
  for (const entry of entries) {
    const expanded = expandTilde(entry, home);
    if (!GLOB_MAGIC.test(expanded)) {
      yield expanded;
      continue;
    }
    yield* expandGlob(expanded);
  }
}

function isDirectorySync(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
