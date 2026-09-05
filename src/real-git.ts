import type { Func } from '@rhombus-toolkit/types';
import { existsSync, realpathSync } from 'node:fs';
import { basename, join, sep } from 'node:path';

// The names a `git` invocation resolving back into fngit's own install can
// carry: the bin entry npm links, its Windows shim, and the script itself.
const SELF_BASENAMES = new Set(['fngit', 'fngit.cmd', 'cli.js']);

// Windows' own default when PATHEXT isn't set.
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

export interface ResolveRealGitDeps {
  /** Defaults to the running process's platform; injectable so a test can exercise win32 behavior anywhere. */
  platform?: NodeJS.Platform;
  existsSync?: Func<[string], boolean>;
  realpathSync?: Func<[string], string>;
}

/**
 * Find the real `git` binary on `PATH`, refusing to resolve back to fngit's
 * own install — the shadowing scenario a `git` alias/shim pointing at fngit
 * creates — or to fngit's own git-shim directory (`shimDir`, when given): the
 * shim there is a plain wrapper script that re-execs `fngit`, not a symlink,
 * so its realpath is itself and its basename is `git` — only knowing the
 * directory itself can tell it apart from a real git install. `FNGIT_GIT`,
 * when set, always wins outright.
 */
export function resolveRealGit(env: Readonly<Record<string, string | undefined>>, ownPackageDir: string,
  deps: ResolveRealGitDeps = {}, shimDir?: string): string | undefined
{
  const override = env.FNGIT_GIT;
  if (override !== undefined && override !== '') {
    return override;
  }

  const platform = deps.platform ?? process.platform;
  const exists = deps.existsSync ?? existsSync;
  const realpath = deps.realpathSync ?? realpathSync;
  const dirs = (env.PATH ?? '').split(platform === 'win32' ? ';' : ':').filter((dir) => dir !== '');

  for (const dir of dirs) {
    if (shimDir !== undefined && shimDir !== '' && isSameDir(dir, shimDir)) {
      continue;
    }
    for (const name of candidateNames(env, platform)) {
      const candidate = join(dir, name);
      if (!exists(candidate) || isOwnInstall(candidate, ownPackageDir, realpath)) {
        continue;
      }
      return candidate;
    }
  }
  return undefined;
}

function isSameDir(a: string, b: string): boolean {
  const normalize = (path: string): string => path.endsWith(sep) ? path.slice(0, -1) : path;
  return normalize(a) === normalize(b);
}

/** The file names a `git` lookup should try in `dir`, given the platform's executable-resolution rules. */
function candidateNames(env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') {
    return ['git'];
  }
  const extensions = (env.PATHEXT ?? DEFAULT_PATHEXT).split(';').map((ext) => ext.trim()).filter((ext) => ext !== '');
  return ['git', ...extensions.map((ext) => `git${ext}`)];
}

/** Whether `candidate` resolves into fngit's own install — inside its package directory, or under one of its own file names. */
function isOwnInstall(candidate: string, ownPackageDir: string, realpath: Func<[string], string>): boolean {
  let real: string;
  try {
    real = realpath(candidate);
  } catch {
    // Can't verify safety of an unresolvable candidate — skip it.
    return true;
  }
  const ownPrefix = ownPackageDir.endsWith(sep) ? ownPackageDir : `${ownPackageDir}${sep}`;
  return real === ownPackageDir || real.startsWith(ownPrefix) || SELF_BASENAMES.has(basename(real).toLowerCase());
}
