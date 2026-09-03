import { assertNever } from '@rhombus-toolkit/type-guards';

import type { RepoRef } from './RepoRef.js';

/** Why a locate could not produce a result. */
export type LocateFailure = { reason: 'unparseable'; input: string; message: string; } | { reason: 'config';
  message: string; } | { reason: 'gh-failed'; message: string; } | { reason: 'not-found'; ref: RepoRef; } | {
  reason: 'ambiguous-owner';
  ref: RepoRef;
  owners: readonly string[];
} | { reason: 'ambiguous-local'; ref: RepoRef; paths: readonly string[]; } | { reason: 'clone-failed'; ref: RepoRef;
  url: string; destination: string; stderr: string; repoNotFound: boolean; };

/** The rejection a failed locate carries, with the structured failure behind the message. */
export class LocateError extends Error {
  readonly failure: LocateFailure;

  constructor(failure: LocateFailure) {
    super(describeFailure(failure));
    this.name = 'LocateError';
    this.failure = failure;
  }
}

/** How to name an owner explicitly, appended to every message that asks the user to. */
function suggestExplicitOwner(name: string): string {
  return `Disambiguate by passing the owner explicitly (\`${name}@<owner>\` or \`<owner>/${name}\`).`;
}

function describeFailure(failure: LocateFailure): string {
  switch (failure.reason) {
    case 'unparseable':
    case 'config':
    case 'gh-failed': {
      return failure.message;
    }
    case 'not-found': {
      return `no repo named "${failure.ref.name}" found under your gh user or any of your orgs.`;
    }
    case 'ambiguous-owner': {
      const owners = failure.owners.map((owner) => `${owner}/${failure.ref.name}`).join(', ');
      return `ambiguous bare name "${failure.ref.name}" — found under multiple owners: ${owners}. `
        + suggestExplicitOwner(failure.ref.name);
    }
    case 'ambiguous-local': {
      return `ambiguous bare name "${failure.ref.name}" — multiple local checkouts: ${failure.paths.join(', ')}. `
        + suggestExplicitOwner(failure.ref.name);
    }
    case 'clone-failed': {
      const detail = failure.repoNotFound ? 'the repository does not exist' : failure.stderr.trim();
      return `failed to clone ${failure.url} into ${failure.destination}${detail === '' ? '' : `: ${detail}`}`;
    }
    default: {
      return assertNever(failure);
    }
  }
}
