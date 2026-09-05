import { describe, expect, test } from 'bun:test';

import { buildInstallPlan, buildRemoveShadowPlan, currentHostAliasOverrides, describePlan, INSTALL_HELP,
  type InstallAction, type InstallAnswers, type InstallEnv, type InstallOptions, type IPrompter, needsPrompting,
  parseInstallArgs, RECOMMENDED_CLONE_TEMPLATE, RECOMMENDED_SRC_DIRS, RECOMMENDED_WORKTREE_TEMPLATE,
  resolveInstallAnswers, type ShadowTarget } from './install-plan.js';
import { BUILTIN_HOST_ALIASES, type LocateSettings } from './settings.js';

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
  return { cloneTemplate: '', worktreeTemplate: '', additionalSrcDirs: [], hostAliases: { ...BUILTIN_HOST_ALIASES } };
}

function baseEnv(overrides: Partial<InstallEnv> = {}): InstallEnv {
  return { currentSettings: emptySettings(), configPath: '/home/test/.config/rhombus.rocks/config.json',
    configFileExists: false, shimDir: '/home/test/.local/share/rhombus.rocks/fngit/shims', shadowTargets: [],
    claudeOnPath: false, pluginState: 'none', ...overrides };
}

function baseOptions(overrides: Partial<InstallOptions> = {}): InstallOptions {
  return { yes: false, dryRun: false, removeShadow: false, help: false, ...overrides };
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
    expect(result.ok && result.options.yes).toBe(true);
  });

  test('--dry-run', () => {
    const result = parseInstallArgs(['--dry-run']);
    expect(result.ok && result.options.dryRun).toBe(true);
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

  test('--plugin / --no-plugin', () => {
    const yes = parseInstallArgs(['--plugin']);
    const no = parseInstallArgs(['--no-plugin']);
    expect(yes.ok && yes.options.plugin).toBe(true);
    expect(no.ok && no.options.plugin).toBe(false);
  });

  test('--shadow-git / --no-shadow-git', () => {
    const yes = parseInstallArgs(['--shadow-git']);
    const no = parseInstallArgs(['--no-shadow-git']);
    expect(yes.ok && yes.options.shadowGit).toBe(true);
    expect(no.ok && no.options.shadowGit).toBe(false);
  });

  test('--remove-shadow', () => {
    const result = parseInstallArgs(['--remove-shadow']);
    expect(result.ok && result.options.removeShadow).toBe(true);
  });

  test('--help', () => {
    const result = parseInstallArgs(['--help']);
    expect(result.ok && result.options.help).toBe(true);
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
    expect(
      needsPrompting(
        baseOptions({ cloneTemplate: 'tpl', worktreeTemplate: 'wt', additionalSrcDirs: [], shadowGit: true,
          plugin: true }),
      ),
    ).toBe(false);
  });

  test('missing cloneTemplate — needs prompting', () => {
    expect(
      needsPrompting(baseOptions({ worktreeTemplate: 'wt', additionalSrcDirs: [], shadowGit: true, plugin: true })),
    ).toBe(true);
  });

  test('missing shadowGit — needs prompting', () => {
    expect(
      needsPrompting(
        baseOptions({ cloneTemplate: 'tpl', worktreeTemplate: 'wt', additionalSrcDirs: [], plugin: true }),
      ),
    ).toBe(true);
  });
});

// ─── currentHostAliasOverrides ───────────────────────────────────────────────

describe('currentHostAliasOverrides', () => {
  test('drops entries that just restate a built-in default', () => {
    const settings: LocateSettings = { cloneTemplate: '', worktreeTemplate: '', additionalSrcDirs: [],
      hostAliases: { ...BUILTIN_HOST_ALIASES, 'git.example.com': 'ex' } };
    expect(currentHostAliasOverrides(settings)).toEqual({ 'git.example.com': 'ex' });
  });

  test('keeps an entry that overrides a built-in default with a different value', () => {
    const settings: LocateSettings = { cloneTemplate: '', worktreeTemplate: '', additionalSrcDirs: [],
      hostAliases: { ...BUILTIN_HOST_ALIASES, 'github.com': 'my-gh' } };
    expect(currentHostAliasOverrides(settings)).toEqual({ 'github.com': 'my-gh' });
  });
});

