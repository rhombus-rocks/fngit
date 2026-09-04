/** A reference to a repository as the user typed it, parsed into its parts. */
export interface RepoRef {
  /** The host the reference named, or `''` when it carried none. */
  host: string;
  /** The owner the reference named, or `''` for a bare name awaiting lookup. */
  owner: string;
  name: string;
  /** The `+workspace` suffix, or `''` when the reference carried none. */
  workspace: string;
  original: string;
}

export interface ParseRepoRefOk {
  ok: true;
  ref: RepoRef;
}

export interface ParseRepoRefErr {
  ok: false;
  error: string;
}

export type ParseRepoRefResult = ParseRepoRefOk | ParseRepoRefErr;

const URL_RE = /^(?:(?:https?|ssh):\/\/(?:[^@/]+@)?)([^:/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;
const SCP_RE = /^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

/**
 * Parse one of the reference forms below, each accepting an optional
 * `+workspace` suffix, into its parts — pure string work, no filesystem or
 * network.
 *
 * ```text
 * <name>                                    → { name }
 * <name>@<owner>                            → { name, owner }
 * <owner>/<name>                            → { owner, name }
 * gh:<owner>/<name>                         → { owner, name, host: 'github.com' }
 * https://<host>/<owner>/<name>[.git]       → { host, owner, name }
 * http://…                                  → same
 * git@<host>:<owner>/<name>[.git]           → { host, owner, name }
 * ssh://[user@]<host>/<owner>/<name>[.git]  → { host, owner, name }
 * ```
 */
export function parseRepoRef(input: string): ParseRepoRefResult {
  if (input === '') {
    return { ok: false, error: 'empty repo reference' };
  }
  if (isPathLike(input)) {
    return { ok: false, error: `path-like reference ${JSON.stringify(input)} is not a repo shorthand` };
  }
  let body = input;
  let workspace = '';
  const plusIdx = body.indexOf('+');
  if (plusIdx === 0) {
    return { ok: false, error: `no repo reference before \`+\` in ${JSON.stringify(input)}` };
  }
  // A `+workspace` suffix only ever trails the name, so a `+` with a later `/`
  // sits inside a URL/scp path and stays part of it rather than being split off.
  if (plusIdx > 0 && body.indexOf('/', plusIdx) < 0) {
    workspace = body.slice(plusIdx + 1);
    body = body.slice(0, plusIdx);
    if (workspace === '') {
      return { ok: false, error: `empty workspace after \`+\` in ${JSON.stringify(input)}` };
    }
  }

  const parsed = (parts: { host?: string; owner?: string; name: string; }): ParseRepoRefOk => ({ ok: true,
    ref: { host: parts.host ?? '', owner: parts.owner ?? '', name: parts.name, workspace, original: input } });

  const urlMatch = URL_RE.exec(body);
  if (urlMatch) {
    return parsed({ host: urlMatch[1]!, owner: urlMatch[2]!, name: urlMatch[3]! });
  }

  const scpMatch = SCP_RE.exec(body);
  if (scpMatch) {
    return parsed({ host: scpMatch[1]!, owner: scpMatch[2]!, name: scpMatch[3]! });
  }

  if (body.startsWith('gh:')) {
    const rest = body.slice(3);
    const slashIdx = rest.indexOf('/');
    if (slashIdx <= 0 || slashIdx >= rest.length - 1) {
      return { ok: false, error: `gh: form requires owner/name, got ${JSON.stringify(input)}` };
    }
    const owner = rest.slice(0, slashIdx);
    const name = rest.slice(slashIdx + 1);
    if (/[/@:]/.test(owner) || /[/@:]/.test(name)) {
      return { ok: false, error: `invalid gh: form: ${JSON.stringify(input)}` };
    }
    return parsed({ host: 'github.com', owner, name });
  }

  const slashIdx = body.indexOf('/');
  if (slashIdx > 0) {
    if (body.indexOf('/', slashIdx + 1) >= 0) {
      return { ok: false, error: `ambiguous form ${JSON.stringify(input)} (multiple slashes)` };
    }
    const owner = body.slice(0, slashIdx);
    const name = body.slice(slashIdx + 1);
    if (/[@:]/.test(owner) || /[@:]/.test(name) || owner === '' || name === '' || isDotSegment(owner)
      || isDotSegment(name))
    {
      return { ok: false, error: `invalid owner/name form: ${JSON.stringify(input)}` };
    }
    return parsed({ owner, name });
  }

  const atIdx = body.indexOf('@');
  if (atIdx > 0) {
    const name = body.slice(0, atIdx);
    const owner = body.slice(atIdx + 1);
    if (/[@:/]/.test(owner) || /[@:/]/.test(name) || owner === '' || name === '') {
      return { ok: false, error: `invalid name@owner form: ${JSON.stringify(input)}` };
    }
    return parsed({ name, owner });
  }

  // A leftover `/`, `@` or `:` means a leading or stray separator no form
  // claimed (`@owner`, `:name`, `host:tag`); a clean bare name falls through.
  if (/[/@:]/.test(body)) {
    return { ok: false, error: `unparseable repo reference: ${JSON.stringify(input)}` };
  }
  return parsed({ name: body });
}

/** Whether a segment is the current- or parent-directory marker, which no repo owner or name is. */
function isDotSegment(segment: string): boolean {
  return segment === '.' || segment === '..';
}

const DRIVE_LETTER_RE = /^[A-Za-z]:[\\/]/;

/** Whether the input looks like a filesystem path rather than a repo reference. */
export function isPathLike(input: string): boolean {
  // POSIX: /, ~, ./, ../
  // Windows: \, \\, .\, ..\, drive letter (C:\, D:/)
  return input.startsWith('/') || input.startsWith('~') || input.startsWith('./') || input.startsWith('../')
    || input.startsWith('.\\') || input.startsWith('..\\') || input.startsWith('\\') || DRIVE_LETTER_RE.test(input);
}

/** Whether the reference named an owner, rather than leaving it to a lookup. */
export function hasResolvedOwner(ref: RepoRef): boolean {
  return ref.owner !== '';
}

/** The reference's host, defaulting to `github.com` when it named none. */
export function effectiveHost(ref: RepoRef): string {
  return ref.host !== '' ? ref.host : 'github.com';
}
