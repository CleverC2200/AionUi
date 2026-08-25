import { createHash, randomUUID } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type ContentBlock,
  type Resource,
  type ResourceContents,
  type ResourceTemplate,
} from '@modelcontextprotocol/sdk/types.js';
import {
  GeaMcpGatewayError,
  type GeaLarkAuthService,
  type GeaMcpErrorEnvelope,
  type GeaMcpGatewaySession,
  type GeaMcpGatewayTool,
  type GeaMcpOperationContext,
} from './gea-lark-auth.js';

type BridgeSession = {
  server: Server;
  transport: StreamableHTTPServerTransport;
};

type ExposedGeaMcpGatewayTool = {
  exposedName: string;
  tool: GeaMcpGatewayTool;
};

export type GeaMcpBridgeHandle = {
  close: () => Promise<void>;
  url: string;
};

function writeJsonError(res: ServerResponse, statusCode: number, message: string): void {
  res.writeHead(statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const hostname = hostHeader.startsWith('[')
    ? hostHeader.slice(1, hostHeader.indexOf(']'))
    : hostHeader.split(':', 1)[0];
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
}

function errorEnvelope(error: unknown, operationId?: string): GeaMcpErrorEnvelope {
  if (error instanceof GeaMcpGatewayError) {
    return error.envelope.operationId || !operationId ? error.envelope : { ...error.envelope, operationId };
  }
  return { code: 'GEA_MCP_BRIDGE_ERROR', retryable: false, ...(operationId ? { operationId } : {}) };
}

function errorResult(envelope: GeaMcpErrorEnvelope) {
  const meta = Object.fromEntries(
    (['auditId', 'operationId', 'requestId', 'traceId'] as const)
      .filter((key) => envelope[key])
      .map((key) => [key, envelope[key]])
  );
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: envelope.code }],
    structuredContent: { error: envelope },
    ...(Object.keys(meta).length ? { _meta: meta } : {}),
  };
}

function resultText(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value ?? null);
}

function safeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const safe: Record<string, unknown> = {};
  if (typeof meta.sha256 === 'string' && /^[a-f\d]{64}$/i.test(meta.sha256)) safe.sha256 = meta.sha256.toLowerCase();
  if (typeof meta.expiresAt === 'string' && meta.expiresAt.trim()) safe.expiresAt = meta.expiresAt.trim();
  return Object.keys(safe).length ? safe : undefined;
}

function safeResource<T extends Resource>(resource: T): T {
  if (!resource.uri.startsWith('data-artifact://gateway/')) {
    throw new GeaMcpGatewayError('GEA_RESOURCE_URI_INVALID');
  }
  const meta = safeMeta(resource._meta);
  if (!meta?.sha256 || !meta.expiresAt) {
    throw new GeaMcpGatewayError('GEA_RESOURCE_METADATA_INVALID');
  }
  return { ...resource, ...(meta ? { _meta: meta } : { _meta: undefined }) };
}

function safeResourceTemplate(template: ResourceTemplate): ResourceTemplate {
  if (!template.uriTemplate.startsWith('data-artifact://gateway/')) {
    throw new GeaMcpGatewayError('GEA_RESOURCE_URI_INVALID');
  }
  return { ...template, _meta: undefined };
}

function safeResourceContents(content: ResourceContents): ResourceContents {
  if (!content.uri.startsWith('data-artifact://gateway/')) {
    throw new GeaMcpGatewayError('GEA_RESOURCE_URI_INVALID');
  }
  const meta = safeMeta(content._meta);
  if (!meta?.sha256 || !meta.expiresAt) {
    throw new GeaMcpGatewayError('GEA_RESOURCE_METADATA_INVALID');
  }
  return { ...content, ...(meta ? { _meta: meta } : { _meta: undefined }) };
}

function safeToolContent(content: ContentBlock): ContentBlock {
  return content.type === 'resource_link' ? safeResource(content) : content;
}

