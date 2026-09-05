import type { Func } from '@rhombus-toolkit/types';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ShadowTarget } from './install-plan.js';

export interface GatherShadowTargetsDeps {
  /** Defaults to the running process's platform; injectable so a test can exercise every platform anywhere. */
  platform?: NodeJS.Platform;
  env?: Readonly<Record<string, string | undefined>>;
  existsSync?: (path: string) => boolean;
  /** Spawns `<cmd> -NoProfile -Command $PROFILE`; injectable so tests never spawn a real shell. */
  spawnPowershell?: (cmd: string) => { status: number | null; stdout: string; };
}

/**
 * Which shell startup files exist (or are the current shell) — the
 * PATH-prepend blocks a shim install touches.
 *
 * The PowerShell-profile probe only runs on `win32`: on POSIX, `pwsh` may
 * well be installed (GitHub's own `ubuntu-latest` runner ships it) with no
 * PowerShell profile in play at all, and probing it cost a real subprocess
 * spawn — with a 5s timeout — for a target that's never win32-relevant there.
 */
export function gatherShadowTargets(home: string, deps: GatherShadowTargetsDeps = {}): ShadowTarget[] {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const exists = deps.existsSync ?? existsSync;
  const targets: ShadowTarget[] = [];
  const shell = env.SHELL ?? '';

  const bashrc = join(home, '.bashrc');
  if (exists(bashrc) || shell.endsWith('/bash')) {
    targets.push({ path: bashrc, shell: 'bash' });
  }

  const zshrc = join(home, '.zshrc');
  if (exists(zshrc) || shell.endsWith('/zsh')) {
    targets.push({ path: zshrc, shell: 'zsh' });
  }

  const fishDir = join(home, '.config', 'fish');
  if (exists(fishDir)) {
    targets.push({ path: join(fishDir, 'conf.d', 'fngit.fish'), shell: 'fish' });
  }

  if (platform === 'win32') {
    const spawnPowershell = deps.spawnPowershell ?? defaultSpawnPowershell;
    for (const cmd of ['pwsh', 'powershell']) {
      const result = spawnPowershell(cmd);
      if (result.status === 0 && result.stdout.trim() !== '') {
        targets.push({ path: result.stdout.trim(), shell: 'powershell' });
        break;
      }
    }
  }

  return targets;
}

function defaultSpawnPowershell(cmd: string): { status: number | null; stdout: string; } {
  // `input: ''` makes spawnSync write (nothing) then close the child's stdin —
  // without it, a 'pipe' stdio with no input can leave stdin open on Windows,
  // and pwsh/powershell then blocks waiting for it rather than exiting, eating
  // the full `timeout` every time instead of returning immediately.
  const result = spawnSync(cmd, ['-NoProfile', '-Command', '$PROFILE'], { encoding: 'utf8', stdio: 'pipe', input: '',
    timeout: 5000 });
  return { status: result.status, stdout: result.stdout ?? '' };
}

/**
 * The shell targets a shim install will touch, probed only when a shim is
 * actually wanted — on Windows the probe spawns PowerShell, seconds a declined
 * shim must never cost.
 */
export function shadowTargetsFor(shimWanted: boolean, home: string,
  gather: Func<[string], ShadowTarget[]> = gatherShadowTargets): ShadowTarget[]
{
  return shimWanted ? gather(home) : [];
}
