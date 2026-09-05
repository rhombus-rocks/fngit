import { spawnSync } from 'node:child_process';

/** The Claude Code plugin's name and marketplace, per the rhombus.rocks contract. */
export const PLUGIN_NAME = 'worktree-paths';
export const PLUGIN_MARKETPLACE_OWNER_REPO = 'rhombus-rocks/claude-plugins';
export const PLUGIN_MARKETPLACE_NAME = 'rhombus-rocks-claude-plugins';
export const PLUGIN_ID = `${PLUGIN_NAME}@${PLUGIN_MARKETPLACE_NAME}`;

/** The plugin's old identity, from before the rhombus.rocks rename — detected and swapped, never left in place. */
export const OLD_PLUGIN_ID = 'claude-code-worktree-paths@fnrhombus-plugins';

export type PluginState = 'new' | 'old' | 'none';

/** What `claude plugin list`'s output says about this plugin: installed under the new id, the old id, or neither. */
export function detectPluginState(pluginListOutput: string): PluginState {
  if (pluginListOutput.includes(PLUGIN_ID)) {
    return 'new';
  }
  if (pluginListOutput.includes(OLD_PLUGIN_ID)) {
    return 'old';
  }
  return 'none';
}

/** Whether the plugin — old or new identity — is installed at all. */
export function isPluginInstalled(pluginListOutput: string): boolean {
  return detectPluginState(pluginListOutput) !== 'none';
}

/** The `claude` subprocess calls plugin sync needs; injectable so tests never spawn the real CLI. */
export interface IClaudeCli {
  listPlugins(): string;
  addMarketplace(ownerRepo: string): boolean;
  installPlugin(pluginId: string): boolean;
  uninstallPlugin(pluginId: string): boolean;
}

export class ClaudeCli implements IClaudeCli {
  listPlugins(): string {
    const result = spawnSync('claude', ['plugin', 'list'], { encoding: 'utf8', stdio: 'pipe' });
    return result.stdout ?? '';
  }

  addMarketplace(ownerRepo: string): boolean {
    return spawnSync('claude', ['plugin', 'marketplace', 'add', ownerRepo], { stdio: 'inherit' }).status === 0;
  }

  installPlugin(pluginId: string): boolean {
    return spawnSync('claude', ['plugin', 'install', pluginId], { stdio: 'inherit' }).status === 0;
  }

  uninstallPlugin(pluginId: string): boolean {
    return spawnSync('claude', ['plugin', 'uninstall', pluginId], { stdio: 'inherit' }).status === 0;
  }
}

export type SyncPluginOutcome = 'installed' | 'swapped' | 'already-installed';

/**
 * Bring the plugin up to date: install it fresh, swap an old-identity install
 * for the new one, or do nothing when the new identity is already installed.
 */
export function syncPlugin(cli: IClaudeCli): SyncPluginOutcome {
  const state = detectPluginState(cli.listPlugins());
  if (state === 'new') {
    return 'already-installed';
  }
  if (state === 'old') {
    cli.uninstallPlugin(OLD_PLUGIN_ID);
  }
  cli.addMarketplace(PLUGIN_MARKETPLACE_OWNER_REPO);
  cli.installPlugin(PLUGIN_ID);
  return state === 'old' ? 'swapped' : 'installed';
}
