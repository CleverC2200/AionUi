import type { ElectronApplication, Page, Route } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { goToAssistantSettings, navigateTo, takeScreenshot } from '../../helpers';

const ASSISTANT_ID = 'enterprise-payment-review';
const CONVERSATION_ID = 'e2e-enterprise-payment-review';
const QUESTION_REQUEST_ID = 'e2e-erp-cost-center';
const PERMISSION_REQUEST_ID = 'e2e-oa-production-submit';
const E2E_STREAM_KEY = 'aionui:e2e-message-stream-conversation-id';
const PROJECT_NAME = '企业付款复核项目';

type E2EStreamRegistry = {
  controllers: Record<
    string,
    {
      emitInteractionQuestion: (requestId: string, version?: string, fixture?: unknown) => Promise<void>;
      emitInteractionPermission: (requestId: string, version?: string, fixture?: unknown) => Promise<void>;
      emitFollowUpExchange: (fixture?: unknown) => Promise<void>;
    }
  >;
};

const managedMetadata = {
  assignment_id: 'assignment-payment-review',
  template_id: 'payment-review',
  template_version: '3.2.0',
  catalog_revision: 'assistant-catalog-r8',
  activation: 'required' as const,
  state: 'active' as const,
  minimum_client_version: '0.0.1',
  sync_status: 'fresh' as const,
  required_skill_ids: ['skill-payment-policy'],
  required_mcp_ids: ['mcp-oa-production'],
  user_extensions: { mode: 'additive' as const, allow_skills: true, allow_mcps: true },
  extensions: {
    revision: 'payment-extensions-r1',
    skill_ids: [],
    mcp_ids: [],
    status: 'active' as const,
    violations: [],
  },
};

const paymentAssistant = {
  id: ASSISTANT_ID,
  source: 'managed' as const,
  name: 'Payment Review',
  name_i18n: { 'zh-CN': '企业付款复核助手' },
  description: 'Review payment evidence and submit through governed production systems',
  description_i18n: { 'zh-CN': '核验付款材料并通过受管生产系统提交' },
  enabled: true,
  sort_order: 0,
  agent_id: 'enterprise-payment-agent',
  agent: { type: 'acp', source: 'internal' as const, acp_backend: 'codex' },
  enabled_skills: ['skill-payment-policy'],
  custom_skill_names: [],
  disabled_builtin_skills: [],
  context: 'Protected enterprise payment instructions',
  context_i18n: {},
  prompts: ['Review and submit this payment request'],
  prompts_i18n: {},
  models: [],
  agent_status: 'unchecked' as const,
  team_selectable: true,
  deletable: false,
  managed: managedMetadata,
};

const paymentAssistantDetail = {
  id: ASSISTANT_ID,
  source: 'managed' as const,
  agent_status: 'unchecked' as const,
  team_selectable: true,
  deletable: false,
  profile: {
    name: paymentAssistant.name,
    name_i18n: paymentAssistant.name_i18n,
    description: paymentAssistant.description,
    description_i18n: paymentAssistant.description_i18n,
  },
  state: { enabled: true, sort_order: 0 },
  engine: { agent_id: paymentAssistant.agent_id, agent: paymentAssistant.agent },
  rules: { content: paymentAssistant.context, storage_mode: 'managed' },
  prompts: { recommended: paymentAssistant.prompts, recommended_i18n: {} },
  defaults: {
    model: { mode: 'fixed', value: 'enterprise/default' },
    permission: { mode: 'fixed', value: 'controlled' },
    thought_level: { mode: 'fixed', value: 'high' },
    skills: { mode: 'fixed', value: ['skill-payment-policy'] },
    mcps: { mode: 'fixed', value: ['mcp-oa-production'] },
  },
  capabilities: {
    default_skill_ids: ['skill-payment-policy'],
    custom_skill_names: [],
    default_disabled_builtin_skill_ids: [],
  },
  preferences: { last_skill_ids: [], last_disabled_builtin_skill_ids: [], last_mcp_ids: [] },
  managed: managedMetadata,
};

const managedSkill = {
  skill_id: 'skill-payment-policy',
  version: '2.4.1',
  name: 'payment-policy-check',
  description: 'GEA managed payment policy and evidence validation',
  location: '/tmp/aionui-e2e/managed-skills/payment-policy-check',
  relative_location: 'payment-policy-check',
  is_auto_inject: false,
  is_custom: false,
  source: 'managed' as const,
  state: 'active' as const,
};

