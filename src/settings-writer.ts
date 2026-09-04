import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { LocateSettings } from './settings.js';
import { applyTemplate, cloneTemplateVars, type TemplateResolveResult } from './template.js';

const REPO_SETTINGS_KEYS = ['cloneTemplate', 'worktreeTemplate', 'additionalSrcDirs'] as const;

/** Detect the indentation style of a JSON string from its first indented line. */
function detectIndent(content: string): string {
  for (const line of content.split('\n')) {
    const match = /^(\s+)/.exec(line);
    if (match) {
      return match[1]!;
    }
  }
  return '  ';
}

/**
 * Patch `repoSettings` keys in a Claude settings JSON file, preserving
 * unrelated keys, key order, and the file's existing indentation.
 */
export async function writeLocateSettings(patch: Partial<LocateSettings>, target: { path: string; }): Promise<void> {
  let existing: Record<string, unknown> = {};
  let indent = '  ';

  try {
    const raw = await readFile(target.path, 'utf8');
    indent = detectIndent(raw);
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // File absent or malformed — start fresh.
  }

  const repoRaw = existing.repoSettings;
  const repo: Record<string, unknown> =
    (repoRaw !== null && repoRaw !== undefined && typeof repoRaw === 'object' && !Array.isArray(repoRaw))
      ? { ...(repoRaw as Record<string, unknown>) }
      : {};

  for (const key of REPO_SETTINGS_KEYS) {
    const value = patch[key];
    if (value !== undefined) {
      repo[key] = value;
    }
  }

  const result = { ...existing, repoSettings: repo };
  await mkdir(dirname(target.path), { recursive: true });
  await writeFile(target.path, JSON.stringify(result, null, indent) + '\n');
}

/** Write a host-aliases JSON file, creating parent directories as needed. */
export async function writeHostAliases(aliases: Readonly<Record<string, string>>,
  target: { path: string; }): Promise<void>
{
  await mkdir(dirname(target.path), { recursive: true });
  await writeFile(target.path, JSON.stringify(aliases, null, 2) + '\n');
}

/** Example values used by {@link previewTemplate} when none are provided. */
export interface PreviewVars {
  repo?: string;
  owner?: string;
  host?: string;
  input?: string;
  hostAliases?: Readonly<Record<string, string>>;
}

const DEFAULT_PREVIEW: Required<PreviewVars> = { repo: 'fngit', owner: 'rhombus-rocks', host: 'github.com',
  input: 'feat-x', hostAliases: { 'github.com': 'gh' } };

/** Render a template with example values to show the user what it produces. */
export function previewTemplate(template: string, vars?: PreviewVars): TemplateResolveResult {
  const v = { ...DEFAULT_PREVIEW, ...vars };
  return applyTemplate(template, { ...cloneTemplateVars(v.repo, v.owner, v.host, v.hostAliases),
    input: () => ({ ok: true as const, value: v.input }) });
}

/** Validate that a clone template contains `{repo}` and applies cleanly with example vars. */
export function validateCloneTemplate(template: string): { ok: true; } | { ok: false; error: string; } {
  if (!template.includes('{repo}')) {
    return { ok: false, error: 'clone template must contain the {repo} placeholder' };
  }
  const result = previewTemplate(template);
  if (!result.ok) {
    return result;
  }
  return { ok: true };
}
