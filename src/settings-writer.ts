import { stringifyTOML, stringifyYAML } from 'confbox';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname } from 'node:path';

import { parseConfigDocument, resolveConfigPath } from './settings.js';

/** The canonical `$schema` value every write ensures is present, as the first key. */
export const SCHEMA_URL = 'https://json.schemastore.org/rhombus-rocks-config.json';

/** The `repos.*` fields fngit owns and may write; omit a field to leave it untouched. */
export interface ReposPatch {
  cloneTemplate?: string;
  worktreeTemplate?: string;
  additionalSrcDirs?: readonly string[];
  hostAliases?: Readonly<Record<string, string>>;
}

export interface WriteRepoSettingsArgs {
  home: string;
  /** Defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Explicit config-file path, mainly for tests; production relies on `env.FNGIT_CONFIG` or the default scan. */
  configPath?: string;
  patch: ReposPatch;
}

export interface WriteRepoSettingsResult {
  path: string;
  /** Whether this write created the file — it didn't exist beforehand. */
  created: boolean;
}

/**
 * Merge `patch` into `repos` in the resolved config file, preserving every
 * other key — top-level keys other tools own, and `repos.*` keys fngit
 * doesn't (`branchTemplate` included) — and ensuring `$schema` is the first
 * key. A file that already exists keeps its format (json/jsonc/toml/yaml); a
 * new one is always JSON, at the resolved path (`config.json` by default, or
 * wherever `FNGIT_CONFIG`/`configPath` names).
 *
 * An unreadable or malformed existing file is treated as an empty document —
 * the same per-field "contributes nothing" degrade the reader applies —
 * rather than aborting the write.
 */
export function writeRepoSettings(args: WriteRepoSettingsArgs): WriteRepoSettingsResult {
  const env = args.env ?? process.env;
  const resolved = resolveConfigPath({ home: args.home, env, configPath: args.configPath });
  const existing = resolved.exists ? parseConfigDocument(resolved.path) : undefined;
  const document = mergeDocument(existing, args.patch);
  const ext = formatExtension(resolved.path);

  mkdirSync(dirname(resolved.path), { recursive: true });
  writeFileSync(resolved.path, serializeDocument(document, ext));
  return { path: resolved.path, created: !resolved.exists };
}

function mergeDocument(existing: unknown, patch: ReposPatch): Record<string, unknown> {
  const doc = isRecord(existing) ? { ...existing } : {};
  const existingRepos = isRecord(doc.repos) ? (doc.repos as Record<string, unknown>) : {};
  const repos = { ...existingRepos };
  if (patch.cloneTemplate !== undefined) {
    repos.cloneTemplate = patch.cloneTemplate;
  }
  if (patch.worktreeTemplate !== undefined) {
    repos.worktreeTemplate = patch.worktreeTemplate;
  }
  if (patch.additionalSrcDirs !== undefined) {
    repos.additionalSrcDirs = [...patch.additionalSrcDirs];
  }
  if (patch.hostAliases !== undefined) {
    repos.hostAliases = { ...patch.hostAliases };
  }
  doc.repos = repos;
  delete doc.$schema;
  return { $schema: SCHEMA_URL, ...doc };
}

function formatExtension(path: string): string {
  return extname(path).toLowerCase().replace(/^\./, '');
}

function serializeDocument(document: Record<string, unknown>, ext: string): string {
  switch (ext) {
    case 'toml': {
      return stringifyTOML(document);
    }
    case 'yaml':
    case 'yml': {
      return stringifyYAML(document);
    }
    // json, jsonc, and anything else (an unrecognized FNGIT_CONFIG extension) — plain JSON.
    default: {
      return `${JSON.stringify(document, null, 2)}\n`;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
