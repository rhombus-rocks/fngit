import { assertNever } from '@rhombus-toolkit/type-guards';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';

import { buildCloneUrl, cloneRepo, computeCloneDestination, isRepoNotFoundError } from './clone.js';
import { GitHubCli, type IGitHubCli } from './IGitHubCli.js';
import { findLocalClones, type LocalClone } from './local-clones.js';
import { LocateError } from './LocateError.js';
import { findOwner } from './owner-lookup.js';
import { effectiveHost, hasResolvedOwner, parseRepoRef, type RepoRef } from './RepoRef.js';
import { loadLocateSettings, type LocateSettings } from './settings.js';
import { findInSrcDirs } from './src-dirs.js';
import { applyTemplate, cloneTemplateVars } from './template.js';

/** A repository that already exists on disk. */
export type LocalRepo = { type: 'local'; path: string; ref: RepoRef; };

/** A repository that isn't on disk yet, and where it would be cloned from and to. */
export type RemoteRepo = { type: 'remote'; url: string; destination: string; ref: RepoRef; };

export type Located = LocalRepo | RemoteRepo;

export interface LocateOptions {
  /** Clone a `remote` result to its destination before returning, so the result is always `local`. */
  clone?: boolean;
  /** Per-field overlay on whatever the config file supplies. */
  settings?: Partial<LocateSettings>;
  /** Root for `~` expansion and the config-file lookup; defaults to the current user's home. */
  home?: string;
  /** An `IGitHubCli` to call in place of the real `gh` spawner; inject a fake in tests. */
  gh?: IGitHubCli;
  /** Extra arguments for `git clone`, honoured only alongside `clone`. */
  cloneArgs?: readonly string[];
}

export function locate(input: string, options: LocateOptions & { clone: true; }): Promise<LocalRepo>;
export function locate(input: string, options?: LocateOptions): Promise<Located>;

/**
 * Resolve a user-typed repo reference to the checkout it names, preferring
 * whatever is already on disk and falling back to where it would be cloned
 * from.
 *
 * @throws LocateError with a {@link LocateError.failure} saying which of the
 * resolution steps gave out.
 */
export async function locate(input: string, options: LocateOptions = {}): Promise<Located> {
  const parsed = parseRepoRef(input);
  if (!parsed.ok) {
    throw new LocateError({ reason: 'unparseable', input, message: parsed.error });
  }

  const home = options.home ?? homedir();
  const settings = overlaySettings(loadLocateSettings({ home }), options.settings);
  validateCloneTemplate(settings, parsed.ref);
  const gh = options.gh ?? new GitHubCli();

  const located = hasResolvedOwner(parsed.ref)
    ? locateWithOwner(parsed.ref, settings, home)
    : await locateBareName(parsed.ref, settings, home, gh);

  if (options.clone !== true || located.type === 'local') {
    return located;
  }

  const cloned = await cloneRepo({ url: located.url, destination: located.destination, gh,
    cloneArgs: options.cloneArgs });
  if (!cloned.ok) {
    throw new LocateError({ reason: 'clone-failed', ref: located.ref, url: located.url,
      destination: located.destination, stderr: cloned.stderr, repoNotFound: isRepoNotFoundError(cloned.stderr) });
  }
  return { type: 'local', path: located.destination, ref: located.ref };
}

/**
 * Reject a broken clone template up front — an empty template, an unknown
 * placeholder, or a `{host-short}` with no alias — so a bare name fails `config`
 * before any disk scan or gh call rather than surfacing as a misleading miss.
 */
function validateCloneTemplate(settings: LocateSettings, ref: RepoRef): void {
  if (settings.cloneTemplate === '') {
    throw new LocateError({ reason: 'config',
      message: 'repos.cloneTemplate is not configured; cannot resolve repo references. '
        + 'Set it in ~/.config/rhombus.rocks/config.json (e.g. "~/src/{repo}@{owner}"), or run `fngit install`.' });
  }
  const probe = applyTemplate(settings.cloneTemplate,
    cloneTemplateVars(ref.name, ref.owner || 'owner', effectiveHost(ref), settings.hostAliases));
  if (!probe.ok) {
    throw new LocateError({ reason: 'config', message: probe.error });
  }
}

