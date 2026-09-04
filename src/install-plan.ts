import { assertNever } from '@rhombus-toolkit/type-guards';

import { previewTemplate, validateCloneTemplate } from './settings-writer.js';
import type { LocateSettings } from './settings.js';
import type { ShellType } from './shell-block.js';

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
  project: boolean;
  yes: boolean;
  dryRun: boolean;
  removeShadow: boolean;
  help: boolean;
}

export type ParseInstallArgsResult = { ok: true; options: InstallOptions; } | { ok: false; };

/** Parse `fngit install` arguments; returns `ok: false` for any unrecognised arg (= passthrough to git). */
export function parseInstallArgs(argv: readonly string[]): ParseInstallArgsResult {
  const options: InstallOptions = { project: false, yes: false, dryRun: false, removeShadow: false, help: false };

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
      case '--project': {
        options.project = true;
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
  home: string;
  cwd: string;
  currentSettings: LocateSettings;
  settingsPath: string;
  hostAliasesPath: string;
  shadowTargets: readonly ShadowTarget[];
  claudeOnPath: boolean;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export type InstallAction = { kind: 'write-settings'; path: string; patch: Partial<LocateSettings>;
  description: string; } | { kind: 'write-host-aliases'; path: string; aliases: Readonly<Record<string, string>>;
  description: string; } | { kind: 'write-shadow-block'; path: string; shell: ShellType; description: string; } | {
  kind: 'remove-shadow-block';
  path: string;
  description: string;
} | { kind: 'install-plugin'; description: string; };

/** Print a human-readable description for each action; used by `--dry-run`. */
export function describePlan(actions: readonly InstallAction[]): string {
  if (!actions.length) {
    return 'Nothing to do — configuration is already up to date.';
  }
  return actions.map((action) => `  • ${action.description}`).join('\n');
}

/** Exhaustive handler entry point for action execution; forces the caller to cover every kind. */
export function forEachActionKind(action: InstallAction,
  handlers: { 'write-settings': typeof action extends { kind: 'write-settings'; } ? never : void;
    'write-host-aliases': void; 'write-shadow-block': void; 'remove-shadow-block': void;
    'install-plugin': void; }): void;
export function forEachActionKind(): void {
  // Overload signature only — real dispatch happens inline in cli.ts with assertNever.
}

// ─── Answers ─────────────────────────────────────────────────────────────────

export interface InstallAnswers {
  cloneTemplate: string;
  worktreeTemplate: string;
  additionalSrcDirs: readonly string[];
  hostAliases: Readonly<Record<string, string>>;
  shadowGit: boolean;
  plugin: boolean;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const RECOMMENDED_CLONE_TEMPLATE = '~/src/{repo}@{owner}';

export const RECOMMENDED_WORKTREE_TEMPLATE = '~/src/{repo}@{owner}+{input}';

export const RECOMMENDED_SRC_DIRS: readonly string[] = ['~/.local/src', '~/code', '~/dev', '~/projects', '~/Projects',
  '~/workspace', '~/repos', '~/git', '~/go/src/*/*', '/usr/local/src', '/usr/src', '/opt'];

// ─── Prompt text ─────────────────────────────────────────────────────────────

const CLONE_TEMPLATE_QUESTION = `Clone template — where should fngit clone repos to?

  fngit works best when the org, repo, and branch are all visible in the path
  at a glance — no need to dig into repo files to know what you're looking at.

  Recommended: ~/src/{repo}@{owner}  →  ~/src/fngit@rhombus-rocks

  Placeholders: {repo} {owner} {host} {host-plain} {host-short}

Clone template`;

const WORKTREE_TEMPLATE_QUESTION = `Worktree template — where should worktrees go?

  Additional placeholder: {input} (the workspace/branch name)
  Recommended: ~/src/{repo}@{owner}+{input}  →  ~/src/fngit@rhombus-rocks+feat-x

Worktree template`;

const HOST_ALIAS_QUESTION = `Your template uses {host-short}. Define host aliases (host=alias, comma-separated).

Host aliases`;

const SRC_DIRS_QUESTION = `Additional source directories (search-only — never used as clone destinations).
Comma-separated paths.

Additional src dirs`;

const SHADOW_GIT_QUESTION = 'Replace calls to system git? (alias git=fngit in shell rc files)';

const PLUGIN_QUESTION = 'Install claude-code-worktree-paths@fnrhombus-plugins? (recommended)';

// ─── Answer resolution ───────────────────────────────────────────────────────

/** Whether any install question remains unanswered by CLI options. */
export function needsPrompting(options: InstallOptions): boolean {
  return options.cloneTemplate === undefined
    || options.worktreeTemplate === undefined
    || options.additionalSrcDirs === undefined
    || options.shadowGit === undefined
    || options.plugin === undefined;
}

/** Resolve final answers from CLI options, existing settings, and the prompter. */
export async function resolveInstallAnswers(options: InstallOptions, env: InstallEnv,
  prompter: IPrompter): Promise<InstallAnswers>
{
  const cloneDefault = env.currentSettings.cloneTemplate || RECOMMENDED_CLONE_TEMPLATE;
  const cloneTemplate = options.cloneTemplate !== undefined
    ? options.cloneTemplate
    : await askValidatedCloneTemplate(prompter, cloneDefault);

  const wtDefault = env.currentSettings.worktreeTemplate || RECOMMENDED_WORKTREE_TEMPLATE;
  let worktreeTemplate: string;
  if (options.worktreeTemplate !== undefined) {
    worktreeTemplate = options.worktreeTemplate;
  } else {
    worktreeTemplate = await prompter.ask(WORKTREE_TEMPLATE_QUESTION, wtDefault);
    const preview = previewTemplate(worktreeTemplate);
    if (preview.ok) {
      prompter.print(`  → ${preview.value}`);
    }
  }

  let hostAliases: Record<string, string> = { ...env.currentSettings.hostAliases };
  if (options.hostAliases !== undefined) {
    hostAliases = { ...hostAliases, ...options.hostAliases };
  } else if ((cloneTemplate.includes('{host-short}') || worktreeTemplate.includes('{host-short}'))
    && !Object.keys(hostAliases).length)
  {
    const input = await prompter.ask(HOST_ALIAS_QUESTION, 'github.com=gh');
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

async function askValidatedCloneTemplate(prompter: IPrompter, defaultValue: string): Promise<string> {
  let template = await prompter.ask(CLONE_TEMPLATE_QUESTION, defaultValue);
  let validation = validateCloneTemplate(template);
  while (!validation.ok) {
    prompter.print(`  Error: ${validation.error}`);
    template = await prompter.ask(CLONE_TEMPLATE_QUESTION, defaultValue);
    validation = validateCloneTemplate(template);
  }
  const preview = previewTemplate(template);
  if (preview.ok) {
    prompter.print(`  → ${preview.value}`);
  }
  return template;
}

// ─── Plan generation ─────────────────────────────────────────────────────────

/** Build an ordered list of actions from resolved answers and environment state. */
export function buildInstallPlan(answers: InstallAnswers, env: InstallEnv): readonly InstallAction[] {
  const actions: InstallAction[] = [];

  const patch: Partial<LocateSettings> = {};
  if (answers.cloneTemplate !== env.currentSettings.cloneTemplate) {
    patch.cloneTemplate = answers.cloneTemplate;
  }
  if (answers.worktreeTemplate !== env.currentSettings.worktreeTemplate) {
    patch.worktreeTemplate = answers.worktreeTemplate;
  }
  if (JSON.stringify(answers.additionalSrcDirs) !== JSON.stringify(env.currentSettings.additionalSrcDirs)) {
    patch.additionalSrcDirs = answers.additionalSrcDirs;
  }
  if (Object.keys(patch).length) {
    actions.push({ kind: 'write-settings', path: env.settingsPath, patch,
      description: `Write settings to ${env.settingsPath}` });
  }

  if (JSON.stringify(answers.hostAliases) !== JSON.stringify(env.currentSettings.hostAliases)
    && Object.keys(answers.hostAliases).length)
  {
    actions.push({ kind: 'write-host-aliases', path: env.hostAliasesPath, aliases: answers.hostAliases,
      description: `Write host aliases to ${env.hostAliasesPath}` });
  }

  if (answers.shadowGit) {
    for (const target of env.shadowTargets) {
      actions.push({ kind: 'write-shadow-block', path: target.path, shell: target.shell,
        description: `Write shadow-git alias to ${target.path}` });
    }
  }

  if (answers.plugin && env.claudeOnPath) {
    actions.push({ kind: 'install-plugin', description: 'Install claude-code-worktree-paths plugin' });
  }

  return actions;
}

/** Build a plan that removes shadow-git blocks from all targets. */
export function buildRemoveShadowPlan(targets: readonly ShadowTarget[]): readonly InstallAction[] {
  return targets.map((target) => ({ kind: 'remove-shadow-block' as const, path: target.path,
    description: `Remove shadow-git alias from ${target.path}` })
  );
}

// ─── Help text ───────────────────────────────────────────────────────────────

export const INSTALL_HELP = `Usage: fngit install [options]

Set up fngit configuration interactively, or provide options directly.

Options:
  --clone-template <template>    Clone destination template
  --worktree-template <template> Worktree destination template
  --additional-src-dirs <dirs>   Extra search directories (repeatable, comma-separated)
  --host-alias <host>=<alias>    Host alias for {host-short} (repeatable)
  --plugin / --no-plugin         Install the claude-code-worktree-paths plugin
  --shadow-git / --no-shadow-git Alias git=fngit in shell rc files
  --project                      Write to <cwd>/.claude/settings.json instead of user settings
  --yes                          Accept defaults for unanswered questions
  --dry-run                      Print planned changes without writing anything
  --remove-shadow                Remove the shadow-git aliases and exit
  --help                         Show this help
`;
