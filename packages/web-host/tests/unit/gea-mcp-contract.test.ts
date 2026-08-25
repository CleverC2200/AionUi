import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeaLarkAuthService } from '../../src/gea-lark-auth.js';
import { startGeaMcpBridge, type GeaMcpBridgeHandle } from '../../src/gea-mcp-bridge.js';

type RecordedRequest = {
  body?: Record<string, unknown>;
  method: string;
  path: string;
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

function createMockGea() {
  const requests: RecordedRequest[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === 'POST' ? ((await request.json()) as Record<string, unknown>) : undefined;
    requests.push({ body, method: request.method, path: url.pathname });

    if (url.pathname.endsWith('/sys/user/getUserInfo')) {
      return jsonResponse({
        success: true,
        result: { userInfo: { id: 'user-1', tenantId: '1', username: 'tester' } },
      });
    }
    if (url.pathname.endsWith('/ai/gateway/session')) {
      return jsonResponse({
        success: true,
        result: {
          accessDecision: { allowed: true },
          delegationToken: 'delegation-secret',
          gatewayContext: {
            consumerCode: 'sales_forecast',
            conversationId: 'conversation-1',
            sessionId: 'gea-session-1',
          },
        },
      });
    }
    if (!url.pathname.endsWith('/ai/gateway/mcp/proxy/mcp')) return new Response(null, { status: 404 });
    if (request.method === 'DELETE') return new Response(null, { status: 204 });

    const method = body?.method;
    const id = body?.id;
    if (method === 'initialize') {
      return jsonResponse(
        {
          jsonrpc: '2.0',
          id,
          result: {
            capabilities: { resources: {}, tools: {} },
            protocolVersion: '2025-11-25',
            serverInfo: { name: 'mock-gea', version: '1.0.0' },
          },
        },
        { headers: { 'mcp-protocol-version': '2025-11-25', 'mcp-session-id': 'upstream-session-1' } }
      );
    }
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      return new Response(null, { status: 202 });
    }
    if (method === 'tools/list') {
      return jsonResponse({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'query_business_data',
              inputSchema: { type: 'object', additionalProperties: true },
              _meta: { mcpCode: 'cube' },
            },
          ],
        },
      });
    }
    if (method !== 'tools/call') return new Response(null, { status: 404 });

    const argumentsValue = (body.params as { arguments?: Record<string, unknown> } | undefined)?.arguments;
    switch (argumentsValue?.mode) {
      case 'rate-limit':
        return jsonResponse({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: 'sensitive rate-limit detail',
            data: {
              businessCode: 'CAPABILITY_RATE_LIMITED',
              category: 'RATE_LIMIT',
              requestId: 'request-rate-1',
              retryAfterMs: 1200,
              retryable: true,
              stage: 'ADMISSION',
              traceId: 'trace-rate-1',
            },
          },
        });
      case 'incomplete-resource':
        return jsonResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: 'sensitive second-page detail' }],
            isError: true,
            structuredContent: {
              error: { code: 'MCP_RESOURCE_INCOMPLETE', retryable: false, stage: 'RESOURCE_READ' },
            },
          },
        });
      case 'slow':
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (request.signal.aborted) abort();
          else request.signal.addEventListener('abort', abort, { once: true });
        });
      case 'legacy':
        return jsonResponse({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: '{"legacy":true}' }], isError: false },
        });
      default:
        return jsonResponse({
          jsonrpc: '2.0',
          id,
          result: {
            _meta: {
              auditId: 'audit-success-1',
              operationId: '11111111-1111-4111-8111-111111111111',
              requestId: 'request-success-1',
              signedUrl: 'https://private.example/signed-secret',
              traceId: 'trace-success-1',
            },
            content: [{ type: 'text', text: '{"ok":true}' }],
            isError: false,
          },
        });
    }
  });
  return { fetchImpl: fetchImpl as typeof fetch, requests };
}