const managedMcp = {
  id: 'mcp-oa-production',
  name: 'OA Production',
  description: 'Governed production submission for payment requests',
  enabled: true,
  transport: { type: 'stdio' as const, command: 'gea-oa-gateway', args: [] },
  created_at: 1,
  updated_at: 1,
  original_json: '{}',
  source: 'managed' as const,
  version: '1.7.0',
  state: 'active' as const,
  auth_mode: 'enterprise_delegation' as const,
  production_write: true,
  last_test_status: 'connected' as const,
  last_connected: 1,
};

const conversation = {
  id: CONVERSATION_ID,
  type: 'acp' as const,
  name: '付款申请 PAY-20260812-001',
  created_at: 1,
  updated_at: 1,
  extra: {
    workspace: `/tmp/${PROJECT_NAME}`,
    custom_workspace: true,
    backend: 'codex',
    preset_assistant_id: ASSISTANT_ID,
  },
};

const fulfillJson = (route: Route, data: unknown, status = 200): Promise<void> =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

const setElectronContentSize = async (
  electronApp: ElectronApplication,
  page: Page,
  width: number,
  height: number
): Promise<void> => {
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.webContents.isDevToolsOpened());
      window?.webContents.setZoomFactor(1);
      window?.setContentSize(size.width, size.height);
    },
    { width, height }
  );
  await page.setViewportSize({ width, height });
};

const waitForStreamController = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    (id) =>
      Boolean(
        (window as typeof window & { __AIONUI_E2E_MESSAGE_STREAM__?: E2EStreamRegistry }).__AIONUI_E2E_MESSAGE_STREAM__
          ?.controllers[id]
      ),
    CONVERSATION_ID,
    { timeout: 15_000 }
  );
};

const waitForAttentionDrawer = async (page: Page): Promise<void> => {
  const panel = page.getByTestId('attention-inbox-drawer').locator('.arco-drawer').last();
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      return box ? { right: Math.round(box.x + box.width), width: Math.round(box.width) } : null;
    })
    .toEqual({ right: 1440, width: 420 });
};

const emitStreamAction = async (
  page: Page,
  action: 'follow-up' | 'permission' | 'question',
  requestId?: string,
  fixture?: Record<string, unknown>
): Promise<void> => {
  await page.evaluate(
    async ({ id, actionName, requestId: targetRequestId, fixture: actionFixture }) => {
      const registry = (window as typeof window & { __AIONUI_E2E_MESSAGE_STREAM__?: E2EStreamRegistry })
        .__AIONUI_E2E_MESSAGE_STREAM__;
      const controller = registry?.controllers[id];
      if (!controller) throw new Error(`No E2E stream controller registered for ${id}`);
      if (actionName === 'question') await controller.emitInteractionQuestion(targetRequestId!, 'v1', actionFixture);
      else if (actionName === 'permission')
        await controller.emitInteractionPermission(targetRequestId!, 'v1', actionFixture);
      else await controller.emitFollowUpExchange(actionFixture);
    },
    { id: CONVERSATION_ID, actionName: action, requestId: requestId ?? null, fixture }
  );
};

