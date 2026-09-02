import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CORE_BOOTSTRAP_HEADER,
  MAX_SALES_PLAN_SUBMIT_BODY_BYTES,
  SALES_PLAN_SUBMIT_PATH,
  TRUSTED_CORE_SCHEME,
  TRUSTED_SALES_PLAN_SUBMIT_URL,
  forwardTrustedSalesPlanSubmit,
  initializeCoreSessionBootstrap,
  isTrustedSalesPlanSubmitRequest,
  registerTrustedSalesPlanScheme,
  type TrustedSalesPlanRequest,
} from '@/process/startup/coreSessionBootstrap';

describe('core session bootstrap startup order', () => {
  const previousSecret = process.env.AIONCORE_BOOTSTRAP_SECRET;

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.AIONCORE_BOOTSTRAP_SECRET;
    else process.env.AIONCORE_BOOTSTRAP_SECRET = previousSecret;
  });

  it('does not consume the ambient secret merely by importing the sequencing module', async () => {
    vi.resetModules();
    process.env.AIONCORE_BOOTSTRAP_SECRET = 'still-ambient';

    await import('@/process/startup/coreSessionBootstrap');

    expect(process.env.AIONCORE_BOOTSTRAP_SECRET).toBe('still-ambient');
  });

  it('consumes the ambient secret before PATH initialization can spawn a child', () => {
    process.env.AIONCORE_BOOTSTRAP_SECRET = 'server-only-secret';
    let childValue = '';

    const result = initializeCoreSessionBootstrap(() => {
      expect(process.env.AIONCORE_BOOTSTRAP_SECRET).toBeUndefined();
      childValue = execFileSync(
        process.execPath,
        ['-e', 'process.stdout.write(process.env.AIONCORE_BOOTSTRAP_SECRET ?? "missing")'],
        { encoding: 'utf8', env: process.env }
      );
      return 'initialized';
    });

    expect(result).toEqual({ bootstrapSecret: 'server-only-secret', initialized: 'initialized' });
    expect(childValue).toBe('missing');
  });
});

describe('trusted sales-plan submit transport', () => {
  const mainWebContentsId = 17;
  const request: TrustedSalesPlanRequest = {
    method: 'POST',
    url: TRUSTED_SALES_PLAN_SUBMIT_URL,
    resourceType: 'xhr',
    webContentsId: mainWebContentsId,
    isMainWebContents: true,
    isMainFrame: true,
  };

  it('registers a standard secure fetch-capable scheme without enabling CORS', () => {
    const registerSchemesAsPrivileged = vi.fn();

    registerTrustedSalesPlanScheme({ registerSchemesAsPrivileged });

    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: TRUSTED_CORE_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
      },
    ]);
  });

  it.each([
    ['wrong method', { method: 'GET' }],
    ['wrong host', { url: `aionui-core://untrusted${SALES_PLAN_SUBMIT_PATH}` }],
    ['query suffix', { url: `${TRUSTED_SALES_PLAN_SUBMIT_URL}?retry=1` }],
    ['wrong path', { url: 'aionui-core://trusted/api/gea/sales-plan/plans' }],
    ['subframe', { isMainFrame: false }],
    ['different WebContents object', { isMainWebContents: false }],
    ['different window id', { webContentsId: mainWebContentsId + 1 }],
    ['non-fetch resource', { resourceType: 'mainFrame' }],
  ])('rejects %s', (_label, override) => {
    const candidate = { ...request, ...override };

    expect(isTrustedSalesPlanSubmitRequest(candidate, mainWebContentsId)).toBe(false);
  });

  it('rebuilds the Main request from allowed headers and never forwards a forged capability', async () => {
    const fetchFromMain = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const rendererRequest = new Request(TRUSTED_SALES_PLAN_SUBMIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idempotency-1',
        'X-Request-Id': 'request-1',
        [CORE_BOOTSTRAP_HEADER]: 'renderer-forged',
        Authorization: 'renderer-forged',
      },
      body: JSON.stringify({ periodId: '9007199254740993' }),
    });

    await expect(
      forwardTrustedSalesPlanSubmit({
        request: rendererRequest,
        backendPort: 43123,
        bootstrapSecret: 'main-held-secret',
        fetchFromMain,
      })
    ).resolves.toHaveProperty('status', 200);

    expect(fetchFromMain).toHaveBeenCalledWith(`http://127.0.0.1:43123${SALES_PLAN_SUBMIT_PATH}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idempotency-1',
        'X-Request-Id': 'request-1',
        [CORE_BOOTSTRAP_HEADER]: 'main-held-secret',
      },
      body: expect.any(Uint8Array),
    });
    const forwardedHeaders = fetchFromMain.mock.calls[0][1].headers as Record<string, string>;
    expect(Object.values(forwardedHeaders)).not.toContain('renderer-forged');
  });

  it.each([
    ['wrong method', new Request(TRUSTED_SALES_PLAN_SUBMIT_URL)],
    [
      'wrong URL',
      new Request(`${TRUSTED_SALES_PLAN_SUBMIT_URL}?retry=1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idempotency-1',
          'X-Request-Id': 'request-1',
        },
        body: '{}',
      }),
    ],
  ])('does not forward a protocol request with %s', async (_label, invalidRequest) => {
    const fetchFromMain = vi.fn();
    const response = await forwardTrustedSalesPlanSubmit({
      request: invalidRequest,
      backendPort: 43123,
      bootstrapSecret: 'main-held-secret',
      fetchFromMain,
    });

    expect(response.status).toBe(404);
    expect(fetchFromMain).not.toHaveBeenCalled();
  });

  it('rejects an oversized body before Main networking', async () => {
    const fetchFromMain = vi.fn();
    const response = await forwardTrustedSalesPlanSubmit({
      request: new Request(TRUSTED_SALES_PLAN_SUBMIT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idempotency-1',
          'X-Request-Id': 'request-1',
        },
        body: JSON.stringify({ value: 'x'.repeat(MAX_SALES_PLAN_SUBMIT_BODY_BYTES) }),
      }),
      backendPort: 43123,
      bootstrapSecret: 'main-held-secret',
      fetchFromMain,
    });

    expect(response.status).toBe(413);
    expect(fetchFromMain).not.toHaveBeenCalled();
  });
});