const MAX_TOOL_NAME_LENGTH = 64;
const BUSINESS_DATA_TOOL_NAME = 'query_business_data';
const DEFAULT_GEA_MCP_CALL_TIMEOUT_MS = 60_000;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function operationContext(meta: Record<string, unknown> | undefined): GeaMcpOperationContext {
  const now = Date.now();
  const defaultDeadline = now + DEFAULT_GEA_MCP_CALL_TIMEOUT_MS;
  const requestedDeadline = typeof meta?.deadlineAt === 'string' ? Date.parse(meta.deadlineAt) : Number.NaN;
  const deadline = Number.isFinite(requestedDeadline) ? Math.min(requestedDeadline, defaultDeadline) : defaultDeadline;
  const operationId =
    typeof meta?.operationId === 'string' && UUID_V4_PATTERN.test(meta.operationId) ? meta.operationId : randomUUID();
  const attempt =
    typeof meta?.attempt === 'number' && Number.isInteger(meta.attempt) && meta.attempt >= 1 ? meta.attempt : 1;
  const parentRequestId =
    typeof meta?.parentRequestId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(meta.parentRequestId)
      ? meta.parentRequestId
      : undefined;
  return {
    operationId,
    attempt,
    deadlineAt: new Date(deadline).toISOString(),
    ...(parentRequestId ? { parentRequestId } : {}),
  };
}

const LEGACY_BUSINESS_DATA_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ['inspect', 'query'],
      description: 'inspect reads the semantic-model catalog; query executes one to eight named Cube queries.',
    },
    queries: {
      type: 'array',
      maxItems: 8,
      description: 'Use an empty array for inspect. For query, provide one to eight named query objects.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'query'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            description: 'Stable name for this query in the returned result.',
          },
          query: {
            type: 'object',
            additionalProperties: true,
            description: 'Cube JSON Query. Put all query fields inside this object.',
            properties: {
              measures: { type: 'array', items: { type: 'string' } },
              dimensions: { type: 'array', items: { type: 'string' } },
              filters: { type: 'array', items: { type: 'object' } },
              timeDimensions: { type: 'array', items: { type: 'object' } },
              segments: { type: 'array', items: { type: 'string' } },
              limit: { type: 'integer', minimum: 0 },
              order: {
                oneOf: [
                  { type: 'object', additionalProperties: { type: 'string', enum: ['asc', 'desc'] } },
                  { type: 'array', items: { type: 'object' } },
                ],
              },
            },
          },
        },
      },
    },
  },
  required: ['action', 'queries'],
};

function usesLegacyBusinessDataArguments(tool: GeaMcpGatewayTool): boolean {
  if (tool.name !== BUSINESS_DATA_TOOL_NAME) return false;
  const properties = tool.inputSchema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return false;
  const queries = (properties as Record<string, unknown>).queries;
  if (!queries || typeof queries !== 'object' || Array.isArray(queries)) return false;
  return (queries as Record<string, unknown>).type === 'string';
}

function exposedInputSchema(tool: GeaMcpGatewayTool): Record<string, unknown> {
  return usesLegacyBusinessDataArguments(tool) ? LEGACY_BUSINESS_DATA_INPUT_SCHEMA : tool.inputSchema;
}

function gatewayArguments(tool: GeaMcpGatewayTool, argumentsValue: Record<string, unknown>): Record<string, unknown> {
  if (!usesLegacyBusinessDataArguments(tool) || !Array.isArray(argumentsValue.queries)) return argumentsValue;
  return { ...argumentsValue, queries: JSON.stringify(argumentsValue.queries) };
}

function createCompatibleToolName(name: string, usedNames: Set<string>): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'gea_tool';
  if (sanitized.length <= MAX_TOOL_NAME_LENGTH && !usedNames.has(sanitized)) {
    return sanitized;
  }

  for (let attempt = 0; ; attempt += 1) {
    const digest = createHash('sha256').update(`${name}\0${attempt}`).digest('hex').slice(0, 8);
    const prefix = sanitized.slice(0, MAX_TOOL_NAME_LENGTH - digest.length - 1);
    const candidate = `${prefix}_${digest}`;
    if (!usedNames.has(candidate)) return candidate;
  }
}

