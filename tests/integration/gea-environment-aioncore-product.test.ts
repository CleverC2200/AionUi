/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import http, { type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';

const bundledRoot = path.resolve('resources/bundled-aioncore/darwin-arm64');
const explicitAionCoreBinary = process.env.AIONUI_TEST_AIONCORE_BIN;
const aioncoreBinary = explicitAionCoreBinary || path.join(bundledRoot, 'aioncore');
const testSupportAionCoreBinary = process.env.AIONUI_TEST_AIONCORE_TEST_SUPPORT_BIN;
const managedResources = process.env.AIONUI_TEST_MANAGED_RESOURCES || path.join(bundledRoot, 'managed-resources');
const productIt = explicitAionCoreBinary && existsSync(aioncoreBinary) && existsSync(managedResources) ? it : it.skip;
const testSupportIt =
  testSupportAionCoreBinary && existsSync(testSupportAionCoreBinary) && existsSync(managedResources) ? it : it.skip;

type ObservedRequest = {
  body: string;
  headers: http.IncomingHttpHeaders;
  method: string;
  pathname: string;
};

type MockGea = {
  close: () => Promise<void>;
  label: string;
  requests: ObservedRequest[];
  url: string;
};

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const writeJson = (res: http.ServerResponse, body: unknown, status = 200): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function startMockGea(label: 'a' | 'b'): Promise<MockGea> {
  const requests: ObservedRequest[] = [];
  const skillBody = Buffer.from(
    `---\nname: environment-skill\ndescription: ${label.toUpperCase()} environment skill\n---\nUse ${label.toUpperCase()} only.`,
    'utf8'
  );
  const digest = createHash('sha256').update(skillBody).digest('hex');
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requests.push({ body, headers: req.headers, method: req.method ?? 'GET', pathname: url.pathname });

    if (url.pathname === '/aidata/client-resource-catalog/my') {
      writeJson(res, {
        status: 'ok',
        revision: `resource-${label}`,
        snapshot: {
          schemaVersion: 1,
          revision: `resource-${label}`,
          tenantId: `tenant-${label}`,
          skills: [
            {
              id: 'environment-skill',
              version: label === 'a' ? '1.0.0' : '2.0.0',
              name: `${label.toUpperCase()} environment skill`,
              description: `${label.toUpperCase()} environment catalog`,
              artifactRef: `skills/environment-skill/${label}`,
              artifactSize: skillBody.length,
              digest,
              state: 'active',
            },
          ],
        },
      });
      return;
    }
    if (url.pathname === '/aidata/client-resource-catalog/skill-artifact') {
      res.writeHead(200, {
        'content-type': 'text/markdown',
        'x-skill-digest': digest,
        'x-skill-size': String(skillBody.length),
        'x-skill-version': label === 'a' ? '1.0.0' : '2.0.0',
      });
      res.end(skillBody);
      return;
    }
    if (url.pathname === '/ai/gateway/session') {
      const input = JSON.parse(body) as { consumerCode: string; conversationId: string };
      writeJson(res, {
        success: true,
        result: {
          accessDecision: { allowed: true },
          delegationToken: `delegation-${label}`,
          gatewayContext: {
            consumerCode: input.consumerCode,
            sessionId: `session-${label}`,
            conversationId: input.conversationId,
          },
        },
      });
      return;
    }
    if (url.pathname === '/ai/gateway/mcp/proxy/list') {
      writeJson(res, {
        success: true,
        tools: [
          {
            name: `tool_${label}`,
            sourceCode: `source_${label}`,
            description: `${label.toUpperCase()} tool`,
            inputSchema: { type: 'object' },
          },
        ],
      });
      return;
    }
    if (url.pathname === '/ai/gateway/mcp/proxy/call') {
      const input = JSON.parse(body) as { mcpCode: string; toolName: string };
      writeJson(res, {
        success: true,
        sourceCode: input.mcpCode,
        toolName: input.toolName,
        result: { environment: label },
        auditId: `audit-${label}`,
      });
      return;
    }
    if (url.pathname === '/api/v1/notifications') {
      writeJson(res, {
        success: true,
        result: {
          items: [
            {
              id: `notification-read-${label}`,
              version: 1,
              state: 'unread',
              kind: 'notice',
              severity: 'info',
              title: `${label.toUpperCase()} notification`,
              dismissible: true,
              source: { type: 'business_system', ref: `environment-${label}`, label: 'gea.environment.test' },
              target: { type: 'aggregate', value: `environment-${label}` },
              created_at: '2026-08-24T00:00:00Z',
            },
            {
              id: `notification-dismiss-${label}`,
              version: 1,
              state: 'unread',
              kind: 'notice',
              severity: 'info',
              title: `${label.toUpperCase()} dismiss notification`,
              dismissible: true,
              source: { type: 'business_system', ref: `environment-${label}`, label: 'gea.environment.test' },
              target: { type: 'aggregate', value: `environment-${label}` },
              created_at: '2026-08-24T00:00:00Z',
            },
          ],
          unread_count: 2,
          total: 2,
        },
      });
      return;
    }
    if (url.pathname === `/api/v1/notifications/notification-read-${label}/read`) {
      writeJson(res, {
        success: true,
        result: {
          receipt_id: `receipt-read-${label}`,
          notification_id: `notification-read-${label}`,
          version: 2,
          status: 'read',
        },
      });
      return;
    }
    if (url.pathname === `/api/v1/notifications/notification-dismiss-${label}/dismiss`) {
      writeJson(res, {
        success: true,
        result: {
          receipt_id: `receipt-dismiss-${label}`,
          notification_id: `notification-dismiss-${label}`,
          version: 2,
          status: 'dismissed',
        },
      });
      return;
    }
    if (url.pathname === '/ai/gateway/interaction-requests') {
      const conversationScoped = typeof req.headers['x-delegation-token'] === 'string';
      writeJson(res, {
        success: true,
        result: {
          revision: `interaction-${label}`,
          items: conversationScoped
            ? [
                {
                  requestId: `request-${label}`,
                  version: 'v1',
                  status: 'pending',
                  kind: 'question',
                  title: `${label.toUpperCase()} question`,
                  allowedActions: ['answer', 'decline'],
                  updatedAt: '2026-08-24T00:00:00Z',
                  presentation: {
                    type: 'question',
                    questions: [{ question: 'Continue?', multiSelect: false, options: [{ label: 'Yes' }] }],
                  },
                },
              ]
            : [],
        },
      });
      return;
    }
    if (url.pathname === `/ai/gateway/interaction-requests/request-${label}/actions`) {
      writeJson(res, {
        success: true,
        result: {
          receiptId: `receipt-${label}`,
          requestId: `request-${label}`,
          version: 'v2',
          status: 'accepted',
          turnContinuation: 'original_tool_call_released',
        },
      });
      return;
    }

    writeJson(res, { success: false, code: 'NOT_FOUND' }, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    label,
    requests,
    url: `http://127.0.0.1:${port}`,
  };
}

async function startAionCore(
  dataDir: string,
  geaUrl: string,
  binaryPath = aioncoreBinary
): Promise<{ child: ChildProcessWithoutNullStreams; url: string }> {
  const child = spawn(
    binaryPath,
    [
      '--port',
      '0',
      '--data-dir',
      dataDir,
      '--work-dir',
      dataDir,
      '--local',
      '--managed-resources-mode',
      'bundled',
      '--log-level',
      'warn',
    ],
    {
      env: {
        ...process.env,
        AIONUI_BUNDLED_MANAGED_RESOURCES: managedResources,
        AIONUI_GEA_BASE_URL: geaUrl,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
  let output = '';
  const port = await new Promise<number>((resolve, reject) => {
    let listeningPort: number | null = null;
    let settled = false;
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      operation();
    };
    const timeout = setTimeout(
      () => finish(() => reject(new Error(`AIONCORE_START_TIMEOUT\n${output.slice(-4000)}`))),
      15_000
    );
    const inspect = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      const match = /AIONCORE_LISTENING \{"host":"127\.0\.0\.1","port":(\d+)\}/.exec(output);
      if (match) listeningPort = Number(match[1]);
      if (listeningPort !== null && output.includes('AIONCORE_READY')) {
        finish(() => resolve(listeningPort as number));
      }
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.once('exit', (code) => {
      finish(() => reject(new Error(`AIONCORE_EXITED_${String(code)}\n${output.slice(-4000)}`)));
    });
  });
  return { child, url: `http://127.0.0.1:${port}` };
}

async function stopAionCore(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('AIONCORE_STOP_TIMEOUT')), 10_000)),
  ]);
}

