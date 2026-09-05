import type { PluginState } from './plugin.js';
import type { ReposPatch } from './settings-writer.js';
import { BUILTIN_HOST_ALIASES, type LocateSettings } from './settings.js';
import type { ShellType } from './shim.js';

// ─── IPrompter ───────────────────────────────────────────────────────────────

/** Service interface for gathering answers from the user; the readline implementation asks, the test double scripts. */
export interface IPrompter {
  ask(question: string, defaultValue: string): Promise<string>;
  confirm(question: string, defaultValue: boolean): Promise<boolean>;
  print(message: string): void;
}

// ─── Options (parsed CLI args) ───────────────────────────────────────────────

export interface InstallOptions {
  cloneTemplate?: string;
  worktreeTemplate?: string;
  additionalSrcDirs?: readonly string[];
  hostAliases?: Readonly<Record<string, string>>;
  plugin?: boolean;
  shadowGit?: boolean;
  yes: boolean;
  dryRun: boolean;
  removeShadow: boolean;
  help: boolean;
}

export type ParseInstallArgsResult = { ok: true; options: InstallOptions; } | { ok: false; };

/** Parse `fngit install` arguments; returns `ok: false` for any unrecognised arg. */
export function parseInstallArgs(argv: readonly string[]): ParseInstallArgsResult {
  const options: InstallOptions = { yes: false, dryRun: false, removeShadow: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--clone-template': {
        const value = argv[++i];
        if (value === undefined) {
          return { ok: false };
        }
        options.cloneTemplate = value;
        break;
      }
      case '--worktree-template': {
        const value = argv[++i];
        if (value === undefined) {
          return { ok: false };
        }
        options.worktreeTemplate = value;
        break;
      }
      case '--additional-src-dirs': {
        const value = argv[++i];
        if (value === undefined) {
          return { ok: false };
        }
        const dirs = value.split(',').map((d) => d.trim()).filter(Boolean);
        options.additionalSrcDirs = [...(options.additionalSrcDirs ?? []), ...dirs];
        break;
      }
      case '--host-alias': {
        const value = argv[++i];
        if (value === undefined) {
          return { ok: false };
        }
        const eqIdx = value.indexOf('=');
        if (eqIdx <= 0) {
          return { ok: false };
        }
        options.hostAliases = { ...(options.hostAliases ?? {}), [value.slice(0, eqIdx)]: value.slice(eqIdx + 1) };
        break;
      }
      case '--plugin': {
        options.plugin = true;
        break;
      }
      case '--no-plugin': {
        options.plugin = false;
        break;
      }
      case '--shadow-git': {
        options.shadowGit = true;
        break;
      }
      case '--no-shadow-git': {
        options.shadowGit = false;
        break;
      }
      case '--yes': {
        options.yes = true;
        break;
      }
      case '--dry-run': {
        options.dryRun = true;
        break;
      }
      case '--remove-shadow': {
        options.removeShadow = true;
        break;
      }
      case '--help': {
        options.help = true;
        break;
      }
      default: {
        return { ok: false };
      }
    }
  }

  return { ok: true, options };
}

// ─── Environment ─────────────────────────────────────────────────────────────

export interface ShadowTarget {
  path: string;
  shell: ShellType;
}

