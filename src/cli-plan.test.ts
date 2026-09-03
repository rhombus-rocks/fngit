import { describe, expect, test } from 'bun:test';

import { planInvocation, renderLocateFailure } from './cli-plan.js';
import type { LocateFailure } from './LocateError.js';
import type { RepoRef } from './RepoRef.js';

describe('planInvocation', () => {
  test('no arguments at all — passthrough', () => {
    expect(planInvocation([])).toEqual({ kind: 'passthrough', args: [] });
  });

  test('a non-clone subcommand — passthrough', () => {
    expect(planInvocation(['status'])).toEqual({ kind: 'passthrough', args: ['status'] });
  });

  test('clone with no ref — passthrough', () => {
    expect(planInvocation(['clone'])).toEqual({ kind: 'passthrough', args: ['clone'] });
  });

  test('clone with a flag first — passthrough', () => {
    expect(planInvocation(['clone', '--depth', '1', 'fnclaude'])).toEqual({ kind: 'passthrough',
      args: ['clone', '--depth', '1', 'fnclaude'] });
  });

  test('clone with a short flag first — passthrough', () => {
    expect(planInvocation(['clone', '-b', 'main', 'fnclaude'])).toEqual({ kind: 'passthrough',
      args: ['clone', '-b', 'main', 'fnclaude'] });
  });

  test('clone with a bare ref and nothing else — decorated', () => {
    expect(planInvocation(['clone', 'fnclaude'])).toEqual({ kind: 'clone', input: 'fnclaude', cloneArgs: [] });
  });

  test('clone with a bare ref and flags after it — decorated, flags forwarded', () => {
    expect(planInvocation(['clone', 'fnclaude', '--depth', '1'])).toEqual({ kind: 'clone', input: 'fnclaude',
      cloneArgs: ['--depth', '1'] });
  });

  test('clone with a ref and an explicit destination — passthrough (two positionals)', () => {
    expect(planInvocation(['clone', 'fnclaude', 'mydir'])).toEqual({ kind: 'passthrough',
      args: ['clone', 'fnclaude', 'mydir'] });
  });

  test('clone of a relative filesystem path — passthrough, not treated as a ref', () => {
    expect(planInvocation(['clone', './local-path'])).toEqual({ kind: 'passthrough', args: ['clone', './local-path'] });
  });

  test('clone of an absolute filesystem path — passthrough', () => {
    expect(planInvocation(['clone', '/abs/path'])).toEqual({ kind: 'passthrough', args: ['clone', '/abs/path'] });
  });

  test('clone of a home-relative filesystem path — passthrough', () => {
    expect(planInvocation(['clone', '~/local-path'])).toEqual({ kind: 'passthrough', args: ['clone', '~/local-path'] });
  });

  test('clone of a ref that fails to parse — passthrough', () => {
    expect(planInvocation(['clone', 'a/b/c'])).toEqual({ kind: 'passthrough', args: ['clone', 'a/b/c'] });
  });

  test('clone of an owner/name ref — decorated', () => {
    expect(planInvocation(['clone', 'owner/fnclaude'])).toEqual({ kind: 'clone', input: 'owner/fnclaude',
      cloneArgs: [] });
  });

  test('clone of a URL ref — decorated', () => {
    expect(planInvocation(['clone', 'https://github.com/a/b'])).toEqual({ kind: 'clone',
      input: 'https://github.com/a/b', cloneArgs: [] });
  });

  test('clone of a ref with a +workspace suffix — rejected as unsupported', () => {
    expect(planInvocation(['clone', 'fnclaude+myws'])).toEqual({ kind: 'reject-workspace', input: 'fnclaude+myws' });
  });

  test('clone of a gh: ref with a +workspace suffix — rejected as unsupported', () => {
    expect(planInvocation(['clone', 'gh:owner/name+ws'])).toEqual({ kind: 'reject-workspace',
      input: 'gh:owner/name+ws' });
  });
});

describe('renderLocateFailure', () => {
  function ref(): RepoRef {
    return { host: '', owner: 'fnrhombus', name: 'fnclaude', workspace: '', original: 'fnclaude@fnrhombus' };
  }

  test('unparseable — exit 1, no extra lines', () => {
    const failure: LocateFailure = { reason: 'unparseable', input: 'x', message: 'bad' };
    expect(renderLocateFailure(failure)).toEqual({ exitCode: 1, extraLines: [] });
  });

  test('config — exit 1, no extra lines', () => {
    const failure: LocateFailure = { reason: 'config', message: 'no cloneTemplate' };
    expect(renderLocateFailure(failure)).toEqual({ exitCode: 1, extraLines: [] });
  });

  test('gh-failed — exit 1, no extra lines', () => {
    const failure: LocateFailure = { reason: 'gh-failed', message: 'no gh' };
    expect(renderLocateFailure(failure)).toEqual({ exitCode: 1, extraLines: [] });
  });

  test('not-found — exit 1, no extra lines', () => {
    const failure: LocateFailure = { reason: 'not-found', ref: ref() };
    expect(renderLocateFailure(failure)).toEqual({ exitCode: 1, extraLines: [] });
  });

  test('clone-failed — exit 1, no extra lines', () => {
    const failure: LocateFailure = { reason: 'clone-failed', ref: ref(), url: 'u', destination: 'd', stderr: '',
      repoNotFound: true };
    expect(renderLocateFailure(failure)).toEqual({ exitCode: 1, extraLines: [] });
  });

  test('ambiguous-owner — exit 1, one owner per line', () => {
    const failure: LocateFailure = { reason: 'ambiguous-owner', ref: ref(), owners: ['a', 'b'] };
    expect(renderLocateFailure(failure)).toEqual({ exitCode: 1, extraLines: ['a', 'b'] });
  });

  test('ambiguous-local — exit 1, one path per line', () => {
    const failure: LocateFailure = { reason: 'ambiguous-local', ref: ref(), paths: ['/p1', '/p2'] };
    expect(renderLocateFailure(failure)).toEqual({ exitCode: 1, extraLines: ['/p1', '/p2'] });
  });
});
