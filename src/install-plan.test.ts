import { describe, expect, test } from 'bun:test';

import { buildInstallPlan, buildRemoveShadowPlan, describePlan, INSTALL_HELP, type InstallAction, type InstallAnswers,
  type InstallEnv, type InstallOptions, type IPrompter, needsPrompting, parseInstallArgs, RECOMMENDED_CLONE_TEMPLATE,
  RECOMMENDED_SRC_DIRS, RECOMMENDED_WORKTREE_TEMPLATE, resolveInstallAnswers,
  type ShadowTarget } from './install-plan.js';
import type { LocateSettings } from './settings.js';

// ─── Test doubles ────────────────────────────────────────────────────────────

class ScriptedPrompter implements IPrompter {
  #responses: Array<string | boolean>;
  #index = 0;
  _output: string[] = [];

  constructor(responses: Array<string | boolean>) {
    this.#responses = responses;
  }

  async ask(_question: string, _defaultValue: string): Promise<string> {
    const response = this.#responses[this.#index++];
    if (typeof response !== 'string') {
      throw new Error(`ScriptedPrompter expected string at index ${this.#index - 1}, got ${typeof response}`);
    }
    return response;
  }

  async confirm(_question: string, _defaultValue: boolean): Promise<boolean> {
    const response = this.#responses[this.#index++];
    if (typeof response !== 'boolean') {
      throw new Error(`ScriptedPrompter expected boolean at index ${this.#index - 1}, got ${typeof response}`);
    }
    return response;
  }

  print(message: string): void {
    this._output.push(message);
  }
}

class DefaultPrompter implements IPrompter {
  async ask(_question: string, defaultValue: string): Promise<string> {
    return defaultValue;
  }

  async confirm(_question: string, defaultValue: boolean): Promise<boolean> {
    return defaultValue;
  }

  print(): void {
    // Silent in default mode.
  }
}

function emptySettings(): LocateSettings {
  return { cloneTemplate: '', worktreeTemplate: '', additionalSrcDirs: [], hostAliases: {} };
}

function baseEnv(overrides: Partial<InstallEnv> = {}): InstallEnv {
  return { home: '/home/test', cwd: '/home/test/project', currentSettings: emptySettings(),
    settingsPath: '/home/test/.claude/settings.json',
    hostAliasesPath: '/home/test/.local/share/fnrhombus/host-aliases.json', shadowTargets: [], claudeOnPath: false,
    ...overrides };
}

// ─── parseInstallArgs ────────────────────────────────────────────────────────

describe('parseInstallArgs', () => {
  test('no arguments — valid empty options', () => {
    const result = parseInstallArgs([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.yes).toBe(false);
      expect(result.options.dryRun).toBe(false);
    }
  });

  test('--yes', () => {
    const result = parseInstallArgs(['--yes']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.yes).toBe(true);
    }
  });

  test('--dry-run', () => {
    const result = parseInstallArgs(['--dry-run']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.dryRun).toBe(true);
    }
  });

  test('--clone-template with value', () => {
    const result = parseInstallArgs(['--clone-template', '~/src/{repo}']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.cloneTemplate).toBe('~/src/{repo}');
    }
  });

  test('--clone-template without value — fails', () => {
    expect(parseInstallArgs(['--clone-template']).ok).toBe(false);
  });

  test('--worktree-template with value', () => {
    const result = parseInstallArgs(['--worktree-template', '~/src/{repo}+{input}']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.worktreeTemplate).toBe('~/src/{repo}+{input}');
    }
  });

  test('--additional-src-dirs comma-separated', () => {
    const result = parseInstallArgs(['--additional-src-dirs', '~/code,~/dev']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.additionalSrcDirs).toEqual(['~/code', '~/dev']);
    }
  });

  test('--additional-src-dirs repeated', () => {
    const result = parseInstallArgs(['--additional-src-dirs', '~/code', '--additional-src-dirs', '~/dev']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.additionalSrcDirs).toEqual(['~/code', '~/dev']);
    }
  });

  test('--host-alias key=value', () => {
    const result = parseInstallArgs(['--host-alias', 'github.com=gh']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.hostAliases).toEqual({ 'github.com': 'gh' });
    }
  });

  test('--host-alias repeated', () => {
    const result = parseInstallArgs(['--host-alias', 'github.com=gh', '--host-alias', 'gitlab.com=gl']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.hostAliases).toEqual({ 'github.com': 'gh', 'gitlab.com': 'gl' });
    }
  });

  test('--host-alias without = — fails', () => {
    expect(parseInstallArgs(['--host-alias', 'github.com']).ok).toBe(false);
  });

  test('--plugin', () => {
    const result = parseInstallArgs(['--plugin']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.plugin).toBe(true);
    }
  });

  test('--no-plugin', () => {
    const result = parseInstallArgs(['--no-plugin']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.plugin).toBe(false);
    }
  });

  test('--shadow-git', () => {
    const result = parseInstallArgs(['--shadow-git']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.shadowGit).toBe(true);
    }
  });

  test('--no-shadow-git', () => {
    const result = parseInstallArgs(['--no-shadow-git']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.shadowGit).toBe(false);
    }
  });

  test('--project', () => {
    const result = parseInstallArgs(['--project']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.project).toBe(true);
    }
  });

  test('--remove-shadow', () => {
    const result = parseInstallArgs(['--remove-shadow']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.removeShadow).toBe(true);
    }
  });

  test('--help', () => {
    const result = parseInstallArgs(['--help']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.help).toBe(true);
    }
  });

  test('unrecognised argument — fails', () => {
    expect(parseInstallArgs(['--unknown-flag']).ok).toBe(false);
  });

  test('positional argument — fails', () => {
    expect(parseInstallArgs(['some-package']).ok).toBe(false);
  });

  test('combined options', () => {
    const result = parseInstallArgs(['--clone-template', '~/src/{repo}@{owner}', '--yes', '--dry-run', '--no-plugin',
      '--no-shadow-git']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.cloneTemplate).toBe('~/src/{repo}@{owner}');
      expect(result.options.yes).toBe(true);
      expect(result.options.dryRun).toBe(true);
      expect(result.options.plugin).toBe(false);
      expect(result.options.shadowGit).toBe(false);
    }
  });
});

