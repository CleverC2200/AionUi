import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDeepLinkResolveResponse, type DeepLinkTarget } from '@/common/types/platform/deepLink';
import {
  SimulatedDeepLinkPlatform,
  type SimulatedNavigationError,
  type SimulatedExternalIdentity,
} from '../fixtures/deepLinkPlatform';

const identity: SimulatedExternalIdentity = {
  provider: 'lark',
  issuer: 'https://open.feishu.cn',
  tenantId: 'tenant-1',
  subject: 'user-1',
};

const conversationTarget: DeepLinkTarget = {
  type: 'conversation',
  conversation_id: 'conversation-1',
  assistant_id: 'assistant-1',
};

const issueFixture = (
  platform: SimulatedDeepLinkPlatform,
  overrides: Partial<Parameters<SimulatedDeepLinkPlatform['issue']>[0]> = {}
) =>
  platform.issue({
    idempotencyKey: 'task-1:user-1',
    identity,
    profile: 'gea.test',
    target: conversationTarget,
    ...overrides,
  });

describe('simulated GEA navigation platform contract', () => {
  it('issues an opaque link and resolves it through the authenticated local seam', () => {
    const platform = new SimulatedDeepLinkPlatform(() => Date.parse('2026-08-29T00:00:00.000Z'));
    const issued = issueFixture(platform);

    expect(issued.link).toMatch(/^aionui:\/\/open-conversation\?ref=nav_[a-f0-9]{32}&v=1&profile=gea\.test$/);
    expect(issued.link).not.toContain('conversation-1');
    expect(issued.link).not.toContain('assistant-1');
    expect(
      parseDeepLinkResolveResponse(
        platform.resolve({
          identity,
          navigationReference: issued.navigationReference,
          profile: 'gea.test',
          schemaVersion: 1,
        })
      )
    ).toMatchObject({ schema_version: 1, target: conversationTarget });
  });

  it('is idempotent at issue time and read-only/replayable at resolve time', () => {
    const platform = new SimulatedDeepLinkPlatform();
    const first = issueFixture(platform);
    const second = issueFixture(platform);
    expect(second).toEqual(first);

    const request = {
      identity,
      navigationReference: first.navigationReference,
      profile: 'gea.test',
      schemaVersion: 1,
    };
    expect(platform.resolve(request)).toEqual(platform.resolve(request));
  });

  it.each([
    [
      'NAVIGATION_SCHEMA_UNSUPPORTED',
      (platform: SimulatedDeepLinkPlatform, reference: string) =>
        platform.resolve({ identity, navigationReference: reference, profile: 'gea.test', schemaVersion: 2 }),
    ],
    [
      'NAVIGATION_REFERENCE_FORBIDDEN',
      (platform: SimulatedDeepLinkPlatform, reference: string) =>
        platform.resolve({
          identity: { ...identity, subject: 'user-other' },
          navigationReference: reference,
          profile: 'gea.test',
          schemaVersion: 1,
        }),
    ],
    [
      'DEEP_LINK_PROFILE_MISMATCH',
      (platform: SimulatedDeepLinkPlatform, reference: string) =>
        platform.resolve({ identity, navigationReference: reference, profile: 'gea.prod', schemaVersion: 1 }),
    ],
  ] as const)('returns the stable failure %s without leaking a target', (code, invoke) => {
    const platform = new SimulatedDeepLinkPlatform();
    const issued = issueFixture(platform);
    expect(() => invoke(platform, issued.navigationReference)).toThrowError(
      expect.objectContaining<Partial<SimulatedNavigationError>>({ code })
    );
  });

  it('fails closed for expired, revoked, and unknown references', () => {
    let now = Date.parse('2026-08-29T00:00:00.000Z');
    const platform = new SimulatedDeepLinkPlatform(() => now);
    const expired = issueFixture(platform, { idempotencyKey: 'expired', ttlSeconds: 1 });
    const revoked = issueFixture(platform, { idempotencyKey: 'revoked' });
    platform.revoke(revoked.navigationReference);
    now += 2_000;

    expect(() =>
      platform.resolve({
        identity,
        navigationReference: expired.navigationReference,
        profile: 'gea.test',
        schemaVersion: 1,
      })
    ).toThrowError(expect.objectContaining({ code: 'NAVIGATION_REFERENCE_EXPIRED' }));
    expect(() =>
      platform.resolve({
        identity,
        navigationReference: revoked.navigationReference,
        profile: 'gea.test',
        schemaVersion: 1,
      })
    ).toThrowError(expect.objectContaining({ code: 'NAVIGATION_REFERENCE_REVOKED' }));
    expect(() =>
      platform.resolve({ identity, navigationReference: 'nav_unknown00000000', profile: 'gea.test', schemaVersion: 1 })
    ).toThrowError(expect.objectContaining({ code: 'NAVIGATION_REFERENCE_NOT_FOUND' }));
  });

  it('keeps landing preview generic and non-consuming', () => {
    const platform = new SimulatedDeepLinkPlatform();
    const issued = issueFixture(platform);
    expect(platform.preview()).toEqual(platform.preview());
    expect(
      platform.resolve({
        identity,
        navigationReference: issued.navigationReference,
        profile: 'gea.test',
        schemaVersion: 1,
      })
    ).toMatchObject({ target: conversationTarget });
  });

  it('keeps the checked-in OpenAPI handoff machine-readable', () => {
    const contractPath = fileURLToPath(
      new URL('../../docs/specs/gea-client-navigation-v1.openapi.json', import.meta.url)
    );
    const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(contract.openapi).toBe('3.1.0');
    expect(Object.keys(contract.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/internal/client-navigation-intents',
        '/ai/gateway/client-navigation-intents/resolve',
        '/api/deep-links/resolve',
      ])
    );
  });
});
