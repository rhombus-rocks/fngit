export { type ReposConfigShape, RHOMBUS_ROCKS_CONFIG_SHAPE, type RhombusRocksConfig } from './config-schema.js';
export { type GhApiResult, type GhCloneResult, GitHubCli, type IGitHubCli } from './IGitHubCli.js';
export { buildInstallPlan, buildRemoveShadowPlan, currentHostAliasOverrides, describePlan, INSTALL_HELP,
  type InstallAction, type InstallAnswers, type InstallEnv, type InstallOptions, type IPrompter, needsPrompting,
  parseInstallArgs, type ParseInstallArgsResult, RECOMMENDED_CLONE_TEMPLATE, RECOMMENDED_SRC_DIRS,
  RECOMMENDED_WORKTREE_TEMPLATE, resolveInstallAnswers, type ShadowTarget } from './install-plan.js';
export { type LocalRepo, locate, type Located, type LocateOptions, type RemoteRepo } from './locate.js';
export { LocateError, type LocateFailure } from './LocateError.js';
export { ClaudeCli, detectPluginState, type IClaudeCli, isPluginInstalled, OLD_PLUGIN_ID, PLUGIN_ID,
  PLUGIN_MARKETPLACE_NAME, PLUGIN_MARKETPLACE_OWNER_REPO, PLUGIN_NAME, type PluginState, syncPlugin,
  type SyncPluginOutcome } from './plugin.js';
export { parseRepoRef, type ParseRepoRefResult, type RepoRef } from './RepoRef.js';
export { type ReposPatch, SCHEMA_URL, writeRepoSettings, type WriteRepoSettingsArgs,
  type WriteRepoSettingsResult } from './settings-writer.js';
export { BUILTIN_HOST_ALIASES, CONFIG_DIR_NAME, CONFIG_EXTENSIONS, defaultConfigDir, loadLocateSettings,
  type LocateSettings, resolveConfigPath, type ResolveConfigPathArgs, type ResolvedConfigPath } from './settings.js';
export { gatherShadowTargets, type GatherShadowTargetsDeps } from './shadow-targets.js';
export { pathPrependCommand, removeShellBlock, type ShellType, shimDir, shimFilename, shimScriptContents,
  upsertShellBlock } from './shim.js';
export { cloneTemplateVars, worktreeTemplateVars } from './template.js';
