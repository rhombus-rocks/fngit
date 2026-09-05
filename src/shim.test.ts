import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { pathPrependCommand, removeShellBlock, shimDir, shimFilename, shimScriptContents,
  upsertShellBlock } from './shim.js';

describe('shimDir', () => {
  test('defaults to <home>/.local/share/rhombus.rocks/fngit/shims', () => {
    expect(shimDir('/home/tom', {})).toBe(join('/home/tom', '.local', 'share', 'rhombus.rocks', 'fngit', 'shims'));
  });

  test('honors XDG_DATA_HOME', () => {
    expect(shimDir('/home/tom', { XDG_DATA_HOME: '/custom/data' })).toBe(
      join('/custom/data', 'rhombus.rocks', 'fngit', 'shims'),
    );
  });
});

describe('shimFilename', () => {
  test('git.cmd for powershell, git otherwise', () => {
    expect(shimFilename('powershell')).toBe('git.cmd');
    expect(shimFilename('bash')).toBe('git');
    expect(shimFilename('zsh')).toBe('git');
    expect(shimFilename('fish')).toBe('git');
  });
});

describe('shimScriptContents', () => {
  test('posix shells get a sh wrapper that execs fngit', () => {
    expect(shimScriptContents('bash')).toBe('#!/bin/sh\nexec fngit "$@"\n');
    expect(shimScriptContents('zsh')).toBe('#!/bin/sh\nexec fngit "$@"\n');
    expect(shimScriptContents('fish')).toBe('#!/bin/sh\nexec fngit "$@"\n');
  });

  test('powershell gets a .cmd wrapper', () => {
    expect(shimScriptContents('powershell')).toBe('@fngit %*\r\n');
  });
});

describe('pathPrependCommand', () => {
  test('bash/zsh export PATH', () => {
    expect(pathPrependCommand('bash', '/shims')).toBe('export PATH="/shims:$PATH"');
    expect(pathPrependCommand('zsh', '/shims')).toBe('export PATH="/shims:$PATH"');
  });

  test('fish set -gx PATH', () => {
    expect(pathPrependCommand('fish', '/shims')).toBe('set -gx PATH "/shims" $PATH');
  });

  test('powershell $env:Path', () => {
    expect(pathPrependCommand('powershell', 'C:\\shims')).toBe(
      '$env:Path = "C:\\shims" + [System.IO.Path]::PathSeparator + $env:Path',
    );
  });
});

describe('upsertShellBlock', () => {
  test('inserts block into empty content', () => {
    expect(upsertShellBlock('', 'bash', '/shims')).toBe(
      '# >>> fngit shim >>>\nexport PATH="/shims:$PATH"\n# <<< fngit shim <<<\n',
    );
  });

  test('appends block after existing content with trailing newline', () => {
    expect(upsertShellBlock('existing\n', 'bash', '/shims')).toBe(
      'existing\n\n# >>> fngit shim >>>\nexport PATH="/shims:$PATH"\n# <<< fngit shim <<<\n',
    );
  });

  test('appends block after existing content without trailing newline', () => {
    expect(upsertShellBlock('existing', 'bash', '/shims')).toBe(
      'existing\n\n# >>> fngit shim >>>\nexport PATH="/shims:$PATH"\n# <<< fngit shim <<<\n',
    );
  });

  test('idempotent — re-running replaces the block, never duplicates it', () => {
    const first = upsertShellBlock('existing\n', 'bash', '/shims');
    const second = upsertShellBlock(first, 'bash', '/shims');
    expect(second).toBe(first);
  });

  test('idempotent on content with no trailing newline', () => {
    const first = upsertShellBlock('existing', 'zsh', '/shims');
    const second = upsertShellBlock(first, 'zsh', '/shims');
    expect(second).toBe(first);
  });

  test('replaces an existing block with a different shell/dir', () => {
    const withBash = upsertShellBlock('existing\n', 'bash', '/shims');
    const withFish = upsertShellBlock(withBash, 'fish', '/shims');
    expect(withFish).toContain('set -gx PATH');
    expect(withFish).not.toContain('export PATH');
    expect(withFish.match(/# >>> fngit shim >>>/g)?.length).toBe(1);
  });
});

describe('removeShellBlock', () => {
  test('removes the block from content', () => {
    const content = 'before\n\n# >>> fngit shim >>>\nexport PATH="/shims:$PATH"\n# <<< fngit shim <<<\nafter\n';
    expect(removeShellBlock(content)).toBe('before\nafter\n');
  });

  test('removes the block at the end of content', () => {
    const content = 'existing\n\n# >>> fngit shim >>>\nexport PATH="/shims:$PATH"\n# <<< fngit shim <<<\n';
    expect(removeShellBlock(content)).toBe('existing\n');
  });

  test('removes the block when it is the entire content', () => {
    const content = '# >>> fngit shim >>>\nexport PATH="/shims:$PATH"\n# <<< fngit shim <<<\n';
    expect(removeShellBlock(content)).toBe('');
  });

  test('removes the block at the start of content', () => {
    const content = '# >>> fngit shim >>>\nexport PATH="/shims:$PATH"\n# <<< fngit shim <<<\nafter\n';
    expect(removeShellBlock(content)).toBe('after\n');
  });

  test('returns content unchanged when no block is present', () => {
    expect(removeShellBlock('no block here\n')).toBe('no block here\n');
  });

  test('returns empty string unchanged', () => {
    expect(removeShellBlock('')).toBe('');
  });

  test('removes blank line that preceded the block', () => {
    const content = 'stuff\n\n# >>> fngit shim >>>\nexport PATH="/shims:$PATH"\n# <<< fngit shim <<<\n';
    expect(removeShellBlock(content)).toBe('stuff\n');
  });
});