// ─── resolveInstallAnswers ───────────────────────────────────────────────────

describe('resolveInstallAnswers', () => {
  test('uses CLI-provided options without prompting', async () => {
    const options = baseOptions({ cloneTemplate: '~/src/{repo}', worktreeTemplate: '~/src/{repo}+{input}',
      additionalSrcDirs: ['~/code'], shadowGit: false, plugin: false });
    const answers = await resolveInstallAnswers(options, baseEnv(), new ScriptedPrompter([]));
    expect(answers.cloneTemplate).toBe('~/src/{repo}');
    expect(answers.worktreeTemplate).toBe('~/src/{repo}+{input}');
    expect(answers.additionalSrcDirs).toEqual(['~/code']);
    expect(answers.shadowGit).toBe(false);
    expect(answers.plugin).toBe(false);
  });

  test('uses recommended defaults via DefaultPrompter (--yes mode) on a bare machine', async () => {
    const answers = await resolveInstallAnswers(baseOptions({ yes: true }), baseEnv(), new DefaultPrompter());
    expect(answers.cloneTemplate).toBe(RECOMMENDED_CLONE_TEMPLATE);
    expect(answers.worktreeTemplate).toBe(RECOMMENDED_WORKTREE_TEMPLATE);
    expect(answers.additionalSrcDirs).toEqual(RECOMMENDED_SRC_DIRS);
    expect(answers.shadowGit).toBe(true);
    expect(answers.plugin).toBe(true);
  });

  test('uses existing settings as defaults', async () => {
    const settings: LocateSettings = { cloneTemplate: '~/existing/{repo}',
      worktreeTemplate: '~/existing/{repo}+{input}', additionalSrcDirs: ['/existing/src'],
      hostAliases: { ...BUILTIN_HOST_ALIASES } };
    const answers = await resolveInstallAnswers(baseOptions({ yes: true }), baseEnv({ currentSettings: settings }),
      new DefaultPrompter());
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
    const answers = await resolveInstallAnswers(baseOptions(), baseEnv(), prompter);
    expect(answers.cloneTemplate).toBe('~/prompted/{repo}');
    expect(answers.worktreeTemplate).toBe('~/prompted/{repo}+{input}');
    expect(answers.additionalSrcDirs).toEqual(['~/code', '~/dev']);
    expect(answers.shadowGit).toBe(true);
    expect(answers.plugin).toBe(false);
  });

  test('asks for host aliases when a template uses {host-short} and none are configured', async () => {
    const prompter = new ScriptedPrompter(['~/src/{host-short}/{repo}', '~/src/{host-short}/{repo}+{input}',
      'github.com=gh', '~/code', true, false]);
    const answers = await resolveInstallAnswers(baseOptions(), baseEnv(), prompter);
    expect(answers.hostAliases).toEqual({ 'github.com': 'gh' });
  });

  test('skips the host alias prompt when overrides are already configured', async () => {
    const settings: LocateSettings = { cloneTemplate: '', worktreeTemplate: '', additionalSrcDirs: [],
      hostAliases: { ...BUILTIN_HOST_ALIASES, 'git.example.com': 'ex' } };
    const prompter = new ScriptedPrompter([
      '~/src/{host-short}/{repo}',
      '~/src/{host-short}/{repo}+{input}',
      // NO host alias prompt expected
      '~/code',
      true,
      false,
    ]);
    const answers = await resolveInstallAnswers(baseOptions(), baseEnv({ currentSettings: settings }), prompter);
    expect(answers.hostAliases).toEqual({ 'git.example.com': 'ex' });
  });

  test('built-in-only host aliases never surface as an "existing" override', async () => {
    const answers = await resolveInstallAnswers(baseOptions({ yes: true }), baseEnv(), new DefaultPrompter());
    expect(answers.hostAliases).toEqual({});
  });
});