async function coreJson(url: string, pathname: string, method = 'GET', body?: unknown): Promise<Response> {
  try {
    return await fetch(`${url}${pathname}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
  } catch (error) {
    throw new Error(`${method} ${pathname} failed`, { cause: error });
  }
}

describe('packaged AionCore GEA environment product path', () => {
  const mocks: MockGea[] = [];

  afterAll(async () => {
    await Promise.all(mocks.splice(0).map((mock) => mock.close()));
  });

  productIt('starts the pinned release bundle with the GEA auth session routes registered', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'aionui-gea-release-'));
    const core = await startAionCore(dataDir, 'https://gea.invalid');
    try {
      const initialStatus = await coreJson(core.url, '/api/gea/auth/session');
      expect(initialStatus.status).toBe(200);
      expect((await initialStatus.json()) as object).toMatchObject({ data: { authenticated: false } });

      const auth = await coreJson(core.url, '/api/gea/auth/session', 'PUT', {
        accessToken: 'release-smoke-token',
        tenantId: 'release-smoke-tenant',
      });
      expect(auth.status).toBe(200);
    } finally {
      await stopAionCore(core.child);
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  testSupportIt(
    'keeps resources, inbox, sessions and MCP on A -> B -> A without reusing process credentials',
    async () => {
      const environmentA = await startMockGea('a');
      const environmentB = await startMockGea('b');
      mocks.push(environmentA, environmentB);
      const dataDir = await mkdtemp(path.join(os.tmpdir(), 'aionui-gea-product-'));

      const runEnvironment = async (mock: MockGea, run: number, oldConversationId?: string): Promise<string> => {
        const core = await startAionCore(dataDir, mock.url, testSupportAionCoreBinary);
        try {
          const initialStatus = await coreJson(core.url, '/api/gea/auth/session');
          expect(initialStatus.status).toBe(200);
          expect((await initialStatus.json()) as object).toMatchObject({ data: { authenticated: false } });

          if (oldConversationId) {
            const oldSession = await coreJson(core.url, `/api/gea/conversations/${oldConversationId}/tools`);
            expect(oldSession.status).not.toBe(200);
          }

          const auth = await coreJson(core.url, '/api/gea/auth/session', 'PUT', {
            accessToken: `token-${mock.label}`,
            tenantId: `tenant-${mock.label}`,
          });
          expect(auth.status).toBe(200);

          const sync = await coreJson(core.url, '/api/client-resources/sync', 'POST', { resources: ['skills'] });
          expect(sync.status).toBe(200);
          const skills = await coreJson(core.url, '/api/skills');
          expect(skills.status).toBe(200);
          const skillBody = (await skills.json()) as { data: Array<{ skill_id: string; version: string }> };
          expect(skillBody.data.find((skill) => skill.skill_id === 'environment-skill')?.version).toBe(
            mock.label === 'a' ? '1.0.0' : '2.0.0'
          );

          const conversation = await coreJson(core.url, '/api/conversations', 'POST', {
            type: 'acp',
            name: `GEA environment ${mock.label}-${run}`,
            extra: {},
          });
          expect(conversation.status, await conversation.clone().text()).toBe(201);
          const conversationId = ((await conversation.json()) as { data: { id: string } }).data.id;

          const session = await coreJson(core.url, `/api/gea/conversations/${conversationId}/session`, 'POST', {
            consumerCode: 'environment-agent',
          });
          expect(session.status, await session.clone().text()).toBe(200);
          const tools = await coreJson(core.url, `/api/gea/conversations/${conversationId}/tools`);
          expect(tools.status).toBe(200);
          const toolsBody = (await tools.json()) as { data: Array<{ name: string }> };
          expect(toolsBody.data.map((tool) => tool.name)).toEqual([`tool_${mock.label}`]);
          const call = await coreJson(
            core.url,
            `/api/gea/conversations/${conversationId}/tools/tool_${mock.label}`,
            'POST',
            { arguments: {} }
          );
          expect(call.status, await call.clone().text()).toBe(200);
          expect((await call.json()) as object).toMatchObject({ data: { result: { environment: mock.label } } });

          const notifications = await coreJson(core.url, '/api/notifications?status=active');
          expect(notifications.status).toBe(200);
          const notificationBody = (await notifications.json()) as { data: { items: Array<{ id: string }> } };
          expect(notificationBody.data.items.map((item) => item.id).toSorted()).toEqual(
            run === 1
              ? [`notification-dismiss-${mock.label}`, `notification-read-${mock.label}`]
              : [`notification-read-${mock.label}`]
          );
          if (run === 1) {
            const read = await coreJson(core.url, `/api/notifications/notification-read-${mock.label}/read`, 'POST', {
              expected_version: '1',
              idempotency_key: `read-${mock.label}-${run}`,
            });
            expect(read.status, await read.clone().text()).toBe(200);
            const dismiss = await coreJson(
              core.url,
              `/api/notifications/notification-dismiss-${mock.label}/dismiss`,
              'POST',
              { expected_version: '1', idempotency_key: `dismiss-${mock.label}-${run}` }
            );
            expect(dismiss.status, await dismiss.clone().text()).toBe(200);
          }

          const interactions = await coreJson(
            core.url,
            `/api/gea/conversations/${conversationId}/interaction-requests`
          );
          expect(interactions.status, await interactions.clone().text()).toBe(200);
          expect((await interactions.json()) as object).toMatchObject({
            data: { revision: `interaction-${mock.label}`, items: [{ requestId: `request-${mock.label}` }] },
          });
          const action = await coreJson(
            core.url,
            `/api/gea/conversations/${conversationId}/interaction-requests/request-${mock.label}/actions`,
            'POST',
            {
              expectedVersion: 'v1',
              idempotencyKey: `action-${mock.label}-${run}`,
              actionId: 'answer',
              payload: { answers: [{ question: 'Continue?', labels: ['Yes'] }] },
            }
          );
          expect(action.status, await action.clone().text()).toBe(200);
          expect((await action.json()) as object).toMatchObject({ data: { receiptId: `receipt-${mock.label}` } });
          return conversationId;
        } finally {
          await stopAionCore(core.child);
        }
      };

      try {
        const conversationA = await runEnvironment(environmentA, 1);
        const requestsAfterA1 = environmentA.requests.length;
        expect(requestsAfterA1).toBeGreaterThan(0);
        expect(environmentB.requests).toHaveLength(0);

        const conversationB = await runEnvironment(environmentB, 1, conversationA);
        const requestsAfterB = environmentB.requests.length;
        expect(requestsAfterB).toBeGreaterThan(0);
        expect(environmentA.requests).toHaveLength(requestsAfterA1);

        await runEnvironment(environmentA, 2, conversationB);
        expect(environmentA.requests.length).toBeGreaterThan(requestsAfterA1);
        expect(environmentB.requests).toHaveLength(requestsAfterB);

        const serializedA = JSON.stringify(environmentA.requests);
        const serializedB = JSON.stringify(environmentB.requests);
        expect(serializedA).not.toContain('token-b');
        expect(serializedA).not.toContain('delegation-b');
        expect(serializedB).not.toContain('token-a');
        expect(serializedB).not.toContain('delegation-a');
        for (const mock of [environmentA, environmentB]) {
          expect(mock.requests.some((request) => request.pathname === '/aidata/client-resource-catalog/my')).toBe(true);
          expect(
            mock.requests.some((request) => request.pathname === '/aidata/client-resource-catalog/skill-artifact')
          ).toBe(true);
          expect(mock.requests.some((request) => request.pathname === '/api/v1/notifications')).toBe(true);
          expect(mock.requests.some((request) => request.pathname === '/ai/gateway/interaction-requests')).toBe(true);
          expect(mock.requests.some((request) => request.pathname === '/ai/gateway/session')).toBe(true);
          expect(mock.requests.some((request) => request.pathname === '/ai/gateway/mcp/proxy/list')).toBe(true);
          expect(mock.requests.some((request) => request.pathname === '/ai/gateway/mcp/proxy/call')).toBe(true);
        }
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    60_000
  );
});