export interface InstallEnv {
  currentSettings: LocateSettings;
  /** Where `repos.*` will be written — the file the reader would resolve to, whether or not it exists yet. */
  configPath: string;
  configFileExists: boolean;
  shimDir: string;
  shadowTargets: readonly ShadowTarget[];
  claudeOnPath: boolean;
  pluginState: PluginState;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export type InstallAction = { kind: 'write-settings'; patch: ReposPatch; description: string; } | {
  kind: 'write-shim-script';
  shell: ShellType;
  description: string;
} | { kind: 'write-shadow-block'; path: string; shell: ShellType; description: string; } | { kind: 'remove-shadow';
  shimDir: string; targets: readonly ShadowTarget[]; description: string; } | { kind: 'sync-plugin';
  description: string; };

/** Print a human-readable description for each action; used by `--dry-run`. */
export function describePlan(actions: readonly InstallAction[]): string {
  if (!actions.length) {
    return 'Nothing to do — configuration is already up to date.';
  }
  return actions.map((action) => `  • ${action.description}`).join('\n');
}

// ─── Answers ─────────────────────────────────────────────────────────────────

export interface InstallAnswers {
  cloneTemplate: string;
  worktreeTemplate: string;
  additionalSrcDirs: readonly string[];
  /** Overrides only — built-in {host-short} defaults are never written back out. */
  hostAliases: Readonly<Record<string, string>>;
  shadowGit: boolean;
  plugin: boolean;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const RECOMMENDED_CLONE_TEMPLATE = '~/src/{repo}@{owner}';

export const RECOMMENDED_WORKTREE_TEMPLATE = '~/src/{repo}@{owner}+{input}';

/** fngit's standard additionalSrcDirs list — per the fnc OOBE interview's "Recommended" option. */
export const RECOMMENDED_SRC_DIRS: readonly string[] = ['~/.local/src', '~/code', '~/dev', '~/projects', '~/Projects',
  '~/workspace', '~/repos', '~/git', '~/go/src/*/*', '/usr/local/src', '/usr/src', '/opt'];

// ─── Prompt text ─────────────────────────────────────────────────────────────

const CLONE_TEMPLATE_QUESTION = `Clone template — where should fngit clone repos to?

  fngit works best when the org, repo, and branch are all visible in the path
  at a glance — no need to dig into repo files to know what you're looking at.

  Placeholders: {repo} {owner} {host} {host-plain} {host-short}

Clone template`;

const WORKTREE_TEMPLATE_QUESTION = `Worktree template — where should worktrees go?

  Additional placeholders: {input} {branch} {clone-path} {repo-dir} {cwd}

Worktree template`;

const HOST_ALIAS_QUESTION = 'Your template uses {host-short}. Host aliases beyond the built-in defaults '
  + '(github.com=gh, gitlab.com=gl, bitbucket.org=bb, codeberg.org=cb)? host=alias, comma-separated.\n\nHost aliases';

const SRC_DIRS_QUESTION = 'Additional source directories (search-only — never a clone destination). '
  + 'Comma-separated paths, globs allowed.\n\nAdditional src dirs';

const SHADOW_GIT_QUESTION = 'Put a git shim first on your PATH? Every `git clone <name>` then gets the lookup.';

const PLUGIN_QUESTION = 'Install the worktree-paths plugin for Claude Code?';

// ─── Answer resolution ───────────────────────────────────────────────────────

/** Whether any install question remains unanswered by CLI options. */
export function needsPrompting(options: InstallOptions): boolean {
  return options.cloneTemplate === undefined
    || options.worktreeTemplate === undefined
    || options.additionalSrcDirs === undefined
    || options.shadowGit === undefined
    || options.plugin === undefined;
}

/** The `repos.hostAliases` overrides already configured, with entries that just restate a built-in default dropped. */
export function currentHostAliasOverrides(settings: LocateSettings): Record<string, string> {
  return Object.fromEntries(
    Object.entries(settings.hostAliases).filter(([host, alias]) => BUILTIN_HOST_ALIASES[host] !== alias),
  );
}

/** Resolve final answers from CLI options, existing settings, and the prompter. */
export async function resolveInstallAnswers(options: InstallOptions, env: InstallEnv,
  prompter: IPrompter): Promise<InstallAnswers>
{
  const cloneDefault = env.currentSettings.cloneTemplate || RECOMMENDED_CLONE_TEMPLATE;
  const cloneTemplate = options.cloneTemplate ?? await prompter.ask(CLONE_TEMPLATE_QUESTION, cloneDefault);

  const wtDefault = env.currentSettings.worktreeTemplate || RECOMMENDED_WORKTREE_TEMPLATE;
  const worktreeTemplate = options.worktreeTemplate ?? await prompter.ask(WORKTREE_TEMPLATE_QUESTION, wtDefault);

  const currentOverrides = currentHostAliasOverrides(env.currentSettings);
  let hostAliases: Record<string, string> = { ...currentOverrides };
  if (options.hostAliases !== undefined) {
    hostAliases = { ...hostAliases, ...options.hostAliases };
  } else if ((cloneTemplate.includes('{host-short}') || worktreeTemplate.includes('{host-short}'))
    && !Object.keys(currentOverrides).length)
  {
    const input = await prompter.ask(HOST_ALIAS_QUESTION, '');
    Object.assign(hostAliases, parseHostAliasInput(input));
  }

  let additionalSrcDirs: readonly string[];
  if (options.additionalSrcDirs !== undefined) {
    additionalSrcDirs = options.additionalSrcDirs;
  } else {
    const srcDefault = env.currentSettings.additionalSrcDirs.length
      ? env.currentSettings.additionalSrcDirs.join(', ')
      : RECOMMENDED_SRC_DIRS.join(', ');
    const input = await prompter.ask(SRC_DIRS_QUESTION, srcDefault);
    additionalSrcDirs = input.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const shadowGit = options.shadowGit ?? await prompter.confirm(SHADOW_GIT_QUESTION, true);
  const plugin = options.plugin ?? await prompter.confirm(PLUGIN_QUESTION, true);

  return { cloneTemplate, worktreeTemplate, additionalSrcDirs, hostAliases, shadowGit, plugin };
}

function parseHostAliasInput(input: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const pair of input.split(',')) {
    const trimmed = pair.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      aliases[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
  }
  return aliases;
}

// ─── Plan generation ─────────────────────────────────────────────────────────

/** Build an ordered list of actions from resolved answers and environment state. */
export function buildInstallPlan(answers: InstallAnswers, env: InstallEnv): readonly InstallAction[] {
  const actions: InstallAction[] = [];

  const currentOverrides = currentHostAliasOverrides(env.currentSettings);
  const unchanged = env.configFileExists
    && answers.cloneTemplate === env.currentSettings.cloneTemplate
    && answers.worktreeTemplate === env.currentSettings.worktreeTemplate
    && sameEntries(answers.additionalSrcDirs, env.currentSettings.additionalSrcDirs)
    && sameEntries(Object.keys(answers.hostAliases), Object.keys(currentOverrides))
    && Object.entries(answers.hostAliases).every(([host, alias]) => currentOverrides[host] === alias);
  if (!unchanged) {
    actions.push({ kind: 'write-settings',
      patch: { cloneTemplate: answers.cloneTemplate, worktreeTemplate: answers.worktreeTemplate,
        additionalSrcDirs: answers.additionalSrcDirs, hostAliases: answers.hostAliases },
      description: `Write repos.* to ${env.configPath}` });
  }

  if (answers.shadowGit && env.shadowTargets.length) {
    for (const variant of requiredShimVariants(env.shadowTargets)) {
      actions.push({ kind: 'write-shim-script', shell: variant,
        description: `Write the git shim (${shimVariantLabel(variant)}) to ${env.shimDir}` });
    }
    for (const target of env.shadowTargets) {
      actions.push({ kind: 'write-shadow-block', path: target.path, shell: target.shell,
        description: `Prepend the shim directory to PATH in ${target.path}` });
    }
  }

  if (answers.plugin && env.claudeOnPath && env.pluginState !== 'new') {
    actions.push({ kind: 'sync-plugin', description: env.pluginState === 'old'
      ? 'Swap the old claude-code-worktree-paths@fnrhombus-plugins install for worktree-paths@rhombus-rocks-claude-plugins'
      : 'Install the worktree-paths plugin' });
  }

  return actions;
}

/** Build a plan that removes the shim scripts and every shadow-PATH block. */
export function buildRemoveShadowPlan(env: Pick<InstallEnv, 'shimDir' | 'shadowTargets'>): readonly InstallAction[] {
  if (!env.shadowTargets.length) {
    return [];
  }
  return [{ kind: 'remove-shadow', shimDir: env.shimDir, targets: env.shadowTargets,
    description: `Remove the git shim from ${env.shimDir} and its PATH blocks` }];
}

/** One posix shim script (`git`) covers bash/zsh/fish; powershell needs its own (`git.cmd`). */
function requiredShimVariants(targets: readonly ShadowTarget[]): ShellType[] {
  const variants: ShellType[] = [];
  if (targets.some((target) => target.shell !== 'powershell')) {
    variants.push('bash');
  }
  if (targets.some((target) => target.shell === 'powershell')) {
    variants.push('powershell');
  }
  return variants;
}

function shimVariantLabel(variant: ShellType): string {
  return variant === 'powershell' ? 'git.cmd' : 'git';
}

function sameEntries(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// ─── Help text ───────────────────────────────────────────────────────────────

export const INSTALL_HELP = `Usage: fngit install [options]

Set up the shared rhombus.rocks config interactively, or provide options directly.

Options:
  --clone-template <template>    Clone destination template
  --worktree-template <template> Worktree destination template
  --additional-src-dirs <dirs>   Extra search directories (repeatable, comma-separated)
  --host-alias <host>=<alias>    Host alias for {host-short} (repeatable)
  --plugin / --no-plugin         Install the worktree-paths Claude Code plugin
  --shadow-git / --no-shadow-git Put a git shim first on PATH
  --yes                          Accept every recommended/current default; never prompts
  --dry-run                      Print planned changes without writing anything
  --remove-shadow                Remove the git shim and its PATH blocks, then exit
  --help                         Show this help
`;