// ─── needsPrompting ──────────────────────────────────────────────────────────

describe('needsPrompting', () => {
  test('all options provided — no prompting needed', () => {
    const options: InstallOptions = { cloneTemplate: 'tpl', worktreeTemplate: 'wt', additionalSrcDirs: [],
      shadowGit: true, plugin: true, project: false, yes: false, dryRun: false, removeShadow: false, help: false };
    expect(needsPrompting(options)).toBe(false);
  });

  test('missing cloneTemplate — needs prompting', () => {
    const options: InstallOptions = { worktreeTemplate: 'wt', additionalSrcDirs: [], shadowGit: true, plugin: true,
      project: false, yes: false, dryRun: false, removeShadow: false, help: false };
    expect(needsPrompting(options)).toBe(true);
  });

  test('missing shadowGit — needs prompting', () => {
    const options: InstallOptions = { cloneTemplate: 'tpl', worktreeTemplate: 'wt', additionalSrcDirs: [], plugin: true,
      project: false, yes: false, dryRun: false, removeShadow: false, help: false };
    expect(needsPrompting(options)).toBe(true);
  });
});

// ─── resolveInstallAnswers ───────────────────────────────────────────────────

describe('resolveInstallAnswers', () => {
  test('uses CLI-provided options without prompting', async () => {
    const options: InstallOptions = { cloneTemplate: '~/src/{repo}', worktreeTemplate: '~/src/{repo}+{input}',
      additionalSrcDirs: ['~/code'], shadowGit: false, plugin: false, project: false, yes: false, dryRun: false,
      removeShadow: false, help: false };
    const prompter = new ScriptedPrompter([]);
    const answers = await resolveInstallAnswers(options, baseEnv(), prompter);
    expect(answers.cloneTemplate).toBe('~/src/{repo}');
    expect(answers.worktreeTemplate).toBe('~/src/{repo}+{input}');
    expect(answers.additionalSrcDirs).toEqual(['~/code']);
    expect(answers.shadowGit).toBe(false);
    expect(answers.plugin).toBe(false);
  });

  test('uses defaults via DefaultPrompter (--yes mode)', async () => {
    const prompter = new DefaultPrompter();
    const options: InstallOptions = { project: false, yes: true, dryRun: false, removeShadow: false, help: false };
    const answers = await resolveInstallAnswers(options, baseEnv(), prompter);
    expect(answers.cloneTemplate).toBe(RECOMMENDED_CLONE_TEMPLATE);
    expect(answers.worktreeTemplate).toBe(RECOMMENDED_WORKTREE_TEMPLATE);
    expect(answers.shadowGit).toBe(true);
    expect(answers.plugin).toBe(true);
  });

  test('uses existing settings as defaults', async () => {
    const settings: LocateSettings = { cloneTemplate: '~/existing/{repo}',
      worktreeTemplate: '~/existing/{repo}+{input}', additionalSrcDirs: ['/existing/src'], hostAliases: {} };
    const prompter = new DefaultPrompter();
    const options: InstallOptions = { project: false, yes: true, dryRun: false, removeShadow: false, help: false };
    const answers = await resolveInstallAnswers(options, baseEnv({ currentSettings: settings }), prompter);
    expect(answers.cloneTemplate).toBe('~/existing/{repo}');
    expect(answers.worktreeTemplate).toBe('~/existing/{repo}+{input}');
    expect(answers.additionalSrcDirs).toEqual(['/existing/src']);
  });

  test('prompts for each unanswered question in order', async () => {
    const prompter = new ScriptedPrompter([
      '~/prompted/{repo}', // clone template
      '~/prompted/{repo}+{input}', // worktree template
      '~/code, ~/dev', // src dirs
      true, // shadow-git
      false, // plugin
    ]);
    const options: InstallOptions = { project: false, yes: false, dryRun: false, removeShadow: false, help: false };
    const answers = await resolveInstallAnswers(options, baseEnv(), prompter);
    expect(answers.cloneTemplate).toBe('~/prompted/{repo}');
    expect(answers.worktreeTemplate).toBe('~/prompted/{repo}+{input}');
    expect(answers.additionalSrcDirs).toEqual(['~/code', '~/dev']);
    expect(answers.shadowGit).toBe(true);
    expect(answers.plugin).toBe(false);
  });

  test('asks for host aliases when template uses {host-short} and none configured', async () => {
    const prompter = new ScriptedPrompter([
      '~/src/{host-short}/{repo}', // clone template uses {host-short}
      '~/src/{host-short}/{repo}+{input}', // worktree template
      'github.com=gh', // host alias prompt
      '~/code', // src dirs
      true, // shadow-git
      false, // plugin
    ]);
    const options: InstallOptions = { project: false, yes: false, dryRun: false, removeShadow: false, help: false };
    const answers = await resolveInstallAnswers(options, baseEnv(), prompter);
    expect(answers.hostAliases).toEqual({ 'github.com': 'gh' });
  });

  test('skips host alias prompt when aliases already configured', async () => {
    const settings: LocateSettings = { cloneTemplate: '', worktreeTemplate: '', additionalSrcDirs: [],
      hostAliases: { 'github.com': 'gh' } };
    const prompter = new ScriptedPrompter([
      '~/src/{host-short}/{repo}', // clone template
      '~/src/{host-short}/{repo}+{input}', // worktree template
      // NO host alias prompt expected
      '~/code', // src dirs
      true, // shadow-git
      false, // plugin
    ]);
    const options: InstallOptions = { project: false, yes: false, dryRun: false, removeShadow: false, help: false };
    const answers = await resolveInstallAnswers(options, baseEnv({ currentSettings: settings }), prompter);
    expect(answers.hostAliases).toEqual({ 'github.com': 'gh' });
  });

  test('shows preview after clone template answer', async () => {
    const prompter = new ScriptedPrompter(['~/src/{repo}@{owner}', '~/src/{repo}@{owner}+{input}', '~/code', true,
      false]);
    const options: InstallOptions = { project: false, yes: false, dryRun: false, removeShadow: false, help: false };
    await resolveInstallAnswers(options, baseEnv(), prompter);
    expect(prompter._output.some((line) => line.includes('fngit@rhombus-rocks'))).toBe(true);
  });
});

