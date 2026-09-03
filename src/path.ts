import { join } from 'node:path';

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
