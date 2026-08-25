import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeaLarkAuthService } from '../../src/gea-lark-auth.js';
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
    const callTool = vi.fn().mockResolvedValue({ result: '{"data":[]}', auditId: 'audit-1' });
    const authService = {
      createMcpGatewaySession: vi.fn().mockResolvedValue({ listTools, callTool }),
    } as unknown as GeaLarkAuthService;
    handle = await startGeaMcpBridge(authService, 'sales_forecast');

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));

    await expect(client.listTools()).resolves.toMatchObject({
      tools: [{ name: 'search_records', description: '搜索记录' }],
    });
    await expect(client.callTool({ name: 'search_records', arguments: { query: '客户A' } })).resolves.toEqual({
      content: [{ type: 'text', text: '{"data":[]}' }],
    });
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({ sourceCode: 'mcp-001' }), { query: '客户A' });

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

    expect(callTool).toHaveBeenCalledWith(legacyTool, {
      action: 'query',
      queries: JSON.stringify(queries),
    });
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

    expect(callTool).toHaveBeenCalledWith(modernTool, { action: 'query', queries });
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
    expect(callTool).toHaveBeenCalledWith(dottedTool, {});

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
});