function overlaySettings(base: LocateSettings, overlay: Partial<LocateSettings> = {}): LocateSettings {
  return { cloneTemplate: overlay.cloneTemplate ?? base.cloneTemplate,
    worktreeTemplate: overlay.worktreeTemplate ?? base.worktreeTemplate,
    additionalSrcDirs: overlay.additionalSrcDirs ?? base.additionalSrcDirs,
    hostAliases: overlay.hostAliases ?? base.hostAliases };
}

/**
 * A name with no owner, settled by disk first — the clone template's own root,
 * then the extra source roots — and only then by asking GitHub who owns it.
 */
async function locateBareName(ref: RepoRef, settings: LocateSettings, home: string, gh: IGitHubCli): Promise<Located> {
  const clones = findLocalClones({ name: ref.name, template: settings.cloneTemplate,
    worktreeTemplate: settings.worktreeTemplate, host: effectiveHost(ref), hostAliases: settings.hostAliases, home });
  if (!clones.ok) {
    throw new LocateError({ reason: 'config', message: clones.error });
  }
  if (clones.clones.length) {
    return resolveDiskHit(clones.clones, ref);
  }

  const inSrcDirs = searchSrcDirs(ref, null, settings, home);
  if (inSrcDirs.length) {
    return resolveDiskHit(inSrcDirs, ref);
  }

  const owner = await findOwner({ name: ref.name, api: (path) => gh.api(path) });
  if (owner.ok) {
    // The owner-null pass above already searched additionalSrcDirs — a superset
    // of what this owner could match — so skip that search the second time.
    return locateWithOwner({ ...ref, owner: owner.owner }, settings, home, false);
  }
  switch (owner.reason) {
    case 'gh-failed': {
      throw new LocateError({ reason: 'gh-failed',
        message: `bare name "${ref.name}" — gh CLI lookup failed (not authenticated? no network?). `
          + `Try \`gh auth login\` or pass the owner explicitly (\`${ref.name}@<owner>\`).` });
    }
    case 'not-found': {
      throw new LocateError({ reason: 'not-found', ref });
    }
    case 'ambiguous': {
      throw new LocateError({ reason: 'ambiguous-owner', ref, owners: owner.owners });
    }
    default: {
      return assertNever(owner);
    }
  }
}

/**
 * A reference whose owner is known: the templated destination if it exists, an
 * extra source root if one holds it, and otherwise the clone that would create
 * it.
 */
function locateWithOwner(ref: RepoRef, settings: LocateSettings, home: string, searchExtraDirs = true): Located {
  const destination = computeCloneDestination({ ref, template: settings.cloneTemplate,
    hostAliases: settings.hostAliases, home });
  if (!destination.ok) {
    throw new LocateError({ reason: 'config', message: destination.error });
  }
  if (isDirectory(destination.path)) {
    return { type: 'local', path: destination.path, ref };
  }

  if (searchExtraDirs) {
    // A resolved owner matches at most one path per root, so this can't be ambiguous.
    const inSrcDirs = searchSrcDirs(ref, ref.owner, settings, home);
    if (inSrcDirs.length) {
      return { type: 'local', path: inSrcDirs[0]!.path, ref };
    }
  }

  return { type: 'remote', url: buildCloneUrl(ref), destination: destination.path, ref };
}

function searchSrcDirs(ref: RepoRef, owner: string | null, settings: LocateSettings, home: string): LocalClone[] {
  return findInSrcDirs({ name: ref.name, owner, srcDirs: settings.additionalSrcDirs,
    cloneTemplate: settings.cloneTemplate, worktreeTemplate: settings.worktreeTemplate, host: effectiveHost(ref),
    hostAliases: settings.hostAliases, home });
}

/** Settle a set of disk hits: the single checkout, filling in the owner the scan recovered, or ambiguous. */
function resolveDiskHit(clones: readonly LocalClone[], ref: RepoRef): LocalRepo {
  if (clones.length > 1) {
    throw new LocateError({ reason: 'ambiguous-local', ref, paths: clones.map((clone) => clone.path) });
  }
  const hit = clones[0]!;
  return { type: 'local', path: hit.path, ref: { ...ref, owner: hit.owner || ref.owner } };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
