#!/usr/bin/env node
import { assertNever } from '@rhombus-toolkit/type-guards';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { planInvocation, renderLocateFailure } from './cli-plan.js';
import { buildInstallPlan, buildRemoveShadowPlan, describePlan, INSTALL_HELP, type InstallAction, type InstallEnv,
  type InstallOptions, type IPrompter, needsPrompting, resolveInstallAnswers,
  type ShadowTarget } from './install-plan.js';
import { locate } from './locate.js';
import { LocateError } from './LocateError.js';
import { resolveRealGit } from './real-git.js';
import { writeHostAliases, writeLocateSettings } from './settings-writer.js';
import { loadLocateSettings } from './settings.js';
import { removeShellBlock, upsertShellBlock } from './shell-block.js';

// fngit's own install directory — the directory holding its package.json — so
// a `git` lookup that resolves back inside it (a shadowing alias/shim pointing
// at fngit itself) can be told apart from the real git.
const OWN_PACKAGE_DIR = findOwnPackageDir(fileURLToPath(import.meta.url));

const RECURSION_MESSAGE = "fngit: refusing to run recursively — is 'git' on PATH pointing back at fngit? "
  + 'Set FNGIT_GIT to the real git binary.\n';

await main(process.argv.slice(2));

async function main(argv: readonly string[]): Promise<void> {
  if (process.env.FNGIT_DEPTH !== undefined) {
    process.stderr.write(RECURSION_MESSAGE);
    process.exitCode = 126;
    return;
  }
  const plan = planInvocation(argv);
  switch (plan.kind) {
    case 'passthrough': {
      if (plan.installHint) {
        process.stderr.write(
          "fngit: 'install' with those arguments is handed to git (run 'fngit install --help' for fngit's own options)\n",
        );
      }
      process.exitCode = runGit(plan.args);
      return;
    }
    case 'reject-workspace': {
      process.stderr.write('fngit clone: the +workspace suffix is not supported yet\n');
      process.exitCode = 2;
      return;
    }
    case 'clone': {
      process.exitCode = await runClone(plan.input, plan.cloneArgs);
      return;
    }
    case 'install': {
      process.exitCode = await runInstall(plan.options);
      return;
    }
    default: {
      assertNever(plan);
    }
  }
}

