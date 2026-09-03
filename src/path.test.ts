import { describe, expect, test } from 'bun:test';

import { expandTilde } from './path.js';

describe('expandTilde', () => {
  const home = '/home/tom';

  test('bare ~ becomes home', () => {
    expect(expandTilde('~', home)).toBe(home);
  });

  test('~/ prefix becomes home/...', () => {
    expect(expandTilde('~/src/proj', home)).toBe('/home/tom/src/proj');
    expect(expandTilde('~/foo', home)).toBe('/home/tom/foo');
  });

  test('mid-token ~ is left literal (matches shell behavior)', () => {
    expect(expandTilde('/foo/~bar', home)).toBe('/foo/~bar');
    expect(expandTilde('~user/foo', home)).toBe('~user/foo');
  });

  test('absolute path: unchanged', () => {
    expect(expandTilde('/abs/path', home)).toBe('/abs/path');
    expect(expandTilde('/', home)).toBe('/');
  });

  test('relative path: unchanged (no tilde)', () => {
    expect(expandTilde('./relative', home)).toBe('./relative');
    expect(expandTilde('bare-name', home)).toBe('bare-name');
  });

  test('empty string: unchanged', () => {
    expect(expandTilde('', home)).toBe('');
  });
});
