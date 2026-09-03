import { globSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/** Expand a leading `~` against `home`, the way a shell would. */
export function expandTilde(input: string, home: string): string {
  if (input === '~') {
    return home;
  }
  if (input.startsWith('~/')) {
    return join(home, input.slice(2));
  }
  return input;
}

// A path carrying any of these is a glob pattern; anything else is a literal
// directory. Deliberately not a /g regex — `search` would carry lastIndex
// between calls.
export const GLOB_MAGIC = /[*?[{]/;

/**
 * Expand a tilde-expanded glob pattern to the directories it names, sorted so
 * directory order never decides which expansion wins a first-hit race. Only
 * directories (symlinks followed) are returned, so a stray file never counts
 * as a match.
 */
export function expandGlobPath(pattern: string): string[] {
  const rootEnd = pattern.lastIndexOf(sep, pattern.search(GLOB_MAGIC));
  if (rootEnd < 0) {
    // A relative pattern has no root to scan; entries are absolute or
    // `~`-rooted by contract.
    return [];
  }
  const root = pattern.slice(0, rootEnd) || sep;
  try {
    return globSync(pattern.slice(rootEnd + 1), { cwd: root }).map((match) => join(root, match)).filter(isDirectory)
      .sort();
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
