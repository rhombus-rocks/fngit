export { type ReposConfigShape, RHOMBUS_ROCKS_CONFIG_SHAPE, type RhombusRocksConfig } from './config-schema.js';
export { type GhApiResult, type GhCloneResult, GitHubCli, type IGitHubCli } from './IGitHubCli.js';
export { type LocalRepo, locate, type Located, type LocateOptions, type RemoteRepo } from './locate.js';
export { LocateError, type LocateFailure } from './LocateError.js';
export { parseRepoRef, type ParseRepoRefResult, type RepoRef } from './RepoRef.js';
export { type ReposPatch, SCHEMA_URL, writeRepoSettings, type WriteRepoSettingsArgs,
  type WriteRepoSettingsResult } from './settings-writer.js';
export { BUILTIN_HOST_ALIASES, CONFIG_DIR_NAME, CONFIG_EXTENSIONS, defaultConfigDir, loadLocateSettings,
  type LocateSettings, resolveConfigPath, type ResolveConfigPathArgs, type ResolvedConfigPath } from './settings.js';
export { cloneTemplateVars, worktreeTemplateVars } from './template.js';
