import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeaMcpGatewayError, type GeaLarkAuthService } from '../../src/gea-lark-auth.js';
import { startGeaMcpBridge, type GeaMcpBridgeHandle } from '../../src/gea-mcp-bridge.js';

describe('startGeaMcpBridge', () => {
  let handle: GeaMcpBridgeHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it('exposes authorized GEA tools through Streamable HTTP', async () => {
    const listTools = vi.fn().mockResolvedValue([
      {
        name: 'search_records',
        description: '搜索记录',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        sourceCode: 'mcp-001',
      },
    ]);
    const operationId = '11111111-1111-4111-8111-111111111111';
    const callTool = vi.fn().mockResolvedValue({
      result: '{"data":[]}',
      meta: { auditId: 'audit-1', operationId, requestId: 'request-1' },
    });
    const authService = {
      createMcpGatewaySession: vi.fn().mockResolvedValue({ listTools, callTool }),
    } as unknown as GeaLarkAuthService;
    handle = await startGeaMcpBridge(authService, 'sales_forecast');

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));

    await expect(client.listTools()).resolves.toMatchObject({
      tools: [{ name: 'search_records', description: '搜索记录' }],
    });
    const requestedDeadline = new Date(Date.now() + 5 * 60_000).toISOString();
    const startedAt = Date.now();
    await expect(
      client.callTool({
        name: 'search_records',
        arguments: { query: '客户A' },
        _meta: { attempt: 2, deadlineAt: requestedDeadline, operationId, parentRequestId: 'parent-1' },
      })
    ).resolves.toEqual({
      content: [{ type: 'text', text: '{"data":[]}' }],
      _meta: { auditId: 'audit-1', operationId, requestId: 'request-1' },
    });
    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({ sourceCode: 'mcp-001' }),
      { query: '客户A' },
      expect.objectContaining({
        operation: expect.objectContaining({ attempt: 2, operationId, parentRequestId: 'parent-1' }),
        signal: expect.anything(),
      })
    );
    const options = callTool.mock.calls[0]?.[2];
    expect(Date.parse(options.operation.deadlineAt)).toBeGreaterThanOrEqual(startedAt);
    expect(Date.parse(options.operation.deadlineAt)).toBeLessThanOrEqual(startedAt + 60_500);

    await client.callTool({
      name: 'search_records',
      arguments: { query: '客户B' },
      _meta: { attempt: 0, deadlineAt: 'invalid', operationId: 'invalid', parentRequestId: 'invalid parent' },
    });
    const fallbackOperation = callTool.mock.calls[1]?.[2].operation;
    expect(fallbackOperation).toMatchObject({ attempt: 1, deadlineAt: expect.any(String) });
    expect(fallbackOperation.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(fallbackOperation).not.toHaveProperty('parentRequestId');

    await client.close();
  });

  it('exposes a structured schema for the legacy business-data tool and serializes named queries', async () => {
    const legacyTool = {
      name: 'query_business_data',
      description: '查询业务数据',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          queries: { type: 'string' },
        },
        required: ['action', 'queries'],
      },
      sourceCode: 'mcp-business-data',
    };
    const callTool = vi.fn().mockResolvedValue({ result: '{"data":[]}' });
    const authService = {
      createMcpGatewaySession: vi.fn().mockResolvedValue({
        listTools: vi.fn().mockResolvedValue([legacyTool]),
        callTool,
      }),
    } as unknown as GeaLarkAuthService;
    handle = await startGeaMcpBridge(authService, 'sales_forecast');

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));

    const listed = await client.listTools();
    expect(listed.tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['inspect', 'query'] },
        queries: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'query'],
            properties: {
              name: { type: 'string' },
              query: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
      required: ['action', 'queries'],
    });

    const queries = [
      {
        name: 'sales_forecast_probe',
        query: {
          measures: ['agents_sales_forecast_detail.row_count'],
          limit: 1,
          timezone: 'Asia/Shanghai',
        },
      },
    ];
    await client.callTool({ name: 'query_business_data', arguments: { action: 'query', queries } });

    expect(callTool).toHaveBeenCalledWith(
      legacyTool,
      {
        action: 'query',
        queries: JSON.stringify(queries),
      },
      expect.objectContaining({ operation: expect.any(Object) })
    );
    await client.close();
  });

  it('preserves a modern business-data schema and native query arrays', async () => {
    const modernSchema = {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['inspect', 'query'] },
        queries: { type: 'array', items: { type: 'object' } },
      },
      required: ['action', 'queries'],
    };
    const modernTool = {
      name: 'query_business_data',
      inputSchema: modernSchema,
      sourceCode: 'mcp-business-data',
    };
    const callTool = vi.fn().mockResolvedValue({ result: '{"data":[]}' });
    const authService = {
      createMcpGatewaySession: vi.fn().mockResolvedValue({
        listTools: vi.fn().mockResolvedValue([modernTool]),
        callTool,
      }),
    } as unknown as GeaLarkAuthService;
    handle = await startGeaMcpBridge(authService, 'sales_forecast');

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));

    await expect(client.listTools()).resolves.toMatchObject({ tools: [{ inputSchema: modernSchema }] });
    const queries = [{ name: 'probe', query: { measures: ['Cube.count'] } }];
    await client.callTool({ name: 'query_business_data', arguments: { action: 'query', queries } });

    expect(callTool).toHaveBeenCalledWith(
      modernTool,
      { action: 'query', queries },
      expect.objectContaining({ operation: expect.any(Object) })
    );
    await client.close();
  });

  it('exposes OpenAI-compatible aliases and calls the original GEA tool', async () => {
    const dottedTool = {
      name: 'gateway.session.currentUser.resolve',
      description: '解析当前用户',
      inputSchema: { type: 'object', properties: {} },
      sourceCode: 'mcp-current-user',
    };
    const callTool = vi.fn().mockResolvedValue({ result: '{"id":"user-1"}' });
    const authService = {
      createMcpGatewaySession: vi.fn().mockResolvedValue({
        listTools: vi.fn().mockResolvedValue([dottedTool]),
        callTool,
      }),
    } as unknown as GeaLarkAuthService;
    handle = await startGeaMcpBridge(authService, 'sales_forecast');

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));

    await expect(client.listTools()).resolves.toMatchObject({
      tools: [{ name: 'gateway_session_currentUser_resolve' }],
    });
    await expect(client.callTool({ name: 'gateway_session_currentUser_resolve', arguments: {} })).resolves.toEqual({
      content: [{ type: 'text', text: '{"id":"user-1"}' }],
    });
    expect(callTool).toHaveBeenCalledWith(dottedTool, {}, expect.objectContaining({ operation: expect.any(Object) }));

    await client.close();
  });

  it('preserves resource links and removes signed storage URLs', async () => {
    const uri = 'data-artifact://gateway/artifact-1';
    const resource = {
      uri,
      name: 'query-result',
      mimeType: 'application/json',
      size: 12,
      _meta: {
        sha256: 'a'.repeat(64),
        expiresAt: '2026-08-25T18:00:00+08:00',
        oss_url: 'https://private.example/signed-secret',
      },
    };
    const authService = {
      createMcpGatewaySession: vi.fn().mockResolvedValue({
        listTools: vi.fn().mockResolvedValue([
          {
            name: 'query_business_data',
            inputSchema: { type: 'object' },
            sourceCode: 'mcp-business-data',
          },
        ]),
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: 'resource_link', ...resource }],
          isError: false,
        }),
        listResources: vi.fn().mockResolvedValue({ resources: [resource] }),
        listResourceTemplates: vi.fn().mockResolvedValue({
          resourceTemplates: [
            {
              uriTemplate: 'data-artifact://gateway/{artifactId}',
              name: 'gateway-data-artifact',
              mimeType: 'application/json',
              _meta: { oss_url: 'https://private.example/signed-secret' },
            },
          ],
        }),
        readResource: vi.fn().mockResolvedValue([
          {
            uri,
            mimeType: 'application/json',
            text: '{"rows":[1]}',
            _meta: resource._meta,
          },
        ]),
      }),
    } as unknown as GeaLarkAuthService;
    handle = await startGeaMcpBridge(authService, 'sales_forecast');

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));

    const called = await client.callTool({ name: 'query_business_data', arguments: {} });
    expect(called.content).toEqual([
      expect.objectContaining({
        type: 'resource_link',
        uri,
        _meta: {
          sha256: 'a'.repeat(64),
          expiresAt: '2026-08-25T18:00:00+08:00',
        },
      }),
    ]);
    expect(JSON.stringify(called)).not.toContain('oss_url');

    const listed = await client.listResources();
    expect(JSON.stringify(listed)).not.toContain('oss_url');
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates).toEqual([
      expect.objectContaining({ uriTemplate: 'data-artifact://gateway/{artifactId}' }),
    ]);
    expect(JSON.stringify(templates)).not.toContain('oss_url');
    const read = await client.readResource({ uri });
    expect(read.contents[0]).toMatchObject({ uri, text: '{"rows":[1]}' });
    expect(JSON.stringify(read)).not.toContain('oss_url');

    await client.close();
  });

  it('returns structured GEA failures without exposing upstream messages', async () => {
    const operationId = '44444444-4444-4444-8444-444444444444';
    const callTool = vi
      .fn()
      .mockRejectedValueOnce(
        new GeaMcpGatewayError({
          auditId: 'audit-error-1',
          category: 'RATE_LIMIT',
          code: 'CAPABILITY_RATE_LIMITED',
          operationId,
          requestId: 'request-error-1',
          retryAfterMs: 2500,
          retryable: true,
          stage: 'ADMISSION',
          traceId: 'trace-error-1',
        })
      )
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'sensitive partial resource message' }],
        error: { code: 'MCP_RESOURCE_INCOMPLETE', operationId, retryable: false, stage: 'RESOURCE_READ' },
        isError: true,
      });
    const authService = {
      createMcpGatewaySession: vi.fn().mockResolvedValue({
        listTools: vi.fn().mockResolvedValue([
          {
            name: 'query_business_data',
            inputSchema: { type: 'object' },
            sourceCode: 'mcp-business-data',
          },
        ]),
        callTool,
      }),
    } as unknown as GeaLarkAuthService;
    handle = await startGeaMcpBridge(authService, 'sales_forecast');

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));

    const limited = await client.callTool({
      name: 'query_business_data',
      arguments: {},
      _meta: { operationId },
    });
    expect(limited).toEqual({
      content: [{ type: 'text', text: 'CAPABILITY_RATE_LIMITED' }],
      isError: true,
      structuredContent: {
        error: {
          auditId: 'audit-error-1',
          category: 'RATE_LIMIT',
          code: 'CAPABILITY_RATE_LIMITED',
          operationId,
          requestId: 'request-error-1',
          retryAfterMs: 2500,
          retryable: true,
          stage: 'ADMISSION',
          traceId: 'trace-error-1',
        },
      },
      _meta: {
        auditId: 'audit-error-1',
        operationId,
        requestId: 'request-error-1',
        traceId: 'trace-error-1',
      },
    });
    const incomplete = await client.callTool({
      name: 'query_business_data',
      arguments: {},
      _meta: { operationId },
    });
    expect(incomplete).toMatchObject({
      content: [{ type: 'text', text: 'MCP_RESOURCE_INCOMPLETE' }],
      isError: true,
      structuredContent: {
        error: { code: 'MCP_RESOURCE_INCOMPLETE', operationId, retryable: false, stage: 'RESOURCE_READ' },
      },
    });
    expect(JSON.stringify([limited, incomplete])).not.toContain('sensitive');

    await client.close();
  });

  it('propagates caller cancellation without interrupting a parallel call', async () => {
    let slowSignal: AbortSignal | undefined;
    const callTool = vi.fn(
      async (_tool: unknown, argumentsValue: Record<string, unknown>, options: { signal?: AbortSignal }) => {
        if (argumentsValue.mode !== 'slow') return { result: '{"ok":true}' };
        slowSignal = options.signal;
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new GeaMcpGatewayError('MCP_REQUEST_CANCELLED'));
          if (options.signal?.aborted) abort();
          else options.signal?.addEventListener('abort', abort, { once: true });
        });
      }
    );
    const authService = {
      createMcpGatewaySession: vi.fn().mockResolvedValue({
        listTools: vi.fn().mockResolvedValue([
          {
            name: 'query_business_data',
            inputSchema: { type: 'object' },
            sourceCode: 'mcp-business-data',
          },
        ]),
        callTool,
      }),
    } as unknown as GeaLarkAuthService;
    handle = await startGeaMcpBridge(authService, 'sales_forecast');

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));
    const controller = new AbortController();
    const slowCall = client.callTool({ name: 'query_business_data', arguments: { mode: 'slow' } }, undefined, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(slowSignal).toBeDefined());
    const fastCall = client.callTool({ name: 'query_business_data', arguments: { mode: 'fast' } });

    controller.abort();
    await expect(slowCall).rejects.toBeDefined();
    await expect(fastCall).resolves.toMatchObject({ content: [{ type: 'text', text: '{"ok":true}' }] });
    await vi.waitFor(() => expect(slowSignal?.aborted).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(callTool).toHaveBeenCalledTimes(2);

    await client.close();
  });
});
