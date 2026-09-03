import type { Func } from '@rhombus-toolkit/types';

import type { GhApiResult } from './IGitHubCli.js';

export interface FindOwnerArgs {
  name: string;
  api: Func<[string], Promise<GhApiResult>>;
}

export type FindOwnerResult = { ok: true; owner: string; } | { ok: false; reason: 'gh-failed' | 'not-found'; } | {
  ok: false;
  reason: 'ambiguous';
  owners: string[];
};

/**
 * Find which of the authenticated user's own account and organizations holds a
 * repo by this name, probing the user first and then each org in API order.
 *
 * Every candidate is probed rather than stopping at the first hit, so a name
 * two owners share comes back `ambiguous` — listing them — instead of silently
 * picking one. A failed org listing narrows the search to the user rather than
 * failing it; only having no candidates at all is `gh-failed`.
 */
export async function findOwner(args: FindOwnerArgs): Promise<FindOwnerResult> {
  const candidates: string[] = [];

  const user = await args.api('user');
  if (user.ok && user.body.trim() !== '') {
    candidates.push(user.body.trim());
  }

  const orgs = await args.api('/user/orgs');
  if (orgs.ok) {
    candidates.push(...orgs.body.split('\n').map((line) => line.trim()).filter(Boolean));
  }

  if (!candidates.length) {
    return { ok: false, reason: 'gh-failed' };
  }

  const matches: string[] = [];
  for (const owner of candidates) {
    const probe = await args.api(`repos/${owner}/${args.name}`);
    if (probe.ok) {
      matches.push(owner);
    }
  }

  if (!matches.length) {
    return { ok: false, reason: 'not-found' };
  }
  if (matches.length === 1) {
    return { ok: true, owner: matches[0]! };
  }
  return { ok: false, reason: 'ambiguous', owners: matches };
}