/** Resolve `input` to a checkout, cloning it if needed, and print its path — the effects side of `planInvocation`'s `clone` outcome. */
async function runClone(input: string, cloneArgs: readonly string[]): Promise<number> {
  try {
    const repo = await locate(input, { clone: true, cloneArgs });
    process.stdout.write(`${repo.path}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof LocateError)) {
      throw error;
    }
    const render = renderLocateFailure(error.failure);
    process.stderr.write(`${[error.message, ...render.extraLines].join('\n')}\n`);
    return render.exitCode;
  }
}

/** Run the real `git` with `args` inherited on this process's stdio, mapping its outcome to an exit code. */
function runGit(args: readonly string[]): number {
  const gitPath = resolveRealGit(process.env, OWN_PACKAGE_DIR);
  if (gitPath === undefined) {
    process.stderr.write('fngit: git not found on PATH (set FNGIT_GIT to the real git binary)\n');
    return 127;
  }
  // FNGIT_DEPTH marks this as an fngit-spawned child, so a `git` alias/shim that
  // loops back to fngit trips the recursion guard instead of spawning forever.
  const result = spawnSync(gitPath, args, { stdio: 'inherit', env: { ...process.env, FNGIT_DEPTH: '1' } });
  if (result.error !== undefined) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      process.stderr.write('fngit: git not found on PATH (set FNGIT_GIT to the real git binary)\n');
      return 127;
    }
    throw result.error;
  }
  if (result.signal !== null) {
    process.kill(process.pid, result.signal);
    return 1;
  }
  return result.status ?? 1;
}

/** Walk up from `startFile` to the nearest directory holding a `package.json` — fngit's own install root. */
function findOwnPackageDir(startFile: string): string {
  let dir = dirname(startFile);
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return dir;
    }
    dir = parent;
  }
}

// ─── Install command ─────────────────────────────────────────────────────────

async function runInstall(options: InstallOptions): Promise<number> {
  if (options.help) {
    process.stdout.write(INSTALL_HELP);
    return 0;
  }

  // Prerequisites (W4).
  const gitFound = resolveRealGit(process.env, OWN_PACKAGE_DIR) !== undefined;
  if (!gitFound) {
    process.stderr.write('fngit install: git not found on PATH\n');
    return 1;
  }

  const ghFound = commandExists('gh');
  if (!ghFound) {
    process.stderr.write('fngit install: warning — gh not found; owner lookup and cloning require it\n');
  }

  if (ghFound) {
    const ghAuth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: 'pipe' });
    if (ghAuth.status !== 0) {
      if (process.stdin.isTTY) {
        process.stderr.write('fngit install: gh is not authenticated — running gh auth login\n');
        spawnSync('gh', ['auth', 'login'], { stdio: 'inherit' });
      } else {
        process.stderr.write('fngit install: warning — gh is not authenticated\n');
      }
    }
  }

  const home = homedir();
  const settingsPath = options.project
    ? join(process.cwd(), '.claude/settings.json')
    : join(home, '.claude/settings.json');
  const hostAliasesPath = join(home, '.local/share/fnrhombus/host-aliases.json');
  const shadowTargets = gatherShadowTargets(home);
  const claudeOnPath = commandExists('claude');

  const env: InstallEnv = { home, cwd: process.cwd(), currentSettings: loadLocateSettings({ home, cwd: process.cwd() }),
    settingsPath, hostAliasesPath, shadowTargets, claudeOnPath };

  // --remove-shadow: strip shadow blocks and exit.
  if (options.removeShadow) {
    const actions = buildRemoveShadowPlan(shadowTargets);
    if (options.dryRun) {
      process.stdout.write(describePlan(actions) + '\n');
      return 0;
    }
    await executeActions(actions);
    return 0;
  }

  // Non-TTY guard.
  if (!options.yes && !process.stdin.isTTY && needsPrompting(options)) {
    process.stderr.write('fngit install: non-interactive stdin — pass --yes or provide all options\n');
    return 2;
  }

  const prompter: IPrompter = options.yes || !process.stdin.isTTY ? new DefaultPrompter() : new ReadlinePrompter();
  try {
    const answers = await resolveInstallAnswers(options, env, prompter);
    const actions = buildInstallPlan(answers, env);

    if (options.dryRun) {
      process.stdout.write(describePlan(actions) + '\n');
      return 0;
    }

    await executeActions(actions);
    return 0;
  } finally {
    if (prompter instanceof ReadlinePrompter) {
      prompter.close();
    }
  }
}

function commandExists(name: string): boolean {
  const result = spawnSync(name, ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  return result.status === 0;
}

function gatherShadowTargets(home: string): ShadowTarget[] {
  const targets: ShadowTarget[] = [];
  const shell = process.env.SHELL ?? '';

  const bashrc = join(home, '.bashrc');
  if (existsSync(bashrc) || shell.endsWith('/bash')) {
    targets.push({ path: bashrc, shell: 'bash' });
  }

  const zshrc = join(home, '.zshrc');
  if (existsSync(zshrc) || shell.endsWith('/zsh')) {
    targets.push({ path: zshrc, shell: 'zsh' });
  }

  const fishDir = join(home, '.config/fish');
  if (existsSync(fishDir)) {
    targets.push({ path: join(fishDir, 'conf.d/fngit.fish'), shell: 'fish' });
  }

  for (const cmd of ['pwsh', 'powershell'] as const) {
    try {
      const result = spawnSync(cmd, ['-NoProfile', '-Command', '$PROFILE'], { encoding: 'utf8', stdio: 'pipe',
        timeout: 5000 });
      if (result.status === 0) {
        const profile = result.stdout.trim();
        if (profile) {
          targets.push({ path: profile, shell: 'powershell' });
          break;
        }
      }
    } catch {
      continue;
    }
  }

  return targets;
}

async function executeActions(actions: readonly InstallAction[]): Promise<void> {
  for (const action of actions) {
    switch (action.kind) {
      case 'write-settings': {
        await writeLocateSettings(action.patch, { path: action.path });
        process.stderr.write(`  ✓ ${action.description}\n`);
        break;
      }
      case 'write-host-aliases': {
        await writeHostAliases(action.aliases, { path: action.path });
        process.stderr.write(`  ✓ ${action.description}\n`);
        break;
      }
      case 'write-shadow-block': {
        const existing = readFileSafe(action.path);
        const updated = upsertShellBlock(existing, action.shell);
        await mkdir(dirname(action.path), { recursive: true });
        await writeFile(action.path, updated);
        process.stderr.write(`  ✓ ${action.description}\n`);
        break;
      }
      case 'remove-shadow-block': {
        const existing = readFileSafe(action.path);
        if (existing) {
          const updated = removeShellBlock(existing);
          await writeFile(action.path, updated);
          process.stderr.write(`  ✓ ${action.description}\n`);
        }
        break;
      }
      case 'install-plugin': {
        spawnSync('claude', ['plugin', 'marketplace', 'add', 'fnrhombus/claude-plugins'], { stdio: 'inherit' });
        spawnSync('claude', ['plugin', 'install', 'claude-code-worktree-paths@fnrhombus-plugins'], {
          stdio: 'inherit',
        });
        process.stderr.write(`  ✓ ${action.description}\n`);
        break;
      }
      default: {
        assertNever(action);
      }
    }
  }
}

function readFileSafe(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

// ─── Prompter implementations ────────────────────────────────────────────────

class DefaultPrompter implements IPrompter {
  async ask(_question: string, defaultValue: string): Promise<string> {
    return defaultValue;
  }

  async confirm(_question: string, defaultValue: boolean): Promise<boolean> {
    return defaultValue;
  }

  print(): void {
    // Silent.
  }
}

class ReadlinePrompter implements IPrompter {
  #rl: ReturnType<typeof createInterface>;

  constructor() {
    this.#rl = createInterface({ input: process.stdin, output: process.stderr });
  }

  async ask(question: string, defaultValue: string): Promise<string> {
    const answer = await new Promise<string>((resolve) => {
      this.#rl.question(`${question} [${defaultValue}]: `, resolve);
    });
    return answer.trim() || defaultValue;
  }

  async confirm(question: string, defaultValue: boolean): Promise<boolean> {
    const hint = defaultValue ? 'Y/n' : 'y/N';
    const answer = await new Promise<string>((resolve) => {
      this.#rl.question(`${question} [${hint}]: `, resolve);
    });
    if (!answer.trim()) {
      return defaultValue;
    }
    return answer.trim().toLowerCase().startsWith('y');
  }

  print(message: string): void {
    process.stderr.write(message + '\n');
  }

  close(): void {
    this.#rl.close();
  }
}
