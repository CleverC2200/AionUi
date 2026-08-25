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
      if (method === 'notifications/cancelled') return new Response(null, { status: 202 });
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
        const callArguments = (body?.params as { arguments?: Record<string, unknown> } | undefined)?.arguments;
        if (callArguments?.mode === 'slow') {
          return new Promise<Response>((_resolve, reject) => {
            const abort = () => reject(new DOMException('Aborted', 'AbortError'));
            if (request.signal.aborted) abort();
            else request.signal.addEventListener('abort', abort, { once: true });
          });
        }
        if (callArguments?.mode === 'jsonrpc-error') {
          return jsonResponse({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32000,
              message: 'sensitive upstream message',
              data: {
                auditId: 'audit-error-1',
                businessCode: 'CAPABILITY_RATE_LIMITED',
                category: 'RATE_LIMIT',
                details: { secret: 'must-not-pass' },
                requestId: 'request-error-1',
                retryAfterMs: 1500,
                retryable: true,
                stage: 'ADMISSION',
                suggestedAction: 'RETRY_LATER',
                traceId: 'trace-error-1',
              },
            },
          });
        }
        if (callArguments?.mode === 'unknown-error') {
          return jsonResponse({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32000,
              message: 'sensitive unknown upstream message',
              data: { detail: 'must-not-pass' },
            },
          });
        }
        if (callArguments?.mode === 'tool-error') {
          return jsonResponse({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: 'sensitive partial resource message' }],
              isError: true,
              structuredContent: {
                error: {
                  code: 'MCP_RESOURCE_INCOMPLETE',
                  retryable: false,
                  stage: 'RESOURCE_READ',
                },
              },
            },
          });
        }
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
          deadlineAt: new Date(Date.now() + 60_000).toISOString(),
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
    await expect(
      session.callTool(
        tool!,
        { mode: 'jsonrpc-error' },
        {
          operation: {
            attempt: 1,
            deadlineAt: new Date(Date.now() + 60_000).toISOString(),
            operationId: '22222222-2222-4222-8222-222222222222',
          },
        }
      )
    ).rejects.toMatchObject({
      code: 'CAPABILITY_RATE_LIMITED',
      envelope: {
        auditId: 'audit-error-1',
        category: 'RATE_LIMIT',
        code: 'CAPABILITY_RATE_LIMITED',
        operationId: '22222222-2222-4222-8222-222222222222',
        requestId: 'request-error-1',
        retryAfterMs: 1500,
        retryable: true,
        stage: 'ADMISSION',
        suggestedAction: 'RETRY_LATER',
        traceId: 'trace-error-1',
      },
      message: 'CAPABILITY_RATE_LIMITED',
    });
    await expect(
      session.callTool(
        tool!,
        { mode: 'unknown-error' },
        {
          operation: {
            attempt: 1,
            deadlineAt: new Date(Date.now() + 60_000).toISOString(),
            operationId: '77777777-7777-4777-8777-777777777777',
          },
        }
      )
    ).rejects.toMatchObject({
      code: 'GEA_MCP_CALL_FAILED',
      envelope: {
        code: 'GEA_MCP_CALL_FAILED',
        operationId: '77777777-7777-4777-8777-777777777777',
        retryable: false,
      },
      message: 'GEA_MCP_CALL_FAILED',
    });
    const toolError = await session.callTool(
      tool!,
      { mode: 'tool-error' },
      {
        operation: {
          attempt: 1,
          deadlineAt: new Date(Date.now() + 60_000).toISOString(),
          operationId: '33333333-3333-4333-8333-333333333333',
        },
      }
    );
    expect(toolError.error).toEqual({
      code: 'MCP_RESOURCE_INCOMPLETE',
      operationId: '33333333-3333-4333-8333-333333333333',
      retryable: false,
      stage: 'RESOURCE_READ',
    });
    expect(JSON.stringify(toolError.error)).not.toContain('sensitive');
    await expect(
      session.callTool(
        tool!,
        { mode: 'slow' },
        {
          operation: {
            attempt: 1,
            deadlineAt: new Date(Date.now() + 25).toISOString(),
            operationId: '55555555-5555-4555-8555-555555555555',
          },
        }
      )
    ).rejects.toMatchObject({ code: 'MCP_UPSTREAM_TIMEOUT', message: 'MCP_UPSTREAM_TIMEOUT' });
    await vi.waitFor(() => {
      expect(requests.some((request) => request.body?.method === 'notifications/cancelled')).toBe(true);
    });
    const controller = new AbortController();
    const cancelled = session.callTool(
      tool!,
      { mode: 'slow' },
      {
        operation: {
          attempt: 1,
          deadlineAt: new Date(Date.now() + 60_000).toISOString(),
          operationId: '66666666-6666-4666-8666-666666666666',
        },
        signal: controller.signal,
      }
    );
    await vi.waitFor(() => {
      const slowCalls = requests.filter(
        (request) =>
          request.body?.method === 'tools/call' &&
          (request.body.params as { arguments?: { mode?: unknown } } | undefined)?.arguments?.mode === 'slow'
      );
      expect(slowCalls).toHaveLength(2);
    });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'MCP_REQUEST_CANCELLED', message: 'MCP_REQUEST_CANCELLED' });
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
        deadlineAt: expect.any(String),
        mcpCode: 'cube',
        operationId: '11111111-1111-4111-8111-111111111111',
        parentRequestId: 'parent-1',
        sessionId: 'gea-session-1',
      },
    });
  });
});