// ─── buildInstallPlan ────────────────────────────────────────────────────────

describe('buildInstallPlan', () => {
  function answers(overrides: Partial<InstallAnswers> = {}): InstallAnswers {
    return { cloneTemplate: '~/src/{repo}@{owner}', worktreeTemplate: '~/src/{repo}@{owner}+{input}',
      additionalSrcDirs: ['~/.local/src'], hostAliases: {}, shadowGit: false, plugin: false, ...overrides };
  }

  test('settings changed → write-settings action', () => {
    const env = baseEnv();
    const plan = buildInstallPlan(answers(), env);
    const settingsActions = plan.filter((a) => a.kind === 'write-settings');
    expect(settingsActions.length).toBe(1);
    expect(settingsActions[0]!.path).toBe(env.settingsPath);
  });

  test('no settings changed → no write-settings action', () => {
    const settings: LocateSettings = { cloneTemplate: '~/src/{repo}@{owner}',
      worktreeTemplate: '~/src/{repo}@{owner}+{input}', additionalSrcDirs: ['~/.local/src'], hostAliases: {} };
    const plan = buildInstallPlan(answers(), baseEnv({ currentSettings: settings }));
    expect(plan.filter((a) => a.kind === 'write-settings').length).toBe(0);
  });

  test('host aliases changed → write-host-aliases action', () => {
    const plan = buildInstallPlan(answers({ hostAliases: { 'github.com': 'gh' } }), baseEnv());
    const aliasActions = plan.filter((a) => a.kind === 'write-host-aliases');
    expect(aliasActions.length).toBe(1);
  });

  test('host aliases unchanged → no write-host-aliases action', () => {
    const settings: LocateSettings = { cloneTemplate: '', worktreeTemplate: '', additionalSrcDirs: [],
      hostAliases: { 'github.com': 'gh' } };
    const plan = buildInstallPlan(answers({ hostAliases: { 'github.com': 'gh' } }),
      baseEnv({ currentSettings: settings }));
    expect(plan.filter((a) => a.kind === 'write-host-aliases').length).toBe(0);
  });

  test('shadowGit true → write-shadow-block actions for each target', () => {
    const targets: ShadowTarget[] = [{ path: '/home/test/.bashrc', shell: 'bash' }, { path: '/home/test/.zshrc',
      shell: 'zsh' }];
    const plan = buildInstallPlan(answers({ shadowGit: true }), baseEnv({ shadowTargets: targets }));
    const shadowActions = plan.filter((a) => a.kind === 'write-shadow-block');
    expect(shadowActions.length).toBe(2);
  });

  test('shadowGit false → no shadow actions', () => {
    const targets: ShadowTarget[] = [{ path: '/home/test/.bashrc', shell: 'bash' }];
    const plan = buildInstallPlan(answers({ shadowGit: false }), baseEnv({ shadowTargets: targets }));
    expect(plan.filter((a) => a.kind === 'write-shadow-block').length).toBe(0);
  });

  test('plugin true + claude on path → install-plugin action', () => {
    const plan = buildInstallPlan(answers({ plugin: true }), baseEnv({ claudeOnPath: true }));
    expect(plan.filter((a) => a.kind === 'install-plugin').length).toBe(1);
  });

  test('plugin true + claude NOT on path → no install-plugin action', () => {
    const plan = buildInstallPlan(answers({ plugin: true }), baseEnv({ claudeOnPath: false }));
    expect(plan.filter((a) => a.kind === 'install-plugin').length).toBe(0);
  });

  test('plugin false → no install-plugin action', () => {
    const plan = buildInstallPlan(answers({ plugin: false }), baseEnv({ claudeOnPath: true }));
    expect(plan.filter((a) => a.kind === 'install-plugin').length).toBe(0);
  });

  test('fully configured machine with same answers → empty plan', () => {
    const settings: LocateSettings = { cloneTemplate: '~/src/{repo}@{owner}',
      worktreeTemplate: '~/src/{repo}@{owner}+{input}', additionalSrcDirs: ['~/.local/src'], hostAliases: {} };
    const plan = buildInstallPlan(answers({ shadowGit: false, plugin: false }), baseEnv({ currentSettings: settings }));
    expect(plan.length).toBe(0);
  });

  test('every action has a description', () => {
    const targets: ShadowTarget[] = [{ path: '/home/test/.bashrc', shell: 'bash' }];
    const plan = buildInstallPlan(answers({ shadowGit: true, plugin: true, hostAliases: { 'github.com': 'gh' } }),
      baseEnv({ shadowTargets: targets, claudeOnPath: true }));
    for (const action of plan) {
      expect(action.description).toBeTruthy();
    }
  });
});

