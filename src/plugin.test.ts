import { describe, expect, test } from 'bun:test';

import { detectPluginState, type IClaudeCli, isPluginInstalled, OLD_PLUGIN_ID, PLUGIN_ID, PLUGIN_MARKETPLACE_OWNER_REPO,
  syncPlugin } from './plugin.js';

describe('detectPluginState', () => {
  test('new plugin id present → new', () => {
    expect(detectPluginState(`some-other-plugin@x\n${PLUGIN_ID}\n`)).toBe('new');
  });

  test('old plugin id present, new absent → old', () => {
    expect(detectPluginState(`${OLD_PLUGIN_ID}\n`)).toBe('old');
  });

  test('neither present → none', () => {
    expect(detectPluginState('some-other-plugin@marketplace\n')).toBe('none');
  });

  test('empty output → none', () => {
    expect(detectPluginState('')).toBe('none');
  });
});

describe('isPluginInstalled', () => {
  test('true for either identity', () => {
    expect(isPluginInstalled(PLUGIN_ID)).toBe(true);
    expect(isPluginInstalled(OLD_PLUGIN_ID)).toBe(true);
  });

  test('false otherwise', () => {
    expect(isPluginInstalled('nothing relevant')).toBe(false);
  });
});

interface FakeLog {
  calls: string[];
}

function fakeCli(listOutput: string): IClaudeCli & { log: FakeLog; } {
  const log: FakeLog = { calls: [] };
  return { log, listPlugins: () => listOutput, addMarketplace: (ownerRepo) => {
    log.calls.push(`add-marketplace:${ownerRepo}`);
    return true;
  }, installPlugin: (id) => {
    log.calls.push(`install:${id}`);
    return true;
  }, uninstallPlugin: (id) => {
    log.calls.push(`uninstall:${id}`);
    return true;
  } };
}

describe('syncPlugin', () => {
  test('not installed → adds the marketplace and installs the new id, outcome installed', () => {
    const cli = fakeCli('');
    expect(syncPlugin(cli)).toBe('installed');
    expect(cli.log.calls).toEqual([`add-marketplace:${PLUGIN_MARKETPLACE_OWNER_REPO}`, `install:${PLUGIN_ID}`]);
  });

  test('old identity installed → uninstalls it first, then installs the new id, outcome swapped', () => {
    const cli = fakeCli(OLD_PLUGIN_ID);
    expect(syncPlugin(cli)).toBe('swapped');
    expect(cli.log.calls).toEqual([`uninstall:${OLD_PLUGIN_ID}`, `add-marketplace:${PLUGIN_MARKETPLACE_OWNER_REPO}`,
      `install:${PLUGIN_ID}`]);
  });

  test('new identity already installed → no calls, outcome already-installed', () => {
    const cli = fakeCli(PLUGIN_ID);
    expect(syncPlugin(cli)).toBe('already-installed');
    expect(cli.log.calls).toEqual([]);
  });
});