function createMcpServer(authService: GeaLarkAuthService, agentCode: string): Server {
  const server = new Server(
    { name: 'gea-gateway', version: '1.0.0' },
    {
      capabilities: { resources: {}, tools: {} },
    }
  );
  let gatewaySession: GeaMcpGatewaySession | null = null;
  let toolsByName = new Map<string, GeaMcpGatewayTool>();

  server.onclose = () => {
    const session = gatewaySession;
    gatewaySession = null;
    if (session && typeof session.close === 'function') void session.close();
  };

  const loadTools = async (): Promise<ExposedGeaMcpGatewayTool[]> => {
    gatewaySession ??= await authService.createMcpGatewaySession(agentCode);
    const tools = await gatewaySession.listTools();
    const nextTools = new Map<string, GeaMcpGatewayTool>();
    const originalNames = new Set<string>();
    for (const tool of tools) {
      if (originalNames.has(tool.name)) {
        throw new GeaMcpGatewayError('GEA_MCP_DUPLICATE_TOOL_NAME');
      }
      originalNames.add(tool.name);
      const exposedName = createCompatibleToolName(tool.name, new Set(nextTools.keys()));
      nextTools.set(exposedName, tool);
    }
    toolsByName = nextTools;
    return [...nextTools].map(([exposedName, tool]) => ({ exposedName, tool }));
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await loadTools();
    return {
      tools: tools.map(({ exposedName, tool }) => ({
        name: exposedName,
        inputSchema: exposedInputSchema(tool),
        ...(tool.description ? { description: tool.description } : {}),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const operation = operationContext(request.params._meta);
    try {
      if (!gatewaySession || !toolsByName.has(request.params.name)) {
        await loadTools();
      }
      const tool = toolsByName.get(request.params.name);
      if (!tool || !gatewaySession) {
        return errorResult({ code: 'GEA_MCP_TOOL_NOT_FOUND', retryable: false, operationId: operation.operationId });
      }
      const argumentsValue =
        request.params.arguments && typeof request.params.arguments === 'object' ? request.params.arguments : {};
      const result = await gatewaySession.callTool(tool, gatewayArguments(tool, argumentsValue), {
        operation,
      });
      if (result.isError) {
        return errorResult(
          result.error ?? { code: 'GEA_MCP_TOOL_FAILED', retryable: false, operationId: operation.operationId }
        );
      }
      const content = result.content?.map(safeToolContent) ?? [
        { type: 'text' as const, text: resultText(result.result) },
      ];
      return {
        content,
        ...(result.isError !== undefined ? { isError: result.isError } : {}),
        ...(result.result && typeof result.result === 'object' ? { structuredContent: result.result } : {}),
        ...(result.meta ? { _meta: result.meta } : {}),
      };
    } catch (error) {
      return errorResult(errorEnvelope(error, operation.operationId));
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    gatewaySession ??= await authService.createMcpGatewaySession(agentCode);
    const result = await gatewaySession.listResources(request.params?.cursor);
    return {
      resources: result.resources.map(safeResource),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => {
    gatewaySession ??= await authService.createMcpGatewaySession(agentCode);
    const result = await gatewaySession.listResourceTemplates(request.params?.cursor);
    return {
      resourceTemplates: result.resourceTemplates.map(safeResourceTemplate),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    gatewaySession ??= await authService.createMcpGatewaySession(agentCode);
    return {
      contents: (await gatewaySession.readResource(request.params.uri)).map(safeResourceContents),
    };
  });

  return server;
}

export async function startGeaMcpBridge(
  authService: GeaLarkAuthService,
  agentCode: string
): Promise<GeaMcpBridgeHandle> {
  const normalizedAgentCode = agentCode.trim();
  if (!normalizedAgentCode) {
    throw new GeaMcpGatewayError('GEA_AGENT_CODE_MISSING');
  }

  const sessions = new Map<string, BridgeSession>();
  const httpServer = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!isLoopbackHost(req.headers.host)) {
        writeJsonError(res, 403, 'Forbidden');
        return;
      }
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (pathname !== '/mcp' || !['GET', 'POST', 'DELETE'].includes(req.method ?? '')) {
        writeJsonError(res, 404, 'Not found');
        return;
      }

      const sessionIdHeader = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
      let bridgeSession = sessionId ? sessions.get(sessionId) : undefined;

      if (!bridgeSession && !sessionId && req.method === 'POST') {
        const server = createMcpServer(authService, normalizedAgentCode);
        let transport!: StreamableHTTPServerTransport;
        transport = new StreamableHTTPServerTransport({
          enableJsonResponse: true,
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (initializedSessionId) => {
            sessions.set(initializedSessionId, { server, transport });
          },
          onsessionclosed: (closedSessionId) => {
            sessions.delete(closedSessionId);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await server.connect(transport);
        bridgeSession = { server, transport };
      }

      if (!bridgeSession) {
        writeJsonError(res, 400, 'Invalid or missing MCP session');
        return;
      }
      await bridgeSession.transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) writeJsonError(res, 500, 'Internal server error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('GEA MCP bridge failed to bind');
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      await Promise.allSettled([...sessions.values()].map(({ server }) => server.close()));
      sessions.clear();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
