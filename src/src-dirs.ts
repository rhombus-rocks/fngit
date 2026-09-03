import type { Func } from '@rhombus-toolkit/types';
import { globSync, statSync } from 'node:fs';
import { basename, join, sep } from 'node:path';

import { findLocalClones } from './local-clones.js';
import { expandTilde } from './path.js';
import { applyTemplate, cloneTemplateVars } from './template.js';

// A path carrying any of these is a pattern to expand; anything else is a
// literal directory. Deliberately not a /g regex — `search` would carry
// lastIndex between calls.
const GLOB_MAGIC = /[*?[{]/;

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
  /** Expands one tilde-expanded glob path to the paths it names. */
  expandGlob?: Func<[string], string[]>;
  isDirectory?: Func<[string], boolean>;
  readdir?: Func<[string], string[]>;
}

/**
 * Search the configured extra source directories for a checkout that already
 * exists, in the order they were configured, first hit winning.
 *
 * Each directory gets two rungs: `<dir>/<name>`, then the clone template's
 * last segment re-rooted at `<dir>`. Rung 2 wildcards {owner} only for a bare
 * name — a resolved owner is applied literally, so the search can never land
 * in a different owner's checkout and can never come back with more than one
 * path. These directories are search-only: a miss never turns one of them into
 * a clone destination.
 */
export function findInSrcDirs(args: FindInSrcDirsArgs): string[] {
  const isDirectory = args.isDirectory ?? isDirectorySync;

  for (const dir of expandSrcDirs(args.srcDirs, args.home, args.expandGlob ?? expandGlobPath)) {
    const named = join(dir, args.name);
    if (isDirectory(named)) {
      return [named];
    }
    const shaped = matchCloneShape(dir, args, isDirectory);
    if (shaped.length) {
      return shaped;
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

/**
 * Rung 2: the shape the clone template describes, looked for inside `dir`. A
 * template error yields no match rather than an error, since the caller has
 * already resolved the same template against its own root and reported it
 * there.
 */
function matchCloneShape(dir: string, args: FindInSrcDirsArgs, isDirectory: Func<[string], boolean>): string[] {
  if (args.owner === null) {
    const local = findLocalClones({ name: args.name, template: args.cloneTemplate,
      worktreeTemplate: args.worktreeTemplate, host: args.host, hostAliases: args.hostAliases, home: args.home,
      scanRoot: dir, readdir: args.readdir });
    return local.ok ? local.paths : [];
  }

  const applied = applyTemplate(args.cloneTemplate,
    cloneTemplateVars(args.name, args.owner, args.host, args.hostAliases));
  if (!applied.ok) {
    return [];
  }
  const candidate = join(dir, basename(expandTilde(applied.value, args.home)));
  return isDirectory(candidate) ? [candidate] : [];
}

/**
 * Split the pattern at the last separator before its first metacharacter, since
 * globbing wants a literal root plus a relative pattern. Results are sorted:
 * directory order would otherwise decide which expansion wins the first-hit
 * race.
 */
function expandGlobPath(pattern: string): string[] {
  const rootEnd = pattern.lastIndexOf(sep, pattern.search(GLOB_MAGIC));
  if (rootEnd < 0) {
    // A relative pattern has no root to scan; entries are absolute or
    // `~`-rooted by contract.
    return [];
  }
  const root = pattern.slice(0, rootEnd) || sep;
  try {
    return globSync(pattern.slice(rootEnd + 1), { cwd: root }).map((match) => join(root, match)).sort();
  } catch {
    return [];
  }
}

function isDirectorySync(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
