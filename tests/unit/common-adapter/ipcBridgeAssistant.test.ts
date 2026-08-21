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

  it('routes configuration preparation through AionCore', async () => {
    const { conversation } = await import('@/common/adapter/ipcBridge');
    await conversation.prepareConfiguration.invoke({
      assistant: {
        id: 'enterprise-finance',
        source: 'managed',
        assignment_id: 'assignment-finance',
        template_version: '1.0.0',
        catalog_revision: 'catalog-r1',
        extension_revision: 'extension-r1',
      },
      locale: 'zh-CN',
      idempotency_key: 'prepare-1',
      workspace: '/workspace',
      overrides: { skill_ids: ['finance-close'], mcp_ids: ['finance-production'] },
    });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/conversations/prepare',
      body: undefined,
    });
  });

  it('submits an interaction action without duplicating the request id in the body', async () => {
    const { interactionRequest } = await import('@/common/adapter/ipcBridge');
    await interactionRequest.act.invoke({
      request_id: 'request/1',
      expected_version: 'v1',
      idempotency_key: 'interaction:request/1:v1:approve',
      action_id: 'approve',
    });

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'POST',
      path: '/api/interaction-requests/request%2F1/actions',
      body: {
        expected_version: 'v1',
        idempotency_key: 'interaction:request/1:v1:approve',
        action_id: 'approve',
      },
    });
  });

  it('loads pending interaction requests from the AionCore contract route', async () => {
    const { interactionRequest } = await import('@/common/adapter/ipcBridge');
    await interactionRequest.list.invoke().catch(() => undefined);

    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'GET',
      path: '/api/interaction-requests?status=pending',
      body: undefined,
    });
  });

  it('loads structured conversation records from AionCore', async () => {
    const { conversationRecords } = await import('@/common/adapter/ipcBridge');
    await expect(conversationRecords.get.invoke({ conversation_id: 'conversation/1' })).rejects.toThrow(
      'CONVERSATION_RECORD_INVALID'
    );
    expect(httpBridgeMocks.calls).toContainEqual({
      method: 'GET',
      path: '/api/conversations/conversation%2F1/records',
      body: undefined,
    });
  });
});
