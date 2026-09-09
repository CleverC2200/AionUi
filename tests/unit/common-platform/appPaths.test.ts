import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureElectronAppPaths } from '@/common/platform';

describe('Electron profile identity across product renames', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'gea-profile-'));
    vi.stubEnv('AIONUI_E2E_TEST', '');
    vi.stubEnv('AIONUI_E2E_USER_DATA_DIR', '');
    vi.stubEnv('AIONUI_MULTI_INSTANCE', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  function app(isPackaged = true) {
    let profile = path.join(root, 'GEA');
    return {
      isPackaged,
      getPath: () => root,
      setPath: (_name: 'userData', value: string) => {
        expect(statSync(value).isDirectory()).toBe(true);
        profile = value;
      },
      setName: vi.fn(),
      profile: () => profile,
    };
  }

  it('retains the packaged profile and encryption identity across a display rename', () => {
    mkdirSync(path.join(root, 'GEAUi'));
    writeFileSync(path.join(root, 'GEAUi', 'Preferences'), 'existing preferences');
    const runtime = app();
    configureElectronAppPaths(runtime);
    configureElectronAppPaths(runtime);
    expect(readFileSync(path.join(runtime.profile(), 'Preferences'), 'utf8')).toBe('existing preferences');
    expect(runtime.setName).toHaveBeenCalledWith('GEAUi');
  });

  it.each([true, false])('keeps explicit E2E storage isolated (packaged=%s)', (packaged) => {
    const sandbox = path.join(root, 'sandbox');
    vi.stubEnv('AIONUI_E2E_TEST', '1');
    vi.stubEnv('AIONUI_E2E_USER_DATA_DIR', sandbox);
    const runtime = app(packaged);
    configureElectronAppPaths(runtime);
    expect(runtime.profile()).toBe(sandbox);
    expect(runtime.setName).not.toHaveBeenCalled();
  });

  it('does not accept an E2E override outside E2E mode', () => {
    vi.stubEnv('AIONUI_E2E_USER_DATA_DIR', path.join(root, 'sandbox'));
    const runtime = app();
    configureElectronAppPaths(runtime);
    expect(runtime.profile()).toBe(path.join(root, 'GEAUi'));
  });

  it.each([
    ['', 'AionUi-Dev'],
    ['1', 'AionUi-Dev-2'],
  ])('preserves development isolation (%s)', (flag, name) => {
    vi.stubEnv('AIONUI_MULTI_INSTANCE', flag);
    const runtime = app(false);
    configureElectronAppPaths(runtime);
    expect(runtime.profile()).toBe(path.join(root, name));
    expect(runtime.setName).toHaveBeenCalledWith(name);
  });
});