test.describe('Enterprise business lifecycle — GEA resources, managed work and external attention', () => {
  test.setTimeout(150_000);

  test('user syncs governed resources, resolves cross-system work and receives a verified completion receipt', async ({
    page,
    electronApp,
  }) => {
    const synced = new Set<'assistants' | 'skills' | 'mcps'>();
    const lifecycleTrace: string[] = [];
    const pending = new Map<string, Record<string, unknown>>();
    const interactionCommands: Array<Record<string, unknown>> = [];
    let pendingReads = 0;
    let taskCompleted = false;
    let prepareBody: Record<string, unknown> | undefined;
    let createBody: Record<string, unknown> | undefined;

    const syncHandler = async (route: Route): Promise<void> => {
      const body = route.request().postDataJSON() as { resources: Array<'assistants' | 'skills' | 'mcps'> };
      const [resource] = body.resources;
      synced.add(resource);
      lifecycleTrace.push(`sync:${resource}`);
      await fulfillJson(route, {
        status: 'completed',
        changed: 1,
        skipped: 0,
        failed: 0,
        revision: `${resource}-resource-r1`,
      });
    };

    const assistantHandler = async (route: Route): Promise<void> => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() !== 'GET') {
        await route.continue();
        return;
      }
      if (pathname.endsWith(`/api/assistants/${ASSISTANT_ID}`)) {
        await fulfillJson(route, paymentAssistantDetail);
        return;
      }
      if (pathname.endsWith('/api/assistants')) {
        await fulfillJson(route, {
          assistants: synced.has('assistants') ? [paymentAssistant] : [],
          mode: 'managed',
          sync_status: 'fresh',
          revision: synced.has('assistants') ? 'assistant-catalog-r8' : 'assistant-catalog-r7',
        });
        return;
      }
      await route.continue();
    };

    const skillsHandler = async (route: Route): Promise<void> => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/skills') {
        await fulfillJson(route, synced.has('skills') ? [managedSkill] : []);
        return;
      }
      if (pathname === '/api/skills/import-history') {
        await fulfillJson(route, []);
        return;
      }
      if (pathname === '/api/skills/import-limits') {
        await fulfillJson(route, { max_file_bytes: 50_000_000, max_total_bytes: 200_000_000 });
        return;
      }
      await route.continue();
    };

    const mcpHandler = async (route: Route): Promise<void> => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'GET' && pathname === '/api/mcp/servers') {
        await fulfillJson(route, synced.has('mcps') ? [managedMcp] : []);
        return;
      }
      if (pathname === '/api/mcp/oauth/authenticated') {
        await fulfillJson(route, []);
        return;
      }
      await route.continue();
    };

    const conversationHandler = async (route: Route): Promise<void> => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'GET' && pathname === '/api/conversations') {
        const runtime = taskCompleted
          ? {
              state: 'idle',
              can_send_message: true,
              has_task: true,
              task_status: 'finished',
              is_processing: false,
              pending_confirmations: 0,
              turn_id: 'turn-payment-1',
            }
          : pending.size > 0
            ? {
                state: 'waiting_confirmation',
                can_send_message: false,
                has_task: true,
                task_status: 'running',
                is_processing: false,
                pending_confirmations: pending.size,
                turn_id: 'turn-payment-1',
              }
            : {
                state: 'running',
                can_send_message: false,
                has_task: true,
                task_status: 'running',
                is_processing: true,
                pending_confirmations: 0,
                turn_id: 'turn-payment-1',
              };
        await fulfillJson(route, {
          items: [{ ...conversation, modified_at: Date.now(), runtime }],
          total: 1,
          has_more: false,
        });
        return;
      }
      if (request.method() === 'POST' && pathname === '/api/conversations/prepare') {
        lifecycleTrace.push('conversation:prepare');
        prepareBody = request.postDataJSON() as Record<string, unknown>;
        if (!synced.has('assistants') || !synced.has('skills') || !synced.has('mcps')) {
          await fulfillJson(route, { code: 'RESOURCE_SNAPSHOT_INCOMPLETE' }, 409);
          return;
        }
        await fulfillJson(route, {
          status: 'ready',
          preparation_id: 'payment-preparation-1',
          revision: 'payment-preparation-r1',
          expires_at: '2099-08-12T10:05:00.000Z',
          snapshot: {
            schema_version: 1,
            snapshot_id: 'payment-snapshot-1',
            revision: 'payment-configuration-r1',
            prepared_at: '2026-08-12T10:00:00.000Z',
            identity_revision: 'identity-r6',
            assistant: {
              id: ASSISTANT_ID,
              source: 'managed',
              assignment_id: managedMetadata.assignment_id,
              template_id: managedMetadata.template_id,
              template_version: managedMetadata.template_version,
              catalog_revision: managedMetadata.catalog_revision,
              extension_revision: managedMetadata.extensions.revision,
            },
            agent: { id: 'enterprise-payment-agent', type: 'acp' },
            skills: [{ id: managedSkill.skill_id, version: managedSkill.version, source: 'enterprise_required' }],
            mcps: [
              {
                id: managedMcp.id,
                version: managedMcp.version,
                source: 'enterprise_required',
                auth_status: 'ready',
              },
            ],
            policy: { model: 'enterprise/default', permission: 'controlled', thought_level: 'high' },
          },
        });
        return;
      }
      if (request.method() === 'POST' && pathname === '/api/conversations') {
        lifecycleTrace.push('conversation:create');
        createBody = request.postDataJSON() as Record<string, unknown>;
        await fulfillJson(route, conversation);
        return;
      }
      if (pathname === `/api/conversations/${CONVERSATION_ID}/messages`) {
        if (request.method() === 'POST') {
          lifecycleTrace.push('task:start');
          await fulfillJson(route, {
            msg_id: 'payment-task-message-1',
            turn_id: 'turn-payment-1',
            runtime: {
              state: 'running',
              can_send_message: false,
              has_task: true,
              task_status: 'running',
              is_processing: true,
              pending_confirmations: 0,
              turn_id: 'turn-payment-1',
            },
          });
        } else {
          await fulfillJson(route, { items: [], total: 0, has_more: false });
        }
        return;
      }
      if (pathname === `/api/conversations/${CONVERSATION_ID}/records`) {
        lifecycleTrace.push(`records:${taskCompleted ? 'completed' : 'running'}`);
        await fulfillJson(route, {
          revision: taskCompleted ? 5 : 1,
          records: taskCompleted
            ? [
                {
                  id: 'payment-source-1',
                  revision: 1,
                  record_type: 'context_evidence',
                  conversation_id: CONVERSATION_ID,
                  turn_id: 'turn-payment-1',
                  task_id: 'task-payment-1',
                  producer: { type: 'business_system', id: 'erp' },
                  created_at: '2026-08-12T10:00:00.000Z',
                  resource: {
                    kind: 'url',
                    uri: 'https://erp.example.test/payment/PAY-20260812-001',
                    name: 'ERP 付款申请 PAY-20260812-001',
                  },
                },
                {
                  id: 'payment-deliverable-1',
                  revision: 1,
                  record_type: 'deliverable_revision',
                  conversation_id: CONVERSATION_ID,
                  turn_id: 'turn-payment-1',
                  task_id: 'task-payment-1',
                  producer: { type: 'agent', id: 'enterprise-payment-agent' },
                  created_at: '2026-08-12T10:03:00.000Z',
                  deliverable_id: 'payment-review-report',
                  status: 'ready',
                  resource: {
                    kind: 'file',
                    uri: '/tmp/aionui-enterprise-payment-e2e/payment-review.xlsx',
                    name: 'payment-review.xlsx',
                  },
                },
                {
                  id: 'payment-external-result-1',
                  revision: 1,
                  record_type: 'external_result',
                  conversation_id: CONVERSATION_ID,
                  turn_id: 'turn-payment-1',
                  task_id: 'task-payment-1',
                  producer: { type: 'business_system', id: 'oa-production' },
                  created_at: '2026-08-12T10:04:00.000Z',
                  system: 'OA 生产系统',
                  outcome: 'success',
                  reference: 'OA-PAY-20260812-001',
                },
                {
                  id: 'payment-verification-1',
                  revision: 1,
                  record_type: 'verification_evidence',
                  conversation_id: CONVERSATION_ID,
                  turn_id: 'turn-payment-1',
                  task_id: 'task-payment-1',
                  producer: { type: 'aioncore', id: 'aioncore' },
                  created_at: '2026-08-12T10:04:30.000Z',
                  outcome: 'pass',
                  summary: '付款材料与 OA 提交结果已核验',
                  evidence_record_ids: ['payment-deliverable-1', 'payment-external-result-1'],
                },
                {
                  id: 'payment-completion-1',
                  revision: 1,
                  record_type: 'completion_receipt',
                  conversation_id: CONVERSATION_ID,
                  turn_id: 'turn-payment-1',
                  task_id: 'task-payment-1',
                  producer: { type: 'aioncore', id: 'aioncore' },
                  created_at: '2026-08-12T10:05:00.000Z',
                  definition: '企业付款申请已复核并提交',
                  owner: 'enterprise-payment-agent',
                  status: 'verified',
                  evidence_record_ids: ['payment-verification-1'],
                },
              ]
            : [
                {
                  id: 'payment-source-1',
                  revision: 1,
                  record_type: 'context_evidence',
                  conversation_id: CONVERSATION_ID,
                  turn_id: 'turn-payment-1',
                  task_id: 'task-payment-1',
                  producer: { type: 'business_system', id: 'erp' },
                  created_at: '2026-08-12T10:00:00.000Z',
                  resource: {
                    kind: 'url',
                    uri: 'https://erp.example.test/payment/PAY-20260812-001',
                    name: 'ERP 付款申请 PAY-20260812-001',
                  },
                },
              ],
        });
        return;
      }
      if (pathname.endsWith('/confirmations') || pathname.endsWith('/slash-commands')) {
        await fulfillJson(route, []);
        return;
      }
      if (pathname.endsWith('/runtime/ensure') || pathname.endsWith('/active-lease')) {
        await fulfillJson(route, {});
        return;
      }
      if (request.method() === 'GET' && pathname === `/api/conversations/${CONVERSATION_ID}`) {
        await fulfillJson(route, conversation);
        return;
      }
      await route.continue();
    };

    const interactionHandler = async (route: Route): Promise<void> => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'GET') {
        pendingReads += 1;
        await fulfillJson(route, { revision: `pending-r${pendingReads}`, items: [...pending.values()] });
        return;
      }
      const requestId = decodeURIComponent(pathname.split('/').at(-2) ?? '');
      const body = request.postDataJSON() as Record<string, unknown>;
      const command = { request_id: requestId, ...body };
      const requestState = pending.get(requestId);
      interactionCommands.push(command);
      lifecycleTrace.push(`interaction:${requestId}:${String(body.action_id)}`);
      pending.delete(requestId);
      lifecycleTrace.push(`task:resume:${String(requestState?.turn_id)}`);
      if (requestId === QUESTION_REQUEST_ID) {
        pending.set(PERMISSION_REQUEST_ID, {
          id: PERMISSION_REQUEST_ID,
          version: 'v1',
          kind: 'permission',
          status: 'pending',
          title: '确认提交付款申请',
          summary: 'OA 生产系统将在确认后提交付款申请，请核对业务编号。',
          source: { type: 'business_system', label: 'OA 生产系统' },
          conversation_id: CONVERSATION_ID,
          turn_id: 'turn-payment-1',
          message_id: `e2e-permission-${PERMISSION_REQUEST_ID}`,
          allowed_actions: ['proceed_once', 'reject_once'],
          updated_at: '2026-08-12T10:02:00.000Z',
        });
      } else if (requestId === PERMISSION_REQUEST_ID) {
        taskCompleted = true;
      }
      await fulfillJson(route, {
        receipt_id: `receipt-${requestId}`,
        request_id: requestId,
        version: String(body.expected_version),
        status: 'accepted',
        resolved_at: '2026-08-12T10:03:00.000Z',
      });
    };

    await page.route('**/api/client-resources/sync', syncHandler);
    await page.route('**/api/assistants**', assistantHandler);
    await page.route('**/api/skills**', skillsHandler);
    await page.route('**/api/mcp/**', mcpHandler);
    await page.route('**/api/conversations**', conversationHandler);
    await page.route('**/api/interaction-requests**', interactionHandler);

    try {
      await setElectronContentSize(electronApp, page, 1440, 900);
      await page.evaluate(({ key, id }) => sessionStorage.setItem(key, id), {
        key: E2E_STREAM_KEY,
        id: CONVERSATION_ID,
      });
      await page.reload();
      await navigateTo(page, '#/guid');
      await expect(page.getByText('GEAUi', { exact: true }).first()).toBeVisible();
      await expect(page.getByTestId('guid-input')).toBeVisible();
      await takeScreenshot(page, 'enterprise-business-lifecycle/01-client-open.png');

      await goToAssistantSettings(page);
      await page.getByTestId('btn-create-assistant').click();
      await page.getByTestId('btn-create-assistant-gea').click();
      await page.getByTestId('settings-tab-official').click();
      await expect(page.getByTestId(`official-card-${ASSISTANT_ID}`)).toBeVisible();

      await navigateTo(page, '#/settings/skills');
      await page.getByTestId('btn-add-skill').click();
      await page.getByTestId('btn-add-skill-gea').click();
      await page.getByTestId('settings-tab-official').click();
      await expect(page.getByTestId(`managed-skill-card-${managedSkill.name}`)).toBeVisible();

      await navigateTo(page, '#/settings/tools');
      await page.getByTestId('add-mcp-server-menu').click();
      await page.getByTestId('add-mcp-server-menu-gea').click();
      await expect(page.getByText(managedMcp.name, { exact: true })).toBeVisible();
      await expect(page.getByText(/Enterprise managed|企业管理/).last()).toBeVisible();
      await takeScreenshot(page, 'enterprise-business-lifecycle/02-resources-synced.png');

      await goToAssistantSettings(page);
      await page.getByTestId('settings-tab-official').click();
      const assistantCard = page.getByTestId(`official-card-${ASSISTANT_ID}`);
      await assistantCard.hover();
      await page.getByTestId(`btn-chat-${ASSISTANT_ID}`).click();
      await page
        .locator('.guid-input-card-shell textarea')
        .first()
        .fill('复核付款申请 PAY-20260812-001 并提交生产系统');
      await page.getByTestId('guid-send-btn').click();
      await page.waitForURL(new RegExp(`/conversation/${CONVERSATION_ID}$`), { timeout: 15_000 });
      expect(prepareBody).toEqual(
        expect.objectContaining({ assistant: expect.objectContaining({ id: ASSISTANT_ID, source: 'managed' }) })
      );
      expect(createBody).toEqual({ preparation: { id: 'payment-preparation-1', revision: 'payment-preparation-r1' } });
      await waitForStreamController(page);
      await expect(page.getByText(PROJECT_NAME, { exact: true })).toBeVisible();
      const projectTaskStatus = page.getByTestId(`conversation-task-status-${CONVERSATION_ID}`);
      const projectTaskRow = page.getByTestId(`conversation-row-${CONVERSATION_ID}`);
      await expect(projectTaskStatus).toContainText(/进行中|Working/);
      await takeScreenshot(page, 'enterprise-business-lifecycle/03-project-task-running.png');
      await navigateTo(page, '#/guid');
      await projectTaskRow.click();
      await page.waitForURL(new RegExp(`/conversation/${CONVERSATION_ID}$`));
      await waitForStreamController(page);

      const readsBeforeErpPush = pendingReads;
      pending.set(QUESTION_REQUEST_ID, {
        id: QUESTION_REQUEST_ID,
        version: 'v1',
        kind: 'question',
        status: 'pending',
        title: '补充成本中心',
        summary: 'ERP 缺少本次付款申请的成本中心，请补充后继续复核。',
        source: { type: 'business_system', label: 'ERP 财务系统' },
        conversation_id: CONVERSATION_ID,
        turn_id: 'turn-payment-1',
        message_id: `e2e-question-${QUESTION_REQUEST_ID}`,
        allowed_actions: ['answer', 'decline'],
        updated_at: '2026-08-12T10:00:10.000Z',
      });
      await emitStreamAction(page, 'question', QUESTION_REQUEST_ID, {
        header: '付款信息',
        question: '本次付款申请应归属哪个成本中心？',
        options: [
          { label: '华东业务中心', description: '申请单所属采购项目的成本中心。' },
          { label: '总部共享中心', description: '仅用于总部统一采购。' },
        ],
      });
      await expect.poll(() => pendingReads).toBeGreaterThan(readsBeforeErpPush);
      await expect(projectTaskStatus).toContainText(/待处理|Needs input/);
      await page.getByTestId('attention-inbox-trigger').click();
      const attentionDrawer = page.getByTestId('attention-inbox-drawer');
      await waitForAttentionDrawer(page);
      const erpRequest = page.getByTestId(`attention-request-${QUESTION_REQUEST_ID}`);
      await expect(erpRequest).toBeVisible();
      await expect(erpRequest).toContainText('补充成本中心');
      await expect(erpRequest).toContainText('ERP 财务系统');
      await takeScreenshot(page, 'enterprise-business-lifecycle/03-erp-attention.png');
      await erpRequest.click();
      await expect(attentionDrawer.locator('.arco-drawer-mask')).toBeHidden();
      await page.getByTestId('message-question-option-0-华东业务中心').click();
      await page.getByTestId('message-question-submit').click();
      await expect(page.getByTestId('message-question-status')).toBeVisible();
      await emitStreamAction(page, 'follow-up', undefined, {
        user: '已补充成本中心，请继续复核。',
        assistant: '已收到成本中心，继续核验付款材料并准备 OA 提交。',
      });
      await expect(page.getByText('已收到成本中心，继续核验付款材料并准备 OA 提交。')).toBeVisible();

      const readsBeforeOaPush = pendingReads;
      await emitStreamAction(page, 'permission', PERMISSION_REQUEST_ID, {
        title: '确认提交付款申请',
        description: '将复核通过的付款申请提交到 OA 生产系统。本次授权只执行一次。',
        action: 'execute',
        detail: 'PAY-20260812-001 → OA Production',
        options: [
          { label: '允许本次提交', value: 'proceed_once' },
          { label: '拒绝', value: 'reject_once' },
        ],
      });
      await expect.poll(() => pendingReads).toBeGreaterThan(readsBeforeOaPush);
      await expect(projectTaskStatus).toContainText(/待处理|Needs input/);
      await page.getByTestId('attention-inbox-trigger').click();
      const oaRequest = page.getByTestId(`attention-request-${PERMISSION_REQUEST_ID}`);
      await waitForAttentionDrawer(page);
      await expect(oaRequest).toBeVisible();
      await expect(oaRequest).toContainText('确认提交付款申请');
      await expect(oaRequest).toContainText('OA 生产系统');
      await takeScreenshot(page, 'enterprise-business-lifecycle/04-oa-production-attention.png');
      await oaRequest.click();
      await expect(attentionDrawer.locator('.arco-drawer-mask')).toBeHidden();
      await page.getByTestId('message-permission-option-proceed_once').click();
      await expect(page.getByTestId('message-permission-status')).toBeVisible();
      await emitStreamAction(page, 'follow-up', undefined, {
        user: '已允许本次提交。',
        assistant: 'OA 已受理付款申请，正在核验业务编号和交付物。',
      });
      await expect(page.getByText('OA 已受理付款申请，正在核验业务编号和交付物。')).toBeVisible();
      await expect(projectTaskStatus).toContainText(/已完成|Done/);

      await page.reload();
      await expect(page.getByTestId('conversation-resources-trigger')).toBeVisible();
      await page.getByTestId('attention-inbox-trigger').click();
      const emptyAttentionDrawer = page.getByTestId('attention-inbox-drawer');
      await expect(emptyAttentionDrawer.locator('.arco-empty')).toBeVisible();
      await emptyAttentionDrawer.locator('.arco-drawer-close-icon').click();
      await expect(emptyAttentionDrawer.locator('.arco-drawer-mask')).toBeHidden();
      await page.getByTestId('conversation-resources-trigger').click();
      await expect(page.getByText('payment-review.xlsx')).toBeVisible();
      await expect(page.getByText('OA 生产系统', { exact: true })).toBeVisible();
      await expect(page.getByText('企业付款申请已复核并提交')).toBeVisible();
      await expect
        .poll(() =>
          page.getByTestId('conversation-resources-panel').evaluate((panel) => {
            let current: Element | null = panel;
            while (current) {
              if (Number.parseFloat(window.getComputedStyle(current).opacity || '1') < 1) return false;
              current = current.parentElement;
            }
            return true;
          })
        )
        .toBe(true);
      await takeScreenshot(page, 'enterprise-business-lifecycle/05-task-completed.png');

      expect(taskCompleted).toBe(true);

      expect(interactionCommands).toEqual([
        expect.objectContaining({
          request_id: QUESTION_REQUEST_ID,
          expected_version: 'v1',
          action_id: 'answer',
          idempotency_key: `interaction:${QUESTION_REQUEST_ID}:v1:answer`,
        }),
        expect.objectContaining({
          request_id: PERMISSION_REQUEST_ID,
          expected_version: 'v1',
          action_id: 'proceed_once',
          idempotency_key: `interaction:${PERMISSION_REQUEST_ID}:v1:proceed_once`,
        }),
      ]);
      expect(lifecycleTrace.filter((item) => !item.startsWith('records:'))).toEqual([
        'sync:assistants',
        'sync:skills',
        'sync:mcps',
        'conversation:prepare',
        'conversation:create',
        'task:start',
        `interaction:${QUESTION_REQUEST_ID}:answer`,
        'task:resume:turn-payment-1',
        `interaction:${PERMISSION_REQUEST_ID}:proceed_once`,
        'task:resume:turn-payment-1',
      ]);
      expect(lifecycleTrace).toContain('records:completed');
    } finally {
      await page.unroute('**/api/client-resources/sync', syncHandler);
      await page.unroute('**/api/assistants**', assistantHandler);
      await page.unroute('**/api/skills**', skillsHandler);
      await page.unroute('**/api/mcp/**', mcpHandler);
      await page.unroute('**/api/conversations**', conversationHandler);
      await page.unroute('**/api/interaction-requests**', interactionHandler);
      await page.evaluate((key) => sessionStorage.removeItem(key), E2E_STREAM_KEY);
    }
  });
});
