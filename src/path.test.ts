import { describe, expect, test } from 'bun:test';
import { join, normalize } from 'node:path';

import { expandTilde } from './path.js';

describe('expandTilde', () => {
  const home = '/home/tom';

  test('bare ~ becomes home', () => {
    expect(expandTilde('~', home)).toBe(home);
  });

  test('~/ prefix becomes home/...', () => {
    expect(expandTilde('~/src/proj', home)).toBe(normalize(join(home, 'src/proj')));
    expect(expandTilde('~/foo', home)).toBe(normalize(join(home, 'foo')));
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

  test('~\\ prefix expands on win32', () => {
    const winHome = 'C:\\Users\\tom';
    expect(expandTilde('~\\src\\proj', winHome)).toMatch(/^C:\\Users\\tom/);
  });

  test('~\\ with a POSIX home still works', () => {
    const result = expandTilde('~\\foo', home);
    expect(result).toContain('home');
    expect(result).toContain('tom');
    expect(result).toContain('foo');
  });
});
