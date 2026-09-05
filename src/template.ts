import type { Func } from '@rhombus-toolkit/types';

export interface TemplateResolveOk {
  ok: true;
  value: string;
}

export interface TemplateResolveErr {
  ok: false;
  error: string;
}

export type TemplateResolveResult = TemplateResolveOk | TemplateResolveErr;

/** Placeholder name to the resolver that supplies its value, called only if referenced. */
export type TemplateVars = Record<string, Func<[], TemplateResolveResult>>;

/**
 * Substitute every `{placeholder}` in `tpl` from `vars`, failing on the first
 * name `vars` doesn't carry; an unterminated `{` passes through literally.
 */
export function applyTemplate(tpl: string, vars: TemplateVars): TemplateResolveResult {
  let out = '';
  let i = 0;
  while (i < tpl.length) {
    const char = tpl[i]!;
    if (char !== '{') {
      out += char;
      i++;
      continue;
    }
    const closeIdx = tpl.indexOf('}', i + 1);
    if (closeIdx < 0) {
      out += char;
      i++;
      continue;
    }
    const name = tpl.slice(i + 1, closeIdx);
    const resolver = vars[name];
    if (!resolver) {
      return { ok: false, error: `unknown placeholder {${name}} in template ${JSON.stringify(tpl)}` };
    }
    const resolved = resolver();
    if (!resolved.ok) {
      return resolved;
    }
    out += resolved.value;
    i = closeIdx + 1;
  }
  return { ok: true, value: out };
}

/** The separator assumed between a clone path and its workspace name when none can be derived. */
export const DEFAULT_WORKTREE_MARKER = '+';

/**
 * Derive the literal text a worktree directory inserts between a clone path
 * and its workspace name — the text `worktreeTemplate` appends to
 * `cloneTemplate` before its first remaining placeholder.
 *
 * Falls back to {@link DEFAULT_WORKTREE_MARKER} when there is nothing to
 * derive: either template is empty, the worktree template doesn't extend the
 * clone template (its worktrees live elsewhere, so nothing needs telling
 * apart in the clone directory), or it appends a placeholder with no
 * separating literal.
 */
export function deriveWorktreeMarker(cloneTemplate: string, worktreeTemplate: string): string {
  if (cloneTemplate === '' || worktreeTemplate === '' || !worktreeTemplate.startsWith(cloneTemplate)) {
    return DEFAULT_WORKTREE_MARKER;
  }
  const remainder = worktreeTemplate.slice(cloneTemplate.length);
  const braceIdx = remainder.indexOf('{');
  const marker = braceIdx >= 0 ? remainder.slice(0, braceIdx) : remainder;
  return marker !== '' ? marker : DEFAULT_WORKTREE_MARKER;
}

/** The placeholders a `cloneTemplate` may reference, bound to one repo's coordinates. */
export function cloneTemplateVars(repo: string, owner: string, host: string,
  hostAliases: Readonly<Record<string, string>>): TemplateVars
{
  const dotIdx = host.indexOf('.');
  return { repo: () => ({ ok: true, value: repo }), owner: () => ({ ok: true, value: owner }),
    host: () => ({ ok: true, value: host }),
    'host-plain': () => ({ ok: true, value: dotIdx >= 0 ? host.slice(0, dotIdx) : host }), 'host-short': () => {
      const alias = hostAliases[host];
      if (alias === undefined) {
        return { ok: false,
          error: `host ${JSON.stringify(host)} has neither a built-in {host-short} default nor a `
            + 'repos.hostAliases entry; add one to ~/.config/rhombus.rocks/config.json' };
      }
      return { ok: true, value: alias };
    } };
}

/**
 * The extra placeholders a `worktreeTemplate` may reference beyond the clone
 * set: `{input}` `{branch}` `{clone-path}` `{repo-dir}` `{cwd}`. fngit cannot
 * compute real values for these — they depend on the worktree request itself,
 * which is the plugin's job, not fngit's — so each resolves to `''` here. That
 * keeps fngit's own template validation from rejecting them as unknown, while
 * still applying the clone set's real checks (`{host-short}` included).
 */
const WORKTREE_ONLY_PLACEHOLDERS = ['input', 'branch', 'clone-path', 'repo-dir', 'cwd'] as const;

/** {@link cloneTemplateVars}, extended with the worktree-only placeholders — see {@link WORKTREE_ONLY_PLACEHOLDERS}. */
export function worktreeTemplateVars(repo: string, owner: string, host: string,
  hostAliases: Readonly<Record<string, string>>): TemplateVars
{
  const vars = cloneTemplateVars(repo, owner, host, hostAliases);
  for (const placeholder of WORKTREE_ONLY_PLACEHOLDERS) {
    vars[placeholder] = () => ({ ok: true, value: '' });
  }
  return vars;
}
