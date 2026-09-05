import type { FromSchema } from 'json-schema-to-ts';

/**
 * Type-level mirror of `schemas/rhombus-rocks-config.json`, kept in sync by
 * `config-schema.test.ts` (structural diff against the shipped file).
 * Descriptions/title/$id are omitted here — they don't affect the derived
 * type — so this stays the minimal shape `FromSchema` needs.
 */
export const RHOMBUS_ROCKS_CONFIG_SHAPE = { type: 'object',
  properties: { $schema: { type: 'string' },
    repos: { type: 'object',
      properties: { cloneTemplate: { type: 'string' }, worktreeTemplate: { type: 'string' },
        branchTemplate: { type: 'string' },
        additionalSrcDirs: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        hostAliases: { type: 'object', additionalProperties: { type: 'string' } } }, additionalProperties: true } },
  additionalProperties: true } as const;

/** The shared config file's shape, as parsed — before per-field degrade/normalization. */
export type RhombusRocksConfig = FromSchema<typeof RHOMBUS_ROCKS_CONFIG_SHAPE>;

/** The `repos` block's shape, as parsed. */
export type ReposConfigShape = NonNullable<RhombusRocksConfig['repos']>;
