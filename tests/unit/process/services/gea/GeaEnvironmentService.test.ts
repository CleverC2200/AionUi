/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createGeaEnvironmentId,
  initializeGeaEnvironment,
  resetGeaEnvironmentForTests,
  resolveGeaEnvironment,
  saveGeaEnvironment,
} from '@/process/services/gea/GeaEnvironmentService';

const PROFILE = {
  baseUrl: 'https://profile.example/gea-boot',
  environmentId: 'stale-value-that-must-not-be-trusted',
  revision: 1 as const,
};

beforeEach(() => {
  vi.unstubAllEnvs();
  delete process.env.AIONUI_GEA_BASE_URL;
  delete process.env.AUTH_BROKER_PUBLIC_URL;
  delete process.env.AIONUI_INTERNAL_GEA_BASE_URL_SOURCE;
  resetGeaEnvironmentForTests();
});

describe('resolveGeaEnvironment', () => {
  it('uses the production HTTPS endpoint without a non-standard port by default', () => {
    expect(resolveGeaEnvironment({ env: {}, isPackaged: true })).toMatchObject({
      baseUrl: 'https://gea.synear.cn/gea-boot',
      editable: true,
      source: 'default',
    });
  });

  it('uses the explicit environment before the persisted profile and legacy alias', () => {
    const environment = resolveGeaEnvironment({
      env: {
        AIONUI_GEA_BASE_URL: 'https://runtime.example:4443/gea-boot///',
        AUTH_BROKER_PUBLIC_URL: 'https://legacy.example/gea-boot',
      },
      isPackaged: true,
      profile: PROFILE,
    });

    expect(environment).toEqual({
      baseUrl: 'https://runtime.example:4443/gea-boot',
      editable: false,
      environmentId: createGeaEnvironmentId('https://runtime.example:4443/gea-boot'),
      source: 'environment',
    });
  });

  it('uses the persisted profile before the legacy alias and recomputes its namespace', () => {
    const environment = resolveGeaEnvironment({
      env: { AUTH_BROKER_PUBLIC_URL: 'https://legacy.example/gea-boot' },
      isPackaged: true,
      profile: PROFILE,
    });

    expect(environment.source).toBe('profile');
    expect(environment.editable).toBe(true);
    expect(environment.environmentId).toBe(createGeaEnvironmentId(PROFILE.baseUrl));
    expect(environment.environmentId).not.toBe(PROFILE.environmentId);
  });

  it.each([
    'http://gea.example/gea-boot',
    'https://user:password@gea.example/gea-boot',
    'https://gea.example/gea-boot?tenant=1',
    'https://gea.example/gea-boot#fragment',
    '',
  ])('rejects an unsafe explicit environment without falling back: %s', (baseUrl) => {
    expect(() =>
      resolveGeaEnvironment({
        env: { AIONUI_GEA_BASE_URL: baseUrl },
        isPackaged: true,
        profile: PROFILE,
      })
    ).toThrow();
  });

  it('allows loopback HTTP only outside packaged mode', () => {
    expect(
      resolveGeaEnvironment({ env: { AIONUI_GEA_BASE_URL: 'http://127.0.0.1:43123/gea-boot' }, isPackaged: false })
        .baseUrl
    ).toBe('http://127.0.0.1:43123/gea-boot');
    expect(() =>
      resolveGeaEnvironment({ env: { AIONUI_GEA_BASE_URL: 'http://127.0.0.1:43123/gea-boot' }, isPackaged: true })
    ).toThrow('GEA_BASE_URL_INSECURE');
  });
});

describe('GEA environment persistence', () => {
  it('publishes the canonical address to the process before downstream services start', () => {
    const environment = initializeGeaEnvironment({ isPackaged: true, profile: PROFILE });

    expect(environment.baseUrl).toBe(PROFILE.baseUrl);
    expect(process.env.AIONUI_GEA_BASE_URL).toBe(PROFILE.baseUrl);
  });

  it('does not mistake an internally published profile for an external override after relaunch', () => {
    initializeGeaEnvironment({ isPackaged: true, profile: PROFILE });
    resetGeaEnvironmentForTests();

    const environment = initializeGeaEnvironment({ isPackaged: true, profile: PROFILE });

    expect(environment.source).toBe('profile');
    expect(environment.editable).toBe(true);
  });

  it('keeps a real external override managed after relaunch', () => {
    vi.stubEnv('AIONUI_GEA_BASE_URL', 'https://managed.example/gea-boot');
    initializeGeaEnvironment({ isPackaged: true });
    resetGeaEnvironmentForTests();

    const environment = initializeGeaEnvironment({ isPackaged: true, profile: PROFILE });

    expect(environment.source).toBe('environment');
    expect(environment.editable).toBe(false);
    expect(environment.baseUrl).toBe('https://managed.example/gea-boot');
  });

  it('persists a validated profile without changing the active process environment', async () => {
    initializeGeaEnvironment({ isPackaged: true });
    const persist = vi.fn().mockResolvedValue(undefined);

    const result = await saveGeaEnvironment(' https://test.example:4443/gea-boot/// ', {
      isPackaged: true,
      persist,
    });

    expect(result.changed).toBe(true);
    expect(result.environment.baseUrl).toBe('https://test.example:4443/gea-boot');
    expect(persist).toHaveBeenCalledWith({
      baseUrl: 'https://test.example:4443/gea-boot',
      environmentId: createGeaEnvironmentId('https://test.example:4443/gea-boot'),
      revision: 1,
    });
    expect(process.env.AIONUI_GEA_BASE_URL).toBeUndefined();
  });

  it('keeps the active publication when persistence fails', async () => {
    const current = initializeGeaEnvironment({ isPackaged: true });
    const persist = vi.fn().mockRejectedValue(new Error('disk full'));

    await expect(
      saveGeaEnvironment('https://test.example/gea-boot', {
        isPackaged: true,
        persist,
      })
    ).rejects.toThrow('disk full');

    expect(process.env.AIONUI_GEA_BASE_URL).toBe(current.baseUrl);
  });

  it('does not let a persisted profile override a managed startup value', async () => {
    vi.stubEnv('AIONUI_GEA_BASE_URL', 'https://managed.example/gea-boot');
    initializeGeaEnvironment({ isPackaged: true });
    const persist = vi.fn().mockResolvedValue(undefined);

    await expect(saveGeaEnvironment('https://test.example/gea-boot', { isPackaged: true, persist })).rejects.toThrow(
      'GEA_ENVIRONMENT_MANAGED'
    );
    expect(persist).not.toHaveBeenCalled();
  });
});