// ─── buildInstallPlan ────────────────────────────────────────────────────────

describe('buildInstallPlan', () => {
  function answers(overrides: Partial<InstallAnswers> = {}): InstallAnswers {
    return { cloneTemplate: '~/src/{repo}@{owner}', worktreeTemplate: '~/src/{repo}@{owner}+{input}',
      additionalSrcDirs: ['~/.local/src'], hostAliases: {}, shadowGit: false, plugin: false, ...overrides };
  }

  test('settings changed → write-settings action naming the resolved config path', () => {
    const env = baseEnv();
    const plan = buildInstallPlan(answers(), env);
    const settingsActions = plan.filter((a) => a.kind === 'write-settings');
    expect(settingsActions.length).toBe(1);
    expect(settingsActions[0]!.description).toContain(env.configPath);
  });

  test('no settings changed on an existing file → no write-settings action', () => {
    const settings: LocateSettings = { cloneTemplate: '~/src/{repo}@{owner}',
      worktreeTemplate: '~/src/{repo}@{owner}+{input}', additionalSrcDirs: ['~/.local/src'], hostAliases: {} };
    const plan = buildInstallPlan(answers(), baseEnv({ currentSettings: settings, configFileExists: true }));
    expect(plan.filter((a) => a.kind === 'write-settings').length).toBe(0);
  });

  test('unchanged answers but the file does not exist yet → still writes (first install / migration)', () => {
    const settings: LocateSettings = { cloneTemplate: '~/src/{repo}@{owner}',
      worktreeTemplate: '~/src/{repo}@{owner}+{input}', additionalSrcDirs: ['~/.local/src'], hostAliases: {} };
    const plan = buildInstallPlan(answers(), baseEnv({ currentSettings: settings, configFileExists: false }));
    expect(plan.filter((a) => a.kind === 'write-settings').length).toBe(1);
  });

  test('host aliases changed → included in the write-settings patch', () => {
    const plan = buildInstallPlan(answers({ hostAliases: { 'github.com': 'gh' } }), baseEnv());
    const action = plan.find((a) => a.kind === 'write-settings');
    expect(action?.kind === 'write-settings' && action.patch.hostAliases).toEqual({ 'github.com': 'gh' });
  });

  test('shadowGit true → one shim-script action plus one shadow-block action per target', () => {
    const targets: ShadowTarget[] = [{ path: '/home/test/.bashrc', shell: 'bash' }, { path: '/home/test/.zshrc',
      shell: 'zsh' }];
    const plan = buildInstallPlan(answers({ shadowGit: true }), baseEnv({ shadowTargets: targets }));
    expect(plan.filter((a) => a.kind === 'write-shim-script').length).toBe(1);
    expect(plan.filter((a) => a.kind === 'write-shadow-block').length).toBe(2);
  });

  test('shadowGit true with a powershell target too → a second shim-script variant', () => {
    const targets: ShadowTarget[] = [{ path: '/home/test/.bashrc', shell: 'bash' }, { path: 'C:\\profile.ps1',
      shell: 'powershell' }];
    const plan = buildInstallPlan(answers({ shadowGit: true }), baseEnv({ shadowTargets: targets }));
    expect(plan.filter((a) => a.kind === 'write-shim-script').length).toBe(2);
  });

  test('shadowGit false → no shim or shadow actions', () => {
    const targets: ShadowTarget[] = [{ path: '/home/test/.bashrc', shell: 'bash' }];
    const plan = buildInstallPlan(answers({ shadowGit: false }), baseEnv({ shadowTargets: targets }));
    expect(plan.filter((a) => a.kind === 'write-shadow-block' || a.kind === 'write-shim-script').length).toBe(0);
  });

  test('plugin true + claude on path + not installed → sync-plugin action', () => {
    const plan = buildInstallPlan(answers({ plugin: true }), baseEnv({ claudeOnPath: true, pluginState: 'none' }));
    expect(plan.filter((a) => a.kind === 'sync-plugin').length).toBe(1);
  });

  test('plugin true + already installed under the new id → no sync-plugin action (idempotent re-run)', () => {
    const plan = buildInstallPlan(answers({ plugin: true }), baseEnv({ claudeOnPath: true, pluginState: 'new' }));
    expect(plan.filter((a) => a.kind === 'sync-plugin').length).toBe(0);
  });

  test('plugin true + old identity installed → sync-plugin action describes the swap', () => {
    const plan = buildInstallPlan(answers({ plugin: true }), baseEnv({ claudeOnPath: true, pluginState: 'old' }));
    const action = plan.find((a) => a.kind === 'sync-plugin');
    expect(action?.description).toContain('fnrhombus-plugins');
    expect(action?.description).toContain('rhombus-rocks-claude-plugins');
  });

  test('plugin true + claude NOT on path → no sync-plugin action', () => {
    const plan = buildInstallPlan(answers({ plugin: true }), baseEnv({ claudeOnPath: false }));
    expect(plan.filter((a) => a.kind === 'sync-plugin').length).toBe(0);
  });

  test('plugin false → no sync-plugin action', () => {
    const plan = buildInstallPlan(answers({ plugin: false }), baseEnv({ claudeOnPath: true, pluginState: 'none' }));
    expect(plan.filter((a) => a.kind === 'sync-plugin').length).toBe(0);
  });

  test('fully configured machine with identical answers → empty plan', () => {
    const settings: LocateSettings = { cloneTemplate: '~/src/{repo}@{owner}',
      worktreeTemplate: '~/src/{repo}@{owner}+{input}', additionalSrcDirs: ['~/.local/src'], hostAliases: {} };
    const plan = buildInstallPlan(answers({ shadowGit: false, plugin: false }),
      baseEnv({ currentSettings: settings, configFileExists: true }));
    expect(plan.length).toBe(0);
  });

  test('every action has a description', () => {
    const targets: ShadowTarget[] = [{ path: '/home/test/.bashrc', shell: 'bash' }];
    const plan = buildInstallPlan(answers({ shadowGit: true, plugin: true, hostAliases: { 'github.com': 'gh' } }),
      baseEnv({ shadowTargets: targets, claudeOnPath: true, pluginState: 'none' }));
    for (const action of plan) {
      expect(action.description).toBeTruthy();
    }
  });
});

