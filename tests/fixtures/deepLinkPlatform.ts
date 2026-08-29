import { createHash, randomUUID } from 'node:crypto';
import type { DeepLinkResolveResponse, DeepLinkTarget } from '@/common/types/platform/deepLink';

export type SimulatedExternalIdentity = {
  issuer: string;
  provider: 'lark';
  subject: string;
  tenantId: string;
};

export type SimulatedNavigationIntent = {
  expiresAt: string;
  link: string;
  navigationReference: string;
};

type StoredIntent = {
  expiresAt: number;
  identity: SimulatedExternalIdentity;
  profile: string;
  revoked: boolean;
  target: DeepLinkTarget;
};

export class SimulatedNavigationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SimulatedNavigationError';
  }
}

const identityKey = (identity: SimulatedExternalIdentity): string =>
  [identity.provider, identity.issuer, identity.tenantId, identity.subject].join('\u001f');

/**
 * In-memory stand-in for the management-plane issuer plus the authenticated
 * AionCore resolver seam. It intentionally stores no credentials or message
 * content and makes resolve read-only/replayable until expiry or revocation.
 */
export class SimulatedDeepLinkPlatform {
  private readonly idempotency = new Map<string, { fingerprint: string; result: SimulatedNavigationIntent }>();
  private readonly intents = new Map<string, StoredIntent>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(params: {
    idempotencyKey: string;
    identity: SimulatedExternalIdentity;
    profile: string;
    target: DeepLinkTarget;
    ttlSeconds?: number;
  }): SimulatedNavigationIntent {
    const ttlSeconds = params.ttlSeconds ?? 900;
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(params.profile) ||
      !Number.isInteger(ttlSeconds) ||
      ttlSeconds < 60 ||
      ttlSeconds > 86_400
    ) {
      throw new SimulatedNavigationError('NAVIGATION_INTENT_INVALID');
    }
    const idempotencyKey = `${identityKey(params.identity)}\u001f${params.idempotencyKey}`;
    const fingerprint = JSON.stringify([params.profile, params.target, ttlSeconds]);
    const existing = this.idempotency.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new SimulatedNavigationError('NAVIGATION_IDEMPOTENCY_CONFLICT');
      }
      return existing.result;
    }

    const navigationReference = `nav_${randomUUID().replaceAll('-', '')}`;
    const expiresAt = this.now() + ttlSeconds * 1000;
    const result = {
      expiresAt: new Date(expiresAt).toISOString(),
      link: `aionui://open-conversation?ref=${navigationReference}&v=1&profile=${encodeURIComponent(params.profile)}`,
      navigationReference,
    };
    this.intents.set(navigationReference, {
      expiresAt,
      identity: params.identity,
      profile: params.profile,
      revoked: false,
      target: params.target,
    });
    this.idempotency.set(idempotencyKey, { fingerprint, result });
    return result;
  }

  revoke(navigationReference: string): void {
    const intent = this.intents.get(navigationReference);
    if (intent) intent.revoked = true;
  }

  preview(): { description: string; title: string } {
    return {
      description: '登录 GEA 客户端后查看对应待处理位置',
      title: '在 GEA 客户端中打开',
    };
  }

  resolve(params: {
    identity: SimulatedExternalIdentity;
    navigationReference: string;
    profile: string;
    schemaVersion: number;
  }): DeepLinkResolveResponse {
    if (params.schemaVersion !== 1) throw new SimulatedNavigationError('NAVIGATION_SCHEMA_UNSUPPORTED');
    const intent = this.intents.get(params.navigationReference);
    if (!intent) throw new SimulatedNavigationError('NAVIGATION_REFERENCE_NOT_FOUND');
    if (intent.revoked) throw new SimulatedNavigationError('NAVIGATION_REFERENCE_REVOKED');
    if (this.now() >= intent.expiresAt) throw new SimulatedNavigationError('NAVIGATION_REFERENCE_EXPIRED');
    if (identityKey(intent.identity) !== identityKey(params.identity)) {
      throw new SimulatedNavigationError('NAVIGATION_REFERENCE_FORBIDDEN');
    }
    if (intent.profile !== params.profile) throw new SimulatedNavigationError('DEEP_LINK_PROFILE_MISMATCH');

    return {
      schema_version: 1,
      target: intent.target,
      trace_id: createHash('sha256').update(params.navigationReference).digest('hex').slice(0, 24),
    };
  }
}
