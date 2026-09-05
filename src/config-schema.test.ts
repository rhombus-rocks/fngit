import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RHOMBUS_ROCKS_CONFIG_SHAPE } from './config-schema.js';

/**
 * Recursively drop `description`/`title` — human-readable keys that don't
 * affect the derived TS type and never collide with a meaningful schema
 * keyword or property name.
 */
function stripDocs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripDocs);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'description' && key !== 'title').map((
        [key, entry],
      ) => [key, stripDocs(entry)]),
    );
  }
  return value;
}

describe('config-schema — shipped schema matches the type-level shape', () => {
  test('schemas/rhombus-rocks-config.json, stripped of docs-only keys, equals RHOMBUS_ROCKS_CONFIG_SHAPE', () => {
    const shipped = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'schemas', 'rhombus-rocks-config.json'), 'utf8'),
    ) as Record<string, unknown>;
    // Root-only meta keywords absent from the type-level shape.
    const { $schema: _schemaMeta, $id: _id, title: _title, description: _description, ...rest } = shipped;
    expect(stripDocs(rest)).toEqual(stripDocs(RHOMBUS_ROCKS_CONFIG_SHAPE));
  });
});
