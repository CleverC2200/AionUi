/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type HttpCall = { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; body?: unknown };

const httpBridgeMocks = vi.hoisted(() => {
  const calls: HttpCall[] = [];
  const provider =
    (method: HttpCall['method']) =>
    <Data, Params = undefined>(path: string | ((params: Params) => string), mapBody?: (params: Params) => unknown) => ({
      provider: vi.fn(),
      invoke: vi.fn(async (params?: Params) => {
        calls.push({
          method,
          path: typeof path === 'function' ? path(params as Params) : path,
          body: mapBody && params !== undefined ? mapBody(params as Params) : undefined,
        });
        return {} as Data;
      }),
    });
  const emitter = () => ({ on: vi.fn(() => vi.fn()), emit: vi.fn() });
  return {
    calls,
    httpGet: provider('GET'),
    httpPost: provider('POST'),
    httpPut: provider('PUT'),
    httpPatch: provider('PATCH'),
    httpDelete: provider('DELETE'),
    httpRequest: vi.fn(),
    stubProvider: vi.fn((_name: string, defaultValue: unknown) => ({
      provider: vi.fn(),
      invoke: vi.fn(async () => defaultValue),
    })),
    withResponseMap: vi.fn(
      (
        inner: { provider: unknown; invoke: (params?: unknown) => Promise<unknown> },
        map: (raw: unknown) => unknown
      ) => ({
        provider: inner.provider,
        invoke: vi.fn(async (params?: unknown) => map(await inner.invoke(params))),
      })
    ),
    wsEmitter: vi.fn(emitter),
    wsMappedEmitter: vi.fn(emitter),
    stubEmitter: vi.fn(emitter),
  };
});

vi.mock('@/common/adapter/httpBridge', () => httpBridgeMocks);
vi.mock('@/common/platform/bridge', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({ provider: vi.fn(), invoke: vi.fn() })),
    buildEmitter: vi.fn(() => ({ on: vi.fn(() => vi.fn()), emit: vi.fn() })),
  },
}));

describe('ipcBridge assistant adapter', () => {
  beforeEach(() => {
    httpBridgeMocks.calls.length = 0;
  });

  it('posts managed extensions without duplicating the route assistant id in the body', async () => {
    const { assistants } = await import('@/common/adapter/ipcBridge');
    await assistants.saveExtensions.invoke({
      assistant_id: 'finance assistant/1',
      assignment_id: 'assignment-1',
      template_version: '1.0.0',
      expected_revision: 'catalog-r1',
      idempotency_key: 'request-1',
      skills: ['spreadsheet-helper'],
      mcps: ['local-files-readonly'],
    });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/assistants/finance%20assistant%2F1/extensions',
      body: {
        assignment_id: 'assignment-1',
        template_version: '1.0.0',
        expected_revision: 'catalog-r1',
        idempotency_key: 'request-1',
        skills: ['spreadsheet-helper'],
        mcps: ['local-files-readonly'],
      },
    });
  });
});
