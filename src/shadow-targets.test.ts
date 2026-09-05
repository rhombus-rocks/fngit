import { describe, expect, test } from 'bun:test';

import { gatherShadowTargets } from './shadow-targets.js';

describe('gatherShadowTargets — POSIX platforms never probe for a PowerShell profile', () => {
  test('linux: bash/zsh/fish detected via existsSync, powershell never spawned', () => {
    let spawnCalls = 0;
    const targets = gatherShadowTargets('/home/tom', { platform: 'linux', env: {},
      existsSync: (path) => path.endsWith('.bashrc') || path.endsWith('.zshrc') || path.endsWith('fish'),
      spawnPowershell: () => {
        spawnCalls++;
        return { status: 0, stdout: '/home/tom/profile.ps1' };
      } });

    expect(spawnCalls).toBe(0);
    expect(targets.some((t) => t.shell === 'powershell')).toBe(false);
    expect(targets.map((t) => t.shell).sort()).toEqual(['bash', 'fish', 'zsh']);
  });

  test('darwin: same — no PowerShell probe', () => {
    let spawnCalls = 0;
    gatherShadowTargets('/Users/tom', { platform: 'darwin', env: {}, existsSync: () => false, spawnPowershell: () => {
      spawnCalls++;
      return { status: 0, stdout: '' };
    } });
    expect(spawnCalls).toBe(0);
  });

  test('SHELL env var alone (no rc file yet) still names bash/zsh as targets', () => {
    const targets = gatherShadowTargets('/home/tom', { platform: 'linux', env: { SHELL: '/bin/zsh' },
      existsSync: () => false, spawnPowershell: () => ({ status: 0, stdout: '' }) });
    expect(targets).toEqual([{ path: '/home/tom/.zshrc', shell: 'zsh' }]);
  });
});

describe('gatherShadowTargets — win32 probes pwsh, then powershell', () => {
  test('pwsh succeeds — used, powershell never tried', () => {
    const calls: string[] = [];
    const targets = gatherShadowTargets('C:\\Users\\tom', { platform: 'win32', env: {}, existsSync: () => false,
      spawnPowershell: (cmd) => {
        calls.push(cmd);
        return cmd === 'pwsh' ? { status: 0, stdout: 'C:\\profile.ps1' } : { status: 1, stdout: '' };
      } });
    expect(calls).toEqual(['pwsh']);
    expect(targets).toEqual([{ path: 'C:\\profile.ps1', shell: 'powershell' }]);
  });

  test('pwsh fails — falls back to powershell', () => {
    const targets = gatherShadowTargets('C:\\Users\\tom', { platform: 'win32', env: {}, existsSync: () => false,
      spawnPowershell: (cmd) =>
        cmd === 'powershell' ? { status: 0, stdout: 'C:\\legacy-profile.ps1' } : { status: null, stdout: '' } });
    expect(targets).toEqual([{ path: 'C:\\legacy-profile.ps1', shell: 'powershell' }]);
  });

  test('neither available — no powershell target', () => {
    const targets = gatherShadowTargets('C:\\Users\\tom', { platform: 'win32', env: {}, existsSync: () => false,
      spawnPowershell: () => ({ status: null, stdout: '' }) });
    expect(targets).toEqual([]);
  });
});