// ─── buildRemoveShadowPlan ───────────────────────────────────────────────────

describe('buildRemoveShadowPlan', () => {
  test('produces remove-shadow-block actions for each target', () => {
    const targets: ShadowTarget[] = [{ path: '/home/test/.bashrc', shell: 'bash' }, { path: '/home/test/.zshrc',
      shell: 'zsh' }];
    const plan = buildRemoveShadowPlan(targets);
    expect(plan.length).toBe(2);
    expect(plan.every((a) => a.kind === 'remove-shadow-block')).toBe(true);
  });

  test('empty targets → empty plan', () => {
    expect(buildRemoveShadowPlan([]).length).toBe(0);
  });
});

// ─── describePlan ────────────────────────────────────────────────────────────

describe('describePlan', () => {
  test('empty plan → no-op message', () => {
    expect(describePlan([])).toContain('Nothing to do');
  });

  test('lists each action with a bullet', () => {
    const actions: InstallAction[] = [{ kind: 'write-settings', path: '/p', patch: {}, description: 'Write settings' },
      { kind: 'install-plugin', description: 'Install plugin' }];
    const output = describePlan(actions);
    expect(output).toContain('• Write settings');
    expect(output).toContain('• Install plugin');
  });
});

// ─── INSTALL_HELP ────────────────────────────────────────────────────────────

describe('INSTALL_HELP', () => {
  test('contains every documented option', () => {
    for (const flag of ['--clone-template', '--worktree-template', '--additional-src-dirs', '--host-alias', '--plugin',
      '--no-plugin', '--shadow-git', '--no-shadow-git', '--project', '--yes', '--dry-run', '--remove-shadow', '--help'])
    {
      expect(INSTALL_HELP).toContain(flag);
    }
  });
});
