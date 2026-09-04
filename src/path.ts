import { globSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

/** Expand a leading `~` against `home`, the way a shell would — on win32, `~\` is also accepted. */
export function expandTilde(input: string, home: string): string {
  if (input === '~') {
    return home;
  }
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return normalize(join(home, input.slice(2)));
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
  // globSync expects forward slashes on every platform; find the root by
  // scanning for the last separator (either / or \) before the first glob character.
  const magicIdx = pattern.search(GLOB_MAGIC);
  const beforeMagic = magicIdx >= 0 ? pattern.slice(0, magicIdx) : pattern;
  const rootEnd = Math.max(beforeMagic.lastIndexOf('/'), beforeMagic.lastIndexOf(sep));
  if (rootEnd < 0) {
    // A relative pattern has no root to scan; entries are absolute or
    // `~`-rooted by contract.
    return [];
  }
  const root = pattern.slice(0, rootEnd) || sep;
  const globPart = pattern.slice(rootEnd + 1).replace(/\\/g, '/');
  try {
    return globSync(globPart, { cwd: root }).map((match) => normalize(join(root, match))).filter(isDirectory).sort();
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
