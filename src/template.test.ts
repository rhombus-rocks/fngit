import { describe, expect, test } from 'bun:test';

import { applyTemplate, cloneTemplateVars, deriveWorktreeMarker, type TemplateVars } from './template.js';

const ok = (value: string) => ({ ok: true as const, value });

describe('applyTemplate — substitution', () => {
  test('every variable resolved', () => {
    const vars: TemplateVars = { repo: () => ok('myrepo'), owner: () => ok('myorg') };
    expect(applyTemplate('~/src/{repo}@{owner}', vars)).toEqual(ok('~/src/myrepo@myorg'));
  });

  test('unknown placeholder errors with the placeholder name', () => {
    const result = applyTemplate('{repo}/{unknown}', { repo: () => ok('x') });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('{unknown}');
    }
  });

  test('lazy resolver not called when not referenced', () => {
    let called = false;
    const vars: TemplateVars = { repo: () => ok('x'), owner: () => {
      called = true;
      return ok('');
    } };
    applyTemplate('{repo}', vars);
    expect(called).toBe(false);
  });

  test('resolver error propagated', () => {
    const result = applyTemplate('{x}', { x: () => ({ ok: false, error: 'boom' }) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('boom');
    }
  });

  test('unterminated brace passes through literally', () => {
    expect(applyTemplate('foo{unclosed', {})).toEqual(ok('foo{unclosed'));
  });

  test('no placeholders: pass through verbatim', () => {
    expect(applyTemplate('plain string', {})).toEqual(ok('plain string'));
  });

  test('empty string: empty output', () => {
    expect(applyTemplate('', {})).toEqual(ok(''));
  });

  test('multiple references to the same placeholder', () => {
    expect(applyTemplate('{x} {x} {x}', { x: () => ok('hi') })).toEqual(ok('hi hi hi'));
  });
});

describe('cloneTemplateVars', () => {
  test('repo + owner basic substitution', () => {
    const vars = cloneTemplateVars('myrepo', 'myorg', 'github.com', { 'github.com': 'gh' });
    expect(applyTemplate('~/src/{repo}@{owner}', vars)).toEqual(ok('~/src/myrepo@myorg'));
  });

  test('host-plain strips the TLD', () => {
    expect(applyTemplate('{host-plain}', cloneTemplateVars('r', 'o', 'github.com', {}))).toEqual(ok('github'));
  });

  test('host-plain falls back to the full host when it has no dot', () => {
    expect(applyTemplate('{host-plain}', cloneTemplateVars('r', 'o', 'localhost', {}))).toEqual(ok('localhost'));
  });

  test('host-short hit', () => {
    const vars = cloneTemplateVars('r', 'o', 'github.com', { 'github.com': 'gh', 'gitlab.com': 'gl' });
    expect(applyTemplate('{host-short}', vars)).toEqual(ok('gh'));
  });

  test('host-short miss: error names the host', () => {
    const vars = cloneTemplateVars('r', 'o', 'github.example.com', { 'github.com': 'gh' });
    const result = applyTemplate('{host-short}', vars);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('github.example.com');
    }
  });

  test('host-short LUT miss does NOT error if not referenced', () => {
    const vars = cloneTemplateVars('r', 'o', 'weird.host.example', {});
    expect(applyTemplate('{repo}@{owner}', vars)).toEqual(ok('r@o'));
  });

  test('every placeholder together', () => {
    const vars = cloneTemplateVars('arch-setup', 'fnrhombus', 'github.com', { 'github.com': 'gh' });
    expect(applyTemplate('~/src/{host-short}/{owner}/{repo}', vars)).toEqual(ok('~/src/gh/fnrhombus/arch-setup'));
  });
});

describe('deriveWorktreeMarker', () => {
  test('the literal before the first remaining placeholder is the marker', () => {
    expect(deriveWorktreeMarker('~/src/{repo}@{owner}', '~/src/{repo}@{owner}+{input}')).toBe('+');
  });

  test('multi-char custom separator is derived verbatim', () => {
    expect(deriveWorktreeMarker('~/src/{repo}@{owner}', '~/src/{repo}@{owner}--wt--{input}')).toBe('--wt--');
  });

  test('absent worktreeTemplate falls back to the + default', () => {
    expect(deriveWorktreeMarker('~/src/{repo}@{owner}', '')).toBe('+');
  });

  test('worktreeTemplate not sharing the clone prefix falls back to the + default', () => {
    expect(deriveWorktreeMarker('~/src/{repo}@{owner}', '~/wt/{repo}-{input}')).toBe('+');
  });

  test('worktreeTemplate equal to cloneTemplate falls back to the + default', () => {
    expect(deriveWorktreeMarker('~/src/{repo}@{owner}', '~/src/{repo}@{owner}')).toBe('+');
  });
});
