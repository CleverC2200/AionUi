import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { GeaLarkAuthService } from '../../src/gea-lark-auth.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

describe('GeaLarkAuthService MCP Resources', () => {
  it('uses Streamable HTTP and keeps resource contents behind resources/read', async () => {
    const uri = 'data-artifact://gateway/artifact-1';
    const text = '{"rows":[1]}';
    const sha256 = createHash('sha256').update(text).digest('hex');
    const requests: Array<{ body?: Record<string, unknown>; headers: Headers; method: string; path: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const body = request.method === 'POST' ? ((await request.json()) as Record<string, unknown>) : undefined;
      requests.push({ body, headers: request.headers, method: request.method, path: url.pathname });

      if (url.pathname.endsWith('/sys/user/getUserInfo')) {
        return jsonResponse({
          success: true,
          result: { userInfo: { id: 'user-1', username: 'tester', tenantId: '1' } },
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
              protocolVersion: '2025-11-25',
              capabilities: { resources: {}, tools: {} },
              serverInfo: { name: 'gea-mcp-proxy', version: '1.0' },
            },
          },
          {
            headers: {
              'mcp-protocol-version': '2025-11-25',
              'mcp-session-id': 'mcp-session-1',
            },
          }
        );
      }
      if (method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (method === 'tools/list') {
        return jsonResponse({
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'query_business_data',
                inputSchema: { type: 'object' },
                _meta: { mcpCode: 'cube' },
              },
            ],
          },
        });
      }
      if (method === 'tools/call') {
        return jsonResponse({
          jsonrpc: '2.0',
          id,
          result: {
            _meta: {
              auditId: 'audit-1',
              operationId: '11111111-1111-4111-8111-111111111111',
              requestId: 'request-1',
              secret: 'must-not-pass',
              traceId: 'trace-1',
            },
            content: [
              {
                type: 'resource_link',
                uri,
                name: 'query-result',
                mimeType: 'application/json',
                size: text.length,
                _meta: {
                  sha256,
                  expiresAt: '2026-08-25T18:00:00+08:00',
                  oss_url: 'https://private.example/signed-secret',
                },
              },
            ],
            isError: false,
          },
        });
      }
      if (method === 'resources/list') {
        return jsonResponse({
          jsonrpc: '2.0',
          id,
          result: {
            resources: [
              {
                uri,
                name: 'query-result',
                mimeType: 'application/json',
                size: text.length,
                _meta: { sha256, expiresAt: '2026-08-25T18:00:00+08:00' },
              },
            ],
          },
        });
      }
      if (method === 'resources/templates/list') {
        return jsonResponse({
          jsonrpc: '2.0',
          id,
          result: {
            resourceTemplates: [
              {
                uriTemplate: 'data-artifact://gateway/{artifactId}',
                name: 'gateway-data-artifact',
                mimeType: 'application/json',
              },
            ],
          },
        });
      }
      if (method === 'resources/read') {
        return jsonResponse({
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text,
                _meta: { sha256, expiresAt: '2026-08-25T18:00:00+08:00' },
              },
            ],
          },
        });
      }
      return new Response(null, { status: 404 });
    });
    const service = new GeaLarkAuthService({
      allowLoopbackHttp: true,
      baseUrl: 'http://127.0.0.1:43123/gea-boot',
      fetchImpl: fetchImpl as typeof fetch,
      sessionStore: {
        clear: vi.fn(),
        load: vi.fn().mockResolvedValue({ accessToken: 'access-token' }),
        save: vi.fn(),
      },
    });
    await service.initializeSession();

    const session = await service.createMcpGatewaySession('sales_forecast');
    const [tool] = await session.listTools();
    expect(tool).toMatchObject({ name: 'query_business_data', sourceCode: 'cube' });
    const called = await session.callTool(
      tool!,
      { queries: [] },
      {
        operation: {
          attempt: 2,
          deadlineAt: '2026-08-25T15:00:00.000Z',
          operationId: '11111111-1111-4111-8111-111111111111',
          parentRequestId: 'parent-1',
        },
      }
    );
    expect(called.content).toEqual([expect.objectContaining({ type: 'resource_link', uri })]);
    expect(called.meta).toEqual({
      auditId: 'audit-1',
      operationId: '11111111-1111-4111-8111-111111111111',
      requestId: 'request-1',
      traceId: 'trace-1',
    });
    await expect(session.listResources()).resolves.toMatchObject({ resources: [{ uri }] });
    await expect(session.listResourceTemplates()).resolves.toMatchObject({
      resourceTemplates: [{ uriTemplate: 'data-artifact://gateway/{artifactId}' }],
    });
    await expect(session.readResource(uri)).resolves.toEqual([expect.objectContaining({ uri, text })]);
    await session.close();

    const initialized = requests.find((request) => request.body?.method === 'notifications/initialized');
    expect(initialized?.headers.get('mcp-session-id')).toBe('mcp-session-1');
    expect(initialized?.headers.get('mcp-protocol-version')).toBe('2025-11-25');
    const toolCall = requests.find((request) => request.body?.method === 'tools/call');
    expect(toolCall?.body?.params).toMatchObject({
      arguments: { queries: [] },
      _meta: {
        delegationToken: 'delegation-secret',
        attempt: 2,
        deadlineAt: '2026-08-25T15:00:00.000Z',
        mcpCode: 'cube',
        operationId: '11111111-1111-4111-8111-111111111111',
        parentRequestId: 'parent-1',
        sessionId: 'gea-session-1',
      },
    });
  });
});
