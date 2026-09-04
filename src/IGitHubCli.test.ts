import { describe, expect, test } from 'bun:test';

import { buildApiArgv, buildCloneArgv, isNotFoundNoiseLine, splitLines } from './IGitHubCli.js';

describe('buildApiArgv', () => {
  test('the owner-login path carries the jq filter that flattens it to a line', () => {
    expect(buildApiArgv('user')).toEqual(['api', 'user', '--jq', '.login']);
  });

  test('the orgs path carries the jq filter that flattens it to one login per line', () => {
    expect(buildApiArgv('/user/orgs')).toEqual(['api', '/user/orgs', '--jq', '.[].login']);
  });

  test('an existence probe takes no filter — only the exit status is read', () => {
    expect(buildApiArgv('repos/dotnet/runtime')).toEqual(['api', 'repos/dotnet/runtime']);
  });
});

describe('buildCloneArgv', () => {
  test('url and destination, no git arguments', () => {
    expect(buildCloneArgv('https://github.com/x/y.git', '/home/u/src/y@x')).toEqual(['repo', 'clone',
      'https://github.com/x/y.git', '/home/u/src/y@x']);
  });

  test('extra git arguments go after the -- separator gh forwards on', () => {
    expect(buildCloneArgv('https://github.com/x/y.git', '/tmp/y@x', ['--depth', '1'])).toEqual(['repo', 'clone',
      'https://github.com/x/y.git', '/tmp/y@x', '--', '--depth', '1']);
  });

  test('an empty argument list adds no separator', () => {
    expect(buildCloneArgv('u', 'd', [])).toEqual(['repo', 'clone', 'u', 'd']);
  });
});

describe('isNotFoundNoiseLine', () => {
  test('true for the GraphQL not-found line', () => {
    expect(
      isNotFoundNoiseLine("GraphQL: Could not resolve to a Repository with the name 'fnclaude/fnstatus'. (repository)"),
    ).toBe(true);
  });

  test('true for "Repository not found" variants', () => {
    expect(isNotFoundNoiseLine('remote: Repository not found')).toBe(true);
    expect(isNotFoundNoiseLine('ERROR: Repository not found.')).toBe(true);
  });

  test('false for normal git progress lines', () => {
    expect(isNotFoundNoiseLine("Cloning into '/home/tom/src/foo'...")).toBe(false);
    expect(isNotFoundNoiseLine('remote: Enumerating objects: 42, done.')).toBe(false);
  });

  test('false for auth and network failures, which the user must still see', () => {
    expect(isNotFoundNoiseLine('gh: To get started, please run: gh auth login')).toBe(false);
    expect(isNotFoundNoiseLine('dial tcp: lookup api.github.com: no such host')).toBe(false);
  });
});

describe('splitLines', () => {
  test('stitches a line split mid-line across chunk boundaries', () => {
    expect([...splitLines(['par', 'tial\nline two\nlas', 't'])]).toEqual(['partial\n', 'line two\n', 'last']);
  });

  test('a chunk boundary landing exactly on a newline', () => {
    expect([...splitLines(['a\n', 'b\n'])]).toEqual(['a\n', 'b\n']);
  });

  test('an unterminated final line is yielded as the trailing partial', () => {
    expect([...splitLines(['only'])]).toEqual(['only']);
  });

  test('empty input yields nothing', () => {
    expect([...splitLines([])]).toEqual([]);
  });

  test('\\r\\n line endings are normalized to \\n', () => {
    expect([...splitLines(['line one\r\nline two\r\n'])]).toEqual(['line one\n', 'line two\n']);
  });

  test('mixed \\n and \\r\\n line endings', () => {
    expect([...splitLines(['a\nb\r\nc\n'])]).toEqual(['a\n', 'b\n', 'c\n']);
  });

  test('\\r\\n split across chunk boundaries', () => {
    expect([...splitLines(['line\r', '\nnext\n'])]).toEqual(['line\n', 'next\n']);
  });
});