describe('GEA MCP client contract', () => {
  let client: Client | undefined;
  let handle: GeaMcpBridgeHandle | undefined;

  afterEach(async () => {
    await client?.close().catch((): undefined => undefined);
    await handle?.close();
    client = undefined;
    handle = undefined;
  });

  it('preserves new and legacy contracts, failures, and cancellation across both MCP hops', async () => {
    const mockGea = createMockGea();
    const service = new GeaLarkAuthService({
      allowLoopbackHttp: true,
      baseUrl: 'http://127.0.0.1:43123/gea-boot',
      fetchImpl: mockGea.fetchImpl,
      sessionStore: {
        clear: vi.fn(),
        load: vi.fn().mockResolvedValue({ accessToken: 'access-token' }),
        save: vi.fn(),
      },
    });
    await service.initializeSession();
    handle = await startGeaMcpBridge(service, 'sales_forecast');
    client = new Client({ name: 'contract-test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));
    await client.listTools();

    const operationId = '11111111-1111-4111-8111-111111111111';
    const success = await client.callTool({
      name: 'query_business_data',
      arguments: { mode: 'success', query: { measures: ['Cube.count'] } },
      _meta: { attempt: 2, operationId, parentRequestId: 'parent-1' },
    });
    expect(success).toEqual({
      content: [{ type: 'text', text: '{"ok":true}' }],
      isError: false,
      _meta: {
        auditId: 'audit-success-1',
        operationId,
        requestId: 'request-success-1',
        traceId: 'trace-success-1',
      },
    });
    const upstreamSuccess = mockGea.requests.find(
      (request) =>
        request.body?.method === 'tools/call' &&
        (request.body.params as { arguments?: { mode?: unknown } } | undefined)?.arguments?.mode === 'success'
    );
    expect(upstreamSuccess?.body?.params).toMatchObject({
      arguments: { mode: 'success', query: { measures: ['Cube.count'] } },
      _meta: { attempt: 2, operationId, parentRequestId: 'parent-1' },
    });

    const legacyOperationId = '22222222-2222-4222-8222-222222222222';
    const legacy = await client.callTool({
      name: 'query_business_data',
      arguments: { mode: 'legacy' },
      _meta: { operationId: legacyOperationId },
    });
    expect(legacy).toEqual({
      content: [{ type: 'text', text: '{"legacy":true}' }],
      isError: false,
      _meta: { operationId: legacyOperationId },
    });

    const limited = await client.callTool({
      name: 'query_business_data',
      arguments: { mode: 'rate-limit' },
      _meta: { operationId },
    });
    expect(limited).toMatchObject({
      content: [{ type: 'text', text: 'CAPABILITY_RATE_LIMITED' }],
      isError: true,
      structuredContent: {
        error: { code: 'CAPABILITY_RATE_LIMITED', operationId, retryAfterMs: 1200, retryable: true },
      },
    });

    const incomplete = await client.callTool({
      name: 'query_business_data',
      arguments: { mode: 'incomplete-resource' },
      _meta: { operationId },
    });
    expect(incomplete).toMatchObject({
      content: [{ type: 'text', text: 'MCP_RESOURCE_INCOMPLETE' }],
      isError: true,
      structuredContent: {
        error: { code: 'MCP_RESOURCE_INCOMPLETE', operationId, retryable: false, stage: 'RESOURCE_READ' },
      },
    });
    expect(JSON.stringify(incomplete)).not.toContain('resource_link');

    const controller = new AbortController();
    const slow = client.callTool(
      { name: 'query_business_data', arguments: { mode: 'slow' }, _meta: { operationId } },
      undefined,
      { signal: controller.signal }
    );
    await vi.waitFor(() => {
      expect(
        mockGea.requests.some(
          (request) =>
            request.body?.method === 'tools/call' &&
            (request.body.params as { arguments?: { mode?: unknown } } | undefined)?.arguments?.mode === 'slow'
        )
      ).toBe(true);
    });
    const fast = client.callTool({ name: 'query_business_data', arguments: { mode: 'fast' } });
    controller.abort();
    await expect(slow).rejects.toBeDefined();
    await expect(fast).resolves.toMatchObject({ content: [{ type: 'text', text: '{"ok":true}' }] });
    await vi.waitFor(() => {
      expect(mockGea.requests.some((request) => request.body?.method === 'notifications/cancelled')).toBe(true);
    });
    const callCount = mockGea.requests.filter((request) => request.body?.method === 'tools/call').length;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(mockGea.requests.filter((request) => request.body?.method === 'tools/call')).toHaveLength(callCount);

    const outputs = JSON.stringify([success, legacy, limited, incomplete]);
    expect(outputs).not.toContain('delegation-secret');
    expect(outputs).not.toContain('sensitive');
    expect(outputs).not.toContain('signed-secret');
  });
});
