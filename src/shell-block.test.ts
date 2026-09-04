import { describe, expect, test } from 'bun:test';

import { removeShellBlock, shellAliasCommand, upsertShellBlock } from './shell-block.js';

describe('shellAliasCommand', () => {
  test('bash', () => {
    expect(shellAliasCommand('bash')).toBe('alias git=fngit');
  });

  test('zsh', () => {
    expect(shellAliasCommand('zsh')).toBe('alias git=fngit');
  });

  test('fish', () => {
    expect(shellAliasCommand('fish')).toBe('alias git fngit');
  });

  test('powershell', () => {
    expect(shellAliasCommand('powershell')).toBe('Set-Alias git fngit');
  });
});

describe('upsertShellBlock', () => {
  test('inserts block into empty content', () => {
    expect(upsertShellBlock('', 'bash')).toBe('# >>> fngit >>>\nalias git=fngit\n# <<< fngit <<<\n');
  });

  test('appends block after existing content with trailing newline', () => {
    expect(upsertShellBlock('existing\n', 'bash')).toBe(
      'existing\n\n# >>> fngit >>>\nalias git=fngit\n# <<< fngit <<<\n',
    );
  });

  test('appends block after existing content without trailing newline', () => {
    expect(upsertShellBlock('existing', 'bash')).toBe(
      'existing\n\n# >>> fngit >>>\nalias git=fngit\n# <<< fngit <<<\n',
    );
  });

  test('uses fish alias syntax for fish', () => {
    expect(upsertShellBlock('', 'fish')).toBe('# >>> fngit >>>\nalias git fngit\n# <<< fngit <<<\n');
  });

  test('uses Set-Alias for powershell', () => {
    expect(upsertShellBlock('', 'powershell')).toBe('# >>> fngit >>>\nSet-Alias git fngit\n# <<< fngit <<<\n');
  });

  test('idempotent — re-running replaces the block, never duplicates it', () => {
    const first = upsertShellBlock('existing\n', 'bash');
    const second = upsertShellBlock(first, 'bash');
    expect(second).toBe(first);
  });

  test('idempotent on content with no trailing newline', () => {
    const first = upsertShellBlock('existing', 'zsh');
    const second = upsertShellBlock(first, 'zsh');
    expect(second).toBe(first);
  });

  test('replaces an existing block with a different shell type', () => {
    const withBash = upsertShellBlock('existing\n', 'bash');
    const withFish = upsertShellBlock(withBash, 'fish');
    expect(withFish).toContain('alias git fngit');
    expect(withFish).not.toContain('alias git=fngit');
    // Still exactly one block
    expect(withFish.match(/# >>> fngit >>>/g)?.length).toBe(1);
  });
});

describe('removeShellBlock', () => {
  test('removes the block from content', () => {
    const content = 'before\n\n# >>> fngit >>>\nalias git=fngit\n# <<< fngit <<<\nafter\n';
    expect(removeShellBlock(content)).toBe('before\nafter\n');
  });

  test('removes the block at the end of content', () => {
    const content = 'existing\n\n# >>> fngit >>>\nalias git=fngit\n# <<< fngit <<<\n';
    expect(removeShellBlock(content)).toBe('existing\n');
  });

  test('removes the block when it is the entire content', () => {
    const content = '# >>> fngit >>>\nalias git=fngit\n# <<< fngit <<<\n';
    expect(removeShellBlock(content)).toBe('');
  });

  test('removes the block at the start of content', () => {
    const content = '# >>> fngit >>>\nalias git=fngit\n# <<< fngit <<<\nafter\n';
    expect(removeShellBlock(content)).toBe('after\n');
  });

  test('returns content unchanged when no block is present', () => {
    expect(removeShellBlock('no block here\n')).toBe('no block here\n');
  });

  test('returns empty string unchanged', () => {
    expect(removeShellBlock('')).toBe('');
  });

  test('removes blank line that preceded the block', () => {
    const content = 'stuff\n\n# >>> fngit >>>\nalias git=fngit\n# <<< fngit <<<\n';
    expect(removeShellBlock(content)).toBe('stuff\n');
  });

  test('handles fish block content', () => {
    const content = '# >>> fngit >>>\nalias git fngit\n# <<< fngit <<<\n';
    expect(removeShellBlock(content)).toBe('');
  });

  test('handles powershell block content', () => {
    const content = '# >>> fngit >>>\nSet-Alias git fngit\n# <<< fngit <<<\n';
    expect(removeShellBlock(content)).toBe('');
  });
});
