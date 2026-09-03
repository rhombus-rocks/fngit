import { describe, expect, test } from 'bun:test';

import { GitHubCli } from './index.js';

describe('package exports', () => {
  test('GitHubCli — the real gh implementation — is exported so a CLI can decorate it', () => {
    expect(typeof GitHubCli).toBe('function');
    const gh = new GitHubCli();
    expect(typeof gh.api).toBe('function');
    expect(typeof gh.clone).toBe('function');
  });
});
