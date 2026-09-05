import { parseJSONC, parseTOML, parseYAML } from 'confbox';
import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/** Everything the locator needs from configuration, once the config file (or its fallback) is loaded. */
export interface LocateSettings {
  cloneTemplate: string;
  worktreeTemplate: string;
  additionalSrcDirs: readonly string[];
  hostAliases: Readonly<Record<string, string>>;
}

/** `{host-short}` defaults, overridden per-key by `repos.hostAliases`. */
export const BUILTIN_HOST_ALIASES: Readonly<Record<string, string>> = { 'github.com': 'gh', 'gitlab.com': 'gl',
  'bitbucket.org': 'bb', 'codeberg.org': 'cb' };

/** The directory name the shared config lives under, beneath `$XDG_CONFIG_HOME` (or `~/.config`). */
export const CONFIG_DIR_NAME = 'rhombus.rocks';

/** The accepted config file extensions, in the order they're searched — first existing file wins. */
export const CONFIG_EXTENSIONS = ['json', 'jsonc', 'toml', 'yaml'] as const;

/** The `repos` fields this library reads, once extracted from whichever source supplied them. */
interface ReposFields {
  cloneTemplate: string;
  worktreeTemplate: string;
  additionalSrcDirs: string[];
  hostAliases: Record<string, string>;
}

const EMPTY_REPOS_FIELDS: ReposFields = { cloneTemplate: '', worktreeTemplate: '', additionalSrcDirs: [],
  hostAliases: {} };

/** `$XDG_CONFIG_HOME/rhombus.rocks` (default `<home>/.config/rhombus.rocks`). */
export function defaultConfigDir(home: string, env: Readonly<Record<string, string | undefined>>): string {
  const xdgConfigHome = env.XDG_CONFIG_HOME;
  return join(xdgConfigHome !== undefined && xdgConfigHome !== '' ? xdgConfigHome : join(home, '.config'),
    CONFIG_DIR_NAME);
}

export interface ResolveConfigPathArgs {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  /** Explicit override, taking priority over `env.FNGIT_CONFIG`. */
  configPath?: string;
}

export interface ResolvedConfigPath {
  path: string;
  exists: boolean;
  /** Whether `path` came from `configPath`/`FNGIT_CONFIG` rather than the default scan. */
  overridden: boolean;
}

/**
 * Where the shared config file is: an explicit override (`configPath`, then
 * `FNGIT_CONFIG`) verbatim, whether or not it exists; otherwise the first of
 * `config.json`, `config.jsonc`, `config.toml`, `config.yaml` that exists
 * under {@link defaultConfigDir}, or `config.json` there if none do.
 */
export function resolveConfigPath(args: ResolveConfigPathArgs): ResolvedConfigPath {
  const override = args.configPath ?? args.env.FNGIT_CONFIG;
  if (override !== undefined && override !== '') {
    return { path: override, exists: isFile(override), overridden: true };
  }
  const dir = defaultConfigDir(args.home, args.env);
  for (const ext of CONFIG_EXTENSIONS) {
    const candidate = join(dir, `config.${ext}`);
    if (isFile(candidate)) {
      return { path: candidate, exists: true, overridden: false };
    }
  }
  return { path: join(dir, 'config.json'), exists: false, overridden: false };
}

export interface LoadLocateSettingsArgs {
  home: string;
  /** Defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Explicit config-file path, mainly for tests; production relies on `env.FNGIT_CONFIG` or the default scan. */
  configPath?: string;
  /** Path to the legacy `~/.fngitrc` migration source; defaults to `<home>/.fngitrc`. */
  legacyPath?: string;
}

/**
 * Load `repos.*` from the shared config file, falling back to the legacy
 * `~/.fngitrc` (migration-only: read when the new file is absent, never
 * merged with it) — and merge in the built-in `{host-short}` aliases.
 */
export function loadLocateSettings(args: LoadLocateSettingsArgs): LocateSettings {
  const env = args.env ?? process.env;
  const resolved = resolveConfigPath({ home: args.home, env, configPath: args.configPath });
  const repos = resolved.exists
    ? extractReposFields(readContainer(parseConfigDocument(resolved.path), 'repos'))
    : extractReposFields(readJsonObject(args.legacyPath ?? join(args.home, '.fngitrc')));
  return { cloneTemplate: repos.cloneTemplate, worktreeTemplate: repos.worktreeTemplate,
    additionalSrcDirs: repos.additionalSrcDirs, hostAliases: { ...BUILTIN_HOST_ALIASES, ...repos.hostAliases } };
}

/** Pull `container[key]` out of a parsed document, or undefined if it's missing or the wrong shape. */
function readContainer(document: unknown, key: string): unknown {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return undefined;
  }
  return (document as Record<string, unknown>)[key];
}

/**
 * Per-field degrade, same rule everywhere in this library: a wrong-shaped
 * field contributes nothing rather than dropping the whole source.
 */
function extractReposFields(container: unknown): ReposFields {
  if (container === null || typeof container !== 'object' || Array.isArray(container)) {
    return { ...EMPTY_REPOS_FIELDS };
  }
  const obj = container as Record<string, unknown>;
  const result = { ...EMPTY_REPOS_FIELDS };
  if (typeof obj.cloneTemplate === 'string') {
    result.cloneTemplate = obj.cloneTemplate;
  }
  if (typeof obj.worktreeTemplate === 'string') {
    result.worktreeTemplate = obj.worktreeTemplate;
  }
  const srcDirs = readSrcDirs(obj.additionalSrcDirs);
  if (srcDirs !== null) {
    result.additionalSrcDirs = srcDirs;
  }
  if (isStringRecord(obj.hostAliases)) {
    result.hostAliases = obj.hostAliases;
  }
  return result;
}

/**
 * `additionalSrcDirs` in either accepted shape, or null when it says nothing
 * usable — a list carrying a non-string entry is rejected whole rather than
 * quietly searching a subset of the paths configured.
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

function isStringRecord(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === 'string');
}

/**
 * Parse a config file by its extension (json/jsonc/toml/yaml), or undefined if
 * missing/unreadable/malformed. Exported for the writer, which needs the raw
 * document (not just `repos`) to merge into.
 */
export function parseConfigDocument(path: string): unknown {
  const text = readFile(path);
  if (text === undefined) {
    return undefined;
  }
  const ext = extname(path).toLowerCase().replace(/^\./, '');
  try {
    switch (ext) {
      case 'toml': {
        return parseTOML(text);
      }
      case 'yaml':
      case 'yml': {
        return parseYAML(text);
      }
      // json, jsonc, and anything unrecognized (e.g. a FNGIT_CONFIG override with
      // no/an odd extension) — JSONC's parser accepts plain JSON too.
      default: {
        return parseJSONC(text);
      }
    }
  } catch {
    return undefined;
  }
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  const text = readFile(path);
  if (text === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

function readFile(path: string): string | undefined {
  try {
    if (!statSync(path).isFile()) {
      return undefined;
    }
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
