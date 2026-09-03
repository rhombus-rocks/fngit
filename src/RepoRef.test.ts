import { describe, expect, test } from 'bun:test';

import { effectiveHost, hasResolvedOwner, parseRepoRef, type ParseRepoRefResult, type RepoRef } from './RepoRef.js';

function assertOk(result: ParseRepoRefResult): RepoRef {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('test bug: expected ok');
  }
  return result.ref;
}

describe('parseRepoRef — supported forms', () => {
  test('bare name', () => {
    expect(assertOk(parseRepoRef('arch-setup'))).toEqual({ host: '', owner: '', name: 'arch-setup', workspace: '',
      original: 'arch-setup' });
  });

  test('name@owner', () => {
    const ref = assertOk(parseRepoRef('arch-setup@fnrhombus'));
    expect(ref.name).toBe('arch-setup');
    expect(ref.owner).toBe('fnrhombus');
    expect(ref.host).toBe('');
    expect(ref.workspace).toBe('');
  });

  test('owner/name', () => {
    const ref = assertOk(parseRepoRef('fnrhombus/arch-setup'));
    expect(ref.owner).toBe('fnrhombus');
    expect(ref.name).toBe('arch-setup');
    expect(ref.host).toBe('');
  });

  test('gh:owner/name', () => {
    const ref = assertOk(parseRepoRef('gh:fnrhombus/arch-setup'));
    expect(ref.host).toBe('github.com');
    expect(ref.owner).toBe('fnrhombus');
    expect(ref.name).toBe('arch-setup');
  });

  test('https URL', () => {
    const ref = assertOk(parseRepoRef('https://github.com/fnrhombus/arch-setup'));
    expect(ref.host).toBe('github.com');
    expect(ref.owner).toBe('fnrhombus');
    expect(ref.name).toBe('arch-setup');
  });

  test('https URL with .git suffix', () => {
    expect(assertOk(parseRepoRef('https://github.com/fnrhombus/arch-setup.git')).name).toBe('arch-setup');
  });

  test('http (not https) URL', () => {
    const ref = assertOk(parseRepoRef('http://github.com/fnrhombus/arch-setup'));
    expect(ref.host).toBe('github.com');
    expect(ref.name).toBe('arch-setup');
  });

  test('ssh URL', () => {
    const ref = assertOk(parseRepoRef('ssh://git@github.com/fnrhombus/arch-setup.git'));
    expect(ref.host).toBe('github.com');
    expect(ref.owner).toBe('fnrhombus');
    expect(ref.name).toBe('arch-setup');
  });

  test('git@host:owner/name (scp-style ssh)', () => {
    const ref = assertOk(parseRepoRef('git@github.com:fnrhombus/arch-setup.git'));
    expect(ref.host).toBe('github.com');
    expect(ref.owner).toBe('fnrhombus');
    expect(ref.name).toBe('arch-setup');
  });

  test('git@host:owner/name (no .git suffix)', () => {
    const ref = assertOk(parseRepoRef('git@gitlab.com:org/name'));
    expect(ref.host).toBe('gitlab.com');
    expect(ref.owner).toBe('org');
    expect(ref.name).toBe('name');
  });
});

describe('parseRepoRef — workspace suffix', () => {
  test('name@owner+workspace', () => {
    const ref = assertOk(parseRepoRef('arch-setup@fnrhombus+my-feature'));
    expect(ref.name).toBe('arch-setup');
    expect(ref.owner).toBe('fnrhombus');
    expect(ref.workspace).toBe('my-feature');
  });

  test('bare-name+workspace', () => {
    const ref = assertOk(parseRepoRef('arch-setup+my-feature'));
    expect(ref.name).toBe('arch-setup');
    expect(ref.workspace).toBe('my-feature');
  });

  test('owner/name+workspace', () => {
    const ref = assertOk(parseRepoRef('fnrhombus/arch-setup+my-feature'));
    expect(ref.owner).toBe('fnrhombus');
    expect(ref.name).toBe('arch-setup');
    expect(ref.workspace).toBe('my-feature');
  });

  test('empty workspace after `+` is an error', () => {
    const result = parseRepoRef('arch-setup+');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/empty workspace/);
    }
  });
});

describe('parseRepoRef — error cases', () => {
  test('empty input', () => {
    const result = parseRepoRef('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/empty repo/);
    }
  });

  test('a/b/c (multiple slashes, no scheme)', () => {
    const result = parseRepoRef('a/b/c');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/ambiguous|unparseable/);
    }
  });

  test('gh: with no owner/name', () => {
    expect(parseRepoRef('gh:onlyname').ok).toBe(false);
  });

  test('owner with @ in it', () => {
    expect(parseRepoRef('owner/@something').ok).toBe(false);
  });

  test('a leading-slash absolute path is unparseable, not owner/name', () => {
    expect(parseRepoRef('/home/user/repo').ok).toBe(false);
  });

  test('a ./ relative path is unparseable', () => {
    const result = parseRepoRef('./local-path');
    expect(result.ok).toBe(false);
  });

  test('a ../ relative path is unparseable', () => {
    expect(parseRepoRef('../sibling/repo').ok).toBe(false);
  });

  test('a ~-rooted path is unparseable', () => {
    expect(parseRepoRef('~/src/repo').ok).toBe(false);
  });

  test('a `.` name segment is unparseable', () => {
    expect(parseRepoRef('owner/.').ok).toBe(false);
  });

  test('a `..` name segment is unparseable', () => {
    expect(parseRepoRef('sub/..').ok).toBe(false);
  });
});

describe('hasResolvedOwner', () => {
  test('false when only bare name', () => {
    expect(hasResolvedOwner(assertOk(parseRepoRef('arch-setup')))).toBe(false);
  });

  test('true when name@owner', () => {
    expect(hasResolvedOwner(assertOk(parseRepoRef('arch-setup@fnrhombus')))).toBe(true);
  });

  test('true when URL', () => {
    expect(hasResolvedOwner(assertOk(parseRepoRef('https://github.com/fnrhombus/arch-setup')))).toBe(true);
  });
});

describe('effectiveHost', () => {
  test('defaults to github.com when host empty', () => {
    expect(effectiveHost(assertOk(parseRepoRef('arch-setup')))).toBe('github.com');
  });

  test('keeps explicit host (gitlab)', () => {
    expect(effectiveHost(assertOk(parseRepoRef('https://gitlab.com/org/name')))).toBe('gitlab.com');
  });

  test('keeps explicit host from scp form', () => {
    expect(effectiveHost(assertOk(parseRepoRef('git@bitbucket.org:org/name')))).toBe('bitbucket.org');
  });
});
