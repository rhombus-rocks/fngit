#!/usr/bin/env node
import { assertNever } from '@rhombus-toolkit/type-guards';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { constants, homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { planInvocation, renderLocateFailure } from './cli-plan.js';
import { buildInstallPlan, buildRemoveShadowPlan, describePlan, INSTALL_HELP, type InstallAction, type InstallEnv,
  type InstallOptions, type IPrompter, needsPrompting, resolveInstallAnswers } from './install-plan.js';
import { locate } from './locate.js';
import { LocateError } from './LocateError.js';
import { ClaudeCli, detectPluginState, syncPlugin } from './plugin.js';
import { resolveRealGit } from './real-git.js';
import { writeRepoSettings } from './settings-writer.js';
import { loadLocateSettings, resolveConfigPath } from './settings.js';
import { shadowTargetsFor } from './shadow-targets.js';
import { removeShellBlock, type ShellType, shimDir, shimFilename, shimScriptContents,
  upsertShellBlock } from './shim.js';

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
    case 'install-usage-error': {
      process.stderr.write(INSTALL_HELP);
      process.exitCode = 2;
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
  const gitPath = resolveRealGit(process.env, OWN_PACKAGE_DIR, {}, shimDir(homedir(), process.env));
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
    if (process.platform === 'win32') {
      const sigNum = constants.signals[result.signal as keyof typeof constants.signals];
      process.stderr.write(`fngit: git terminated by ${result.signal}\n`);
      return 128 + (sigNum ?? 1);
    }
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

  const gitFound = resolveRealGit(process.env, OWN_PACKAGE_DIR, {}, shimDir(homedir(), process.env)) !== undefined;
  if (!gitFound) {
    process.stderr.write('fngit install: git not found on PATH\n');
    return 1;
  }
  if (!commandExists('gh')) {
    process.stderr.write('fngit install: warning — gh not found; owner lookup and cloning require it\n');
  }

  const home = homedir();
  const resolvedConfig = resolveConfigPath({ home, env: process.env });
  const dir = shimDir(home, process.env);
  const shadowTargets = shadowTargetsFor(options.removeShadow, home);
  const claudeOnPath = commandExists('claude');
  const claudeCli = new ClaudeCli();
  const pluginState = claudeOnPath ? detectPluginState(claudeCli.listPlugins()) : 'none';

  const env: InstallEnv = { currentSettings: loadLocateSettings({ home }), configPath: resolvedConfig.path,
    configFileExists: resolvedConfig.exists, shimDir: dir, shadowTargets, claudeOnPath, pluginState };

  if (options.removeShadow) {
    const actions = buildRemoveShadowPlan(env);
    if (options.dryRun) {
      process.stdout.write(`${describePlan(actions)}\n`);
      return 0;
    }
    await executeActions(actions, claudeCli);
    return 0;
  }

  if (!options.yes && process.stdin.isTTY !== true && needsPrompting(options)) {
    process.stderr.write('fngit install: non-interactive stdin — pass --yes or provide all options\n');
    return 2;
  }

  const prompter: IPrompter = options.yes || process.stdin.isTTY !== true
    ? new DefaultPrompter()
    : new ReadlinePrompter();
  try {
    const answers = await resolveInstallAnswers(options, env, prompter);
    const actions = buildInstallPlan(answers, { ...env, shadowTargets: shadowTargetsFor(answers.shadowGit, home) });

    if (options.dryRun) {
      process.stdout.write(`${describePlan(actions)}\n`);
      return 0;
    }

    await executeActions(actions, claudeCli);
    return 0;
  } finally {
    if (prompter instanceof ReadlinePrompter) {
      prompter.close();
    }
  }
}

function commandExists(name: string): boolean {
  return spawnSync(name, ['--version'], { encoding: 'utf8', stdio: 'pipe' }).status === 0;
}

async function executeActions(actions: readonly InstallAction[], claudeCli: ClaudeCli): Promise<void> {
  for (const action of actions) {
    switch (action.kind) {
      case 'write-settings': {
        writeRepoSettings({ home: homedir(), patch: action.patch });
        process.stderr.write(`  ✓ ${action.description}\n`);
        break;
      }
      case 'write-shim-script': {
        await writeShimScript(action.shell);
        process.stderr.write(`  ✓ ${action.description}\n`);
        break;
      }
      case 'write-shadow-block': {
        const existing = readFileSafe(action.path);
        const updated = upsertShellBlock(existing, action.shell, shimDir(homedir(), process.env));
        mkdirSync(dirname(action.path), { recursive: true });
        writeFileSync(action.path, updated);
        process.stderr.write(`  ✓ ${action.description}\n`);
        break;
      }
      case 'remove-shadow': {
        for (const target of action.targets) {
          const existing = readFileSafe(target.path);
          if (existing !== '') {
            writeFileSync(target.path, removeShellBlock(existing));
          }
        }
        process.stderr.write(`  ✓ ${action.description}\n`);
        break;
      }
      case 'sync-plugin': {
        syncPlugin(claudeCli);
        process.stderr.write(`  ✓ ${action.description}\n`);
        break;
      }
      default: {
        assertNever(action);
      }
    }
  }
}

/** Write the shim script (posix `git`, or Windows `git.cmd`) into the shim directory, executable on POSIX. */
async function writeShimScript(variant: ShellType): Promise<void> {
  const dir = shimDir(homedir(), process.env);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, shimFilename(variant));
  writeFileSync(path, shimScriptContents(variant));
  if (variant !== 'powershell') {
    await chmod(path, 0o755);
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
    // Silent — every answer is already a default; nothing to narrate.
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
    if (answer.trim() === '') {
      return defaultValue;
    }
    return answer.trim().toLowerCase().startsWith('y');
  }

  print(message: string): void {
    process.stderr.write(`${message}\n`);
  }

  close(): void {
    this.#rl.close();
  }
}
