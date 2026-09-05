import { assertNever } from '@rhombus-toolkit/type-guards';
import { join } from 'node:path';

export type ShellType = 'bash' | 'zsh' | 'fish' | 'powershell';

const BLOCK_START = '# >>> fngit shim >>>';
const BLOCK_END = '# <<< fngit shim <<<';

/** `$XDG_DATA_HOME/rhombus.rocks/fngit/shims` (default `<home>/.local/share/rhombus.rocks/fngit/shims`). */
export function shimDir(home: string, env: Readonly<Record<string, string | undefined>>): string {
  const xdgDataHome = env.XDG_DATA_HOME;
  return join(xdgDataHome !== undefined && xdgDataHome !== '' ? xdgDataHome : join(home, '.local', 'share'),
    'rhombus.rocks', 'fngit', 'shims');
}

/** The shim's own filename on `PATH` for a given shell — `git.cmd` on the Windows/PowerShell shell, `git` elsewhere. */
export function shimFilename(shell: ShellType): string {
  return shell === 'powershell' ? 'git.cmd' : 'git';
}

/** The shim script's contents: a thin wrapper that re-execs `fngit`, never the real git, so PATH order does the shadowing. */
export function shimScriptContents(shell: ShellType): string {
  return shell === 'powershell' ? '@fngit %*\r\n' : '#!/bin/sh\nexec fngit "$@"\n';
}

/** The line that prepends `dir` to PATH for a given shell's startup file. */
export function pathPrependCommand(shell: ShellType, dir: string): string {
  switch (shell) {
    case 'bash':
    case 'zsh': {
      return `export PATH="${dir}:$PATH"`;
    }
    case 'fish': {
      return `set -gx PATH "${dir}" $PATH`;
    }
    case 'powershell': {
      return `$env:Path = "${dir}" + [System.IO.Path]::PathSeparator + $env:Path`;
    }
    default: {
      return assertNever(shell);
    }
  }
}

/** Insert or replace fngit's PATH-prepend block in a shell startup file's content, idempotently. */
export function upsertShellBlock(content: string, shell: ShellType, dir: string): string {
  const block = `${BLOCK_START}\n${pathPrependCommand(shell, dir)}\n${BLOCK_END}`;
  const base = removeShellBlock(content);
  if (base === '') {
    return `${block}\n`;
  }
  return base.endsWith('\n') ? `${base}\n${block}\n` : `${base}\n\n${block}\n`;
}

/** Remove fngit's PATH-prepend block from a shell startup file's content, cleaning up the blank line it left behind. */
export function removeShellBlock(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    if (line === BLOCK_START) {
      if (result.length && result[result.length - 1] === '') {
        result.pop();
      }
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line === BLOCK_END) {
        inBlock = false;
      }
      continue;
    }
    result.push(line);
  }

  return result.join('\n');
}
