import { assertNever } from '@rhombus-toolkit/type-guards';

export type ShellType = 'bash' | 'zsh' | 'fish' | 'powershell';

const BLOCK_START = '# >>> fngit >>>';

const BLOCK_END = '# <<< fngit <<<';

/** The alias command that shadows `git` with `fngit` in a given shell. */
export function shellAliasCommand(shell: ShellType): string {
  switch (shell) {
    case 'bash':
    case 'zsh': {
      return 'alias git=fngit';
    }
    case 'fish': {
      return 'alias git fngit';
    }
    case 'powershell': {
      return 'Set-Alias git fngit';
    }
    default: {
      return assertNever(shell);
    }
  }
}

/** Insert or replace the fngit shadow block in file content, idempotently. */
export function upsertShellBlock(content: string, shell: ShellType): string {
  const block = `${BLOCK_START}\n${shellAliasCommand(shell)}\n${BLOCK_END}`;
  const base = removeShellBlock(content);
  if (!base) {
    return `${block}\n`;
  }
  return base.endsWith('\n') ? `${base}\n${block}\n` : `${base}\n\n${block}\n`;
}

/** Remove the fngit shadow block from file content, cleaning up adjacent blank lines. */
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
