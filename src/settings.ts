import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Everything the locator needs from configuration, once every tier has been merged. */
export interface LocateSettings {
  cloneTemplate: string;
  worktreeTemplate: string;
  additionalSrcDirs: readonly string[];
  hostAliases: Readonly<Record<string, string>>;
}

/** The `repoSettings` fields this library reads, merged across the settings tiers. */
export interface RepoSettings {
  cloneTemplate: string;
  worktreeTemplate: string;
  additionalSrcDirs: string[];
}

export interface LoadRepoSettingsArgs {
  userPath: string;
  projectPath: string;
  localPath: string;
  managedPath?: string;
}

export interface LoadHostAliasesArgs {
  systemPath: string;
  userPath: string;
}

const MANAGED_SETTINGS_PATH = '/etc/claude-code/managed-settings.json';
const SYSTEM_HOST_ALIASES_PATH = '/usr/share/fnrhombus/host-aliases.json';

const STRING_FIELDS = ['cloneTemplate', 'worktreeTemplate'] as const satisfies ReadonlyArray<keyof RepoSettings>;

/** Read the settings chain rooted at `home` and `cwd`, plus the host-aliases layers. */
export function loadLocateSettings(args: { home: string; cwd: string; }): LocateSettings {
  const repoSettings = loadRepoSettings({ userPath: join(args.home, '.claude/settings.json'),
    projectPath: join(args.cwd, '.claude/settings.json'), localPath: join(args.cwd, '.claude/settings.local.json'),
    managedPath: MANAGED_SETTINGS_PATH });
  return { ...repoSettings,
    hostAliases: loadHostAliases({ systemPath: SYSTEM_HOST_ALIASES_PATH,
      userPath: join(args.home, '.local/share/fnrhombus/host-aliases.json') }) };
}

/**
 * Merge the `repoSettings` block of each tier, field by field, later tiers
 * winning; anything unreadable or wrong-shaped contributes nothing rather
 * than failing the load.
 */
export function loadRepoSettings(args: LoadRepoSettingsArgs): RepoSettings {
  const merged: RepoSettings = { cloneTemplate: '', worktreeTemplate: '', additionalSrcDirs: [] };
  for (const path of [args.userPath, args.projectPath, args.localPath, args.managedPath]) {
    if (path === undefined) {
      continue;
    }
    const tier = readRepoSettingsBlock(path);
    for (const field of STRING_FIELDS) {
      const value = tier[field];
      if (typeof value === 'string') {
        merged[field] = value;
      }
    }
    const srcDirs = readSrcDirs(tier.additionalSrcDirs);
    if (srcDirs !== null) {
      merged.additionalSrcDirs = srcDirs;
    }
  }
  return merged;
}

/** Merge the system and user host-alias files, the user's keys winning. */
export function loadHostAliases(args: LoadHostAliasesArgs): Record<string, string> {
  return { ...readStringMap(args.systemPath), ...readStringMap(args.userPath) };
}

/**
 * One tier's `additionalSrcDirs` in either accepted shape, or null when it
 * says nothing usable — a list carrying a non-string entry is rejected whole
 * rather than quietly searching a subset of the paths the user wrote.
 */
function readSrcDirs(value: unknown): string[] | null {
  if (typeof value === 'string') {
    return [value];
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return null;
  }
  return value as string[];
}

function readRepoSettingsBlock(path: string): Partial<Record<keyof RepoSettings, unknown>> {
  const parsed = readJsonObject(path);
  const repoSettings = parsed?.repoSettings;
  if (repoSettings === null || typeof repoSettings !== 'object' || Array.isArray(repoSettings)) {
    return {};
  }
  return repoSettings as Record<string, unknown>;
}

function readStringMap(path: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(readJsonObject(path) ?? {}).filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>;
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  let raw: string;
  try {
    if (!statSync(path).isFile()) {
      return undefined;
    }
    raw = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}