// ─── buildRemoveShadowPlan ───────────────────────────────────────────────────

describe('buildRemoveShadowPlan', () => {
  test('produces a single remove-shadow action covering every target', () => {
    const targets: ShadowTarget[] = [{ path: '/home/test/.bashrc', shell: 'bash' }, { path: '/home/test/.zshrc',
      shell: 'zsh' }];
    const plan = buildRemoveShadowPlan({ shimDir: '/shims', shadowTargets: targets });
    expect(plan.length).toBe(1);
    expect(plan[0]!.kind).toBe('remove-shadow');
  });

  test('empty targets → empty plan', () => {
    expect(buildRemoveShadowPlan({ shimDir: '/shims', shadowTargets: [] }).length).toBe(0);
  });
});

// ─── describePlan ────────────────────────────────────────────────────────────

describe('describePlan', () => {
  test('empty plan → no-op message', () => {
    expect(describePlan([])).toContain('Nothing to do');
  });

  test('lists each action with a bullet', () => {
    const actions: InstallAction[] = [{ kind: 'write-settings', patch: {}, description: 'Write settings' }, {
      kind: 'sync-plugin',
      description: 'Install plugin',
    }];
    const output = describePlan(actions);
    expect(output).toContain('• Write settings');
    expect(output).toContain('• Install plugin');
  });
});

// ─── INSTALL_HELP ────────────────────────────────────────────────────────────

describe('INSTALL_HELP', () => {
  test('contains every documented option', () => {
    for (const flag of ['--clone-template', '--worktree-template', '--additional-src-dirs', '--host-alias', '--plugin',
      '--no-plugin', '--shadow-git', '--no-shadow-git', '--yes', '--dry-run', '--remove-shadow', '--help'])
    {
      expect(INSTALL_HELP).toContain(flag);
    }
  });
});
