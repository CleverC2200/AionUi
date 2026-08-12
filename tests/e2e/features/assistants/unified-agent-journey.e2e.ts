import type { ElectronApplication, Page, Route } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { closeAssistantEditor, goToAssistantSettings, navigateTo, takeScreenshot } from '../../helpers';

const MANAGED_ASSISTANT_ID = 'enterprise-finance';
const MANAGED_CONVERSATION_ID = 'e2e-managed-conversation';
const MANAGED_REQUEST_ID = 'e2e-managed-request';
const MANAGED_CONFLICT_REQUEST_ID = 'e2e-managed-conflict';
const E2E_STREAM_KEY = 'aionui:e2e-message-stream-conversation-id';

type E2EStreamRegistry = {
  controllers: Record<string, { emitInteractionQuestion: (requestId: string, version?: string) => Promise<void> }>;
};

const managedMetadata = {
  assignment_id: 'assignment-finance',
  template_id: 'finance-close',
  template_version: '1.0.0',
  catalog_revision: 'catalog-e2e-r1',
  activation: 'required' as const,
  state: 'active' as const,
  minimum_client_version: '0.0.1',
  sync_status: 'fresh' as const,
  required_skill_ids: ['finance-close'],
  required_mcp_ids: ['finance-production'],
  user_extensions: { mode: 'additive' as const, allow_skills: true, allow_mcps: true },
  extensions: {
    revision: 'extensions-e2e-r1',
    skill_ids: [],
    mcp_ids: [],
    status: 'active' as const,
    violations: [],
  },
};

const managedAssistant = {
  id: MANAGED_ASSISTANT_ID,
  source: 'managed' as const,
  name: 'Finance Close',
  name_i18n: { 'zh-CN': '财务关账助手' },
  description: 'Governed finance close with protected production capabilities',
  description_i18n: {},
  enabled: true,
  sort_order: 0,
  agent_id: 'finance-agent',
  agent: { type: 'acp', source: 'internal' as const, acp_backend: 'codex' },
  enabled_skills: ['finance-close'],
  custom_skill_names: [],
  disabled_builtin_skills: [],
  context: 'Protected enterprise instructions',
  context_i18n: {},
  prompts: ['Prepare the monthly close'],
  prompts_i18n: {},
  models: [],
  agent_status: 'unchecked' as const,
  team_selectable: true,
  deletable: false,
  managed: managedMetadata,
};

const managedDetail = {
  id: MANAGED_ASSISTANT_ID,
  source: 'managed' as const,
  agent_status: 'unchecked' as const,
  team_selectable: true,
  deletable: false,
  profile: {
    name: managedAssistant.name,
    name_i18n: managedAssistant.name_i18n,
    description: managedAssistant.description,
    description_i18n: {},
  },
  state: { enabled: true, sort_order: 0 },
  engine: { agent_id: 'finance-agent', agent: managedAssistant.agent },
  rules: { content: managedAssistant.context, storage_mode: 'managed' },
  prompts: { recommended: managedAssistant.prompts, recommended_i18n: {} },
  defaults: {
    model: { mode: 'auto' },
    permission: { mode: 'fixed', value: 'acceptEdits' },
    thought_level: { mode: 'auto' },
    skills: { mode: 'fixed', value: ['finance-close'] },
    mcps: { mode: 'fixed', value: ['finance-production'] },
  },
  capabilities: {
    default_skill_ids: ['finance-close'],
    custom_skill_names: [],
    default_disabled_builtin_skill_ids: [],
  },
  preferences: {
    last_skill_ids: [],
    last_disabled_builtin_skill_ids: [],
    last_mcp_ids: [],
  },
  managed: managedMetadata,
};

const managedCatalogRoute = async (route: Route): Promise<void> => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (request.method() !== 'GET') {
    await route.continue();
    return;
  }
  if (pathname.endsWith(`/api/assistants/${MANAGED_ASSISTANT_ID}`)) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(managedDetail) });
    return;
  }
  if (pathname.endsWith('/api/assistants')) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        assistants: [managedAssistant],
        mode: 'managed',
        sync_status: 'fresh',
        revision: 'catalog-e2e-r1',
      }),
    });
    return;
  }
  await route.continue();
};

const setZoomFactor = async (electronApp: ElectronApplication, factor: number): Promise<void> => {
  await electronApp.evaluate(({ BrowserWindow }, nextFactor) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.webContents.isDevToolsOpened());
    window?.webContents.setZoomFactor(nextFactor);
  }, factor);
};

const expectNoPageOverflow = async (page: Page): Promise<void> => {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    .toBe(true);
};

const fulfillJson = (route: Route, data: unknown): Promise<void> =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });

const managedConversation = {
  id: MANAGED_CONVERSATION_ID,
  type: 'acp' as const,
  name: 'Governed finance workflow',
  created_at: 1,
  updated_at: 1,
  extra: {
    workspace: '/tmp/aionui-managed-e2e',
    custom_workspace: true,
    backend: 'codex',
    preset_assistant_id: MANAGED_ASSISTANT_ID,
  },
};

const managedRecords = {
  revision: 1,
  records: [
    {
      id: 'deliverable-1',
      revision: 1,
      record_type: 'deliverable_revision',
      conversation_id: MANAGED_CONVERSATION_ID,
      turn_id: 'turn-managed-1',
      task_id: 'task-close-1',
      producer: { type: 'agent', id: 'finance-agent' },
      created_at: '2026-08-12T00:00:00.000Z',
      deliverable_id: 'finance-close-output',
      status: 'ready',
      resource: { kind: 'file', uri: '/tmp/aionui-managed-e2e/final.xlsx', name: 'final.xlsx' },
    },
    {
      id: 'verification-1',
      revision: 1,
      record_type: 'verification_evidence',
      conversation_id: MANAGED_CONVERSATION_ID,
      turn_id: 'turn-managed-1',
      task_id: 'task-close-1',
      producer: { type: 'aioncore', id: 'aioncore' },
      created_at: '2026-08-12T00:00:30.000Z',
      outcome: 'pass',
      summary: 'Governed checks passed',
      evidence_record_ids: ['deliverable-1'],
    },
    {
      id: 'receipt-1',
      revision: 1,
      record_type: 'completion_receipt',
      conversation_id: MANAGED_CONVERSATION_ID,
      turn_id: 'turn-managed-1',
      task_id: 'task-close-1',
      producer: { type: 'aioncore', id: 'aioncore' },
      created_at: '2026-08-12T00:01:00.000Z',
      definition: 'Production submission verified',
      owner: 'finance-agent',
      status: 'verified',
      evidence_record_ids: ['verification-1'],
    },
  ],
};

const emitInteractionQuestion = async (
  page: Page,
  conversationId: string,
  requestId: string,
  version = 'v1'
): Promise<void> => {
  await page.evaluate(
    async ({ id, nextRequestId, nextVersion }) => {
      const registry = (window as typeof window & { __AIONUI_E2E_MESSAGE_STREAM__?: E2EStreamRegistry })
        .__AIONUI_E2E_MESSAGE_STREAM__;
      const controller = registry?.controllers[id];
      if (!controller) throw new Error(`No E2E stream controller registered for ${id}`);
      await controller.emitInteractionQuestion(nextRequestId, nextVersion);
    },
    { id: conversationId, nextRequestId: requestId, nextVersion: version }
  );
};

test.describe('Unified assistant journey — standard and managed catalogs', () => {
  test.setTimeout(120_000);

  test('standard AionUi keeps the official catalog-to-detail journey', async ({ page, electronApp }) => {
    await setZoomFactor(electronApp, 1);
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToAssistantSettings(page);
    await page.locator('[data-testid="settings-tab-official"]').click();

    const card = page.locator('[data-testid^="official-card-"]').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expectNoPageOverflow(page);
    await takeScreenshot(page, 'unified-agent-journey/standard-catalog-1440x900.png');

    await card.focus();
    await card.press('Enter');
    await expect(page.locator('[data-testid="assistant-editor-page"]')).toBeVisible();
    await takeScreenshot(page, 'unified-agent-journey/standard-detail-1440x900.png');
    await closeAssistantEditor(page);
  });

  test('GEA managed catalog protects core capabilities across the viewport matrix', async ({ page, electronApp }) => {
    let managedDetailRequestCount = 0;
    const managedCatalogHandler = async (route: Route): Promise<void> => {
      if (new URL(route.request().url()).pathname.endsWith(`/api/assistants/${MANAGED_ASSISTANT_ID}`)) {
        managedDetailRequestCount += 1;
      }
      await managedCatalogRoute(route);
    };
    await page.route('**/api/assistants**', managedCatalogHandler);
    try {
      await page.reload();
      await goToAssistantSettings(page);
      await page.locator('[data-testid="settings-tab-official"]').click();

      const card = page.getByTestId(`official-card-${MANAGED_ASSISTANT_ID}`);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText(/Finance Close|财务关账助手/);
      await expect(card).toContainText(/Enterprise managed|企业管理/);
      await expect(page.getByTestId(`switch-enabled-${MANAGED_ASSISTANT_ID}`)).toBeDisabled();
      await expect(page.getByTestId(`menu-duplicate-${MANAGED_ASSISTANT_ID}`)).toHaveCount(0);

      const viewports = [
        { width: 1440, height: 900, zoom: 1, name: 'wide-100' },
        { width: 1440, height: 900, zoom: 1.25, name: 'wide-125' },
        { width: 1024, height: 768, zoom: 1.5, name: 'narrow-150' },
        { width: 720, height: 900, zoom: 2, name: 'high-zoom-200' },
        { width: 390, height: 844, zoom: 1, name: 'mobile-390' },
      ];
      /* eslint-disable no-await-in-loop -- one Electron page must settle each viewport before the next mutation */
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await setZoomFactor(electronApp, viewport.zoom);
        await expect(card).toBeVisible();
        await expectNoPageOverflow(page);
        await takeScreenshot(page, `unified-agent-journey/managed-${viewport.name}.png`);
      }
      /* eslint-enable no-await-in-loop */

      await setZoomFactor(electronApp, 1);
      await page.setViewportSize({ width: 1440, height: 900 });
      await card.focus();
      await card.press('Enter');
      await expect(page.getByTestId('assistant-managed-governance-banner')).toBeVisible();
      await expect.poll(() => managedDetailRequestCount).toBeGreaterThan(0);
      await expect(page.getByTestId('input-assistant-name')).toBeDisabled();
      await expect(page.getByTestId('btn-save-assistant')).toBeEnabled();
      await takeScreenshot(page, 'unified-agent-journey/managed-detail-1440x900.png');
      await closeAssistantEditor(page);
    } finally {
      await setZoomFactor(electronApp, 1);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.unroute('**/api/assistants**', managedCatalogHandler);
    }
  });

  test('GEA managed journey prepares atomically, recovers its turn and verifies delivery', async ({
    page,
    electronApp,
  }) => {
    const pendingRequests = new Map<string, Record<string, unknown>>([
      [
        MANAGED_REQUEST_ID,
        {
          id: MANAGED_REQUEST_ID,
          version: 'v1',
          kind: 'question',
          status: 'pending',
          title: 'Continue finance close',
          summary: 'Return to the original governed turn.',
          source: { type: 'business_system', label: 'Finance production' },
          conversation_id: MANAGED_CONVERSATION_ID,
          turn_id: 'turn-managed-1',
          message_id: `e2e-question-${MANAGED_REQUEST_ID}`,
          allowed_actions: ['answer', 'decline'],
          updated_at: '2026-08-12T00:00:00.000Z',
        },
      ],
    ]);
    let prepareRequest: Record<string, unknown> | undefined;
    let createRequest: Record<string, unknown> | undefined;
    let pendingRefreshCount = 0;
    const interactionCommands: Array<{ request_id: string; expected_version: string }> = [];

    const assistantHandler = async (route: Route): Promise<void> => managedCatalogRoute(route);
    const conversationHandler = async (route: Route): Promise<void> => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST' && pathname === '/api/conversations/prepare') {
        prepareRequest = request.postDataJSON() as Record<string, unknown>;
        await fulfillJson(route, {
          status: 'ready',
          preparation_id: 'preparation-e2e-1',
          revision: 'preparation-e2e-r1',
          expires_at: '2099-08-12T00:05:00.000Z',
          snapshot: {
            schema_version: 1,
            snapshot_id: 'snapshot-e2e-1',
            revision: 'configuration-e2e-r1',
            prepared_at: '2026-08-12T00:00:00.000Z',
            identity_revision: 'identity-e2e-r1',
            assistant: {
              id: MANAGED_ASSISTANT_ID,
              source: 'managed',
              assignment_id: 'assignment-finance',
              template_id: 'finance-close',
              template_version: '1.0.0',
              catalog_revision: 'catalog-e2e-r1',
              extension_revision: 'extensions-e2e-r1',
            },
            agent: { id: 'finance-agent', type: 'acp' },
            skills: [{ id: 'finance-close', version: '1', source: 'enterprise_required' }],
            mcps: [
              {
                id: 'finance-production',
                version: '1',
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
        createRequest = request.postDataJSON() as Record<string, unknown>;
        await fulfillJson(route, managedConversation);
        return;
      }
      if (pathname === `/api/conversations/${MANAGED_CONVERSATION_ID}/records`) {
        await fulfillJson(route, managedRecords);
        return;
      }
      if (pathname === `/api/conversations/${MANAGED_CONVERSATION_ID}/messages`) {
        await fulfillJson(
          route,
          request.method() === 'GET'
            ? { items: [], total: 0, has_more: false }
            : {
                msg_id: 'initial-message-e2e',
                turn_id: 'turn-managed-1',
                runtime: {
                  state: 'running',
                  can_send_message: false,
                  has_task: true,
                  task_status: 'running',
                  is_processing: true,
                  pending_confirmations: 0,
                  turn_id: 'turn-managed-1',
                },
              }
        );
        return;
      }
      if (pathname === `/api/conversations/${MANAGED_CONVERSATION_ID}/confirmations`) {
        await fulfillJson(route, []);
        return;
      }
      if (
        pathname === `/api/conversations/${MANAGED_CONVERSATION_ID}/runtime/ensure` ||
        pathname === `/api/conversations/${MANAGED_CONVERSATION_ID}/active-lease`
      ) {
        await fulfillJson(route, {});
        return;
      }
      if (pathname === `/api/conversations/${MANAGED_CONVERSATION_ID}/slash-commands`) {
        await fulfillJson(route, []);
        return;
      }
      if (request.method() === 'GET' && pathname === `/api/conversations/${MANAGED_CONVERSATION_ID}`) {
        await fulfillJson(route, managedConversation);
        return;
      }
      await route.continue();
    };
    const interactionHandler = async (route: Route): Promise<void> => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'GET') {
        pendingRefreshCount += 1;
        await fulfillJson(route, { revision: `pending-r${pendingRefreshCount}`, items: [...pendingRequests.values()] });
        return;
      }
      const requestId = decodeURIComponent(pathname.split('/').at(-2) ?? '');
      const command = {
        ...(request.postDataJSON() as { expected_version: string }),
        request_id: requestId,
      };
      interactionCommands.push(command);
      if (command.request_id === MANAGED_CONFLICT_REQUEST_ID && command.expected_version === 'v1') {
        pendingRequests.set(MANAGED_CONFLICT_REQUEST_ID, {
          id: MANAGED_CONFLICT_REQUEST_ID,
          version: 'v2',
          kind: 'question',
          status: 'pending',
          title: 'Policy state changed',
          source: { type: 'aioncore', label: 'AionCore' },
          conversation_id: MANAGED_CONVERSATION_ID,
          turn_id: 'turn-managed-2',
          message_id: `e2e-question-${MANAGED_CONFLICT_REQUEST_ID}`,
          allowed_actions: ['answer'],
          updated_at: '2026-08-12T00:02:00.000Z',
        });
        await fulfillJson(route, {
          receipt_id: 'receipt-conflict-e2e',
          request_id: MANAGED_CONFLICT_REQUEST_ID,
          version: 'v2',
          status: 'conflict',
        });
        return;
      }
      pendingRequests.delete(command.request_id);
      await fulfillJson(route, {
        receipt_id: `receipt-${command.request_id}`,
        request_id: command.request_id,
        version: command.expected_version,
        status: 'accepted',
        resolved_at: '2026-08-12T00:03:00.000Z',
      });
    };

    await page.route('**/api/assistants**', assistantHandler);
    await page.route('**/api/conversations**', conversationHandler);
    await page.route('**/api/interaction-requests**', interactionHandler);
    try {
      await setZoomFactor(electronApp, 1);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(({ key, id }) => sessionStorage.setItem(key, id), {
        key: E2E_STREAM_KEY,
        id: MANAGED_CONVERSATION_ID,
      });
      await page.reload();
      await goToAssistantSettings(page);
      await page.getByTestId('settings-tab-official').click();
      const card = page.getByTestId(`official-card-${MANAGED_ASSISTANT_ID}`);
      await card.hover();
      await page.getByTestId(`btn-chat-${MANAGED_ASSISTANT_ID}`).click();

      const guidInput = page.locator('.guid-input-card-shell textarea').first();
      await expect(guidInput).toBeVisible();
      await guidInput.fill('Start the governed finance close');
      await page.getByTestId('guid-send-btn').click();
      await page.waitForURL(new RegExp(`/conversation/${MANAGED_CONVERSATION_ID}$`), { timeout: 15_000 });
      expect(prepareRequest).toEqual(
        expect.objectContaining({ assistant: expect.objectContaining({ id: MANAGED_ASSISTANT_ID, source: 'managed' }) })
      );
      expect(createRequest).toEqual({ preparation: { id: 'preparation-e2e-1', revision: 'preparation-e2e-r1' } });

      await page.waitForFunction(
        (id) =>
          Boolean(
            (window as typeof window & { __AIONUI_E2E_MESSAGE_STREAM__?: E2EStreamRegistry })
              .__AIONUI_E2E_MESSAGE_STREAM__?.controllers[id]
          ),
        MANAGED_CONVERSATION_ID,
        { timeout: 15_000 }
      );
      await emitInteractionQuestion(page, MANAGED_CONVERSATION_ID, MANAGED_REQUEST_ID);
      await expect(page.getByTestId('message-question')).toBeVisible();

      await page.getByTestId('attention-inbox-trigger').click();
      await page.getByTestId(`attention-request-${MANAGED_REQUEST_ID}`).click();
      await expect(page.getByTestId(`message-question-option-0-Continue`)).toBeVisible();
      await page.getByTestId(`message-question-option-0-Continue`).click();
      await page.getByTestId('message-question-submit').click();
      await expect.poll(() => interactionCommands.length).toBe(1);
      await expect(page.getByTestId('message-question-status')).toBeVisible();

      await emitInteractionQuestion(page, MANAGED_CONVERSATION_ID, MANAGED_CONFLICT_REQUEST_ID);
      const conflictQuestion = page.getByTestId('message-question').last();
      await conflictQuestion.getByTestId('message-question-option-0-Continue').click();
      await conflictQuestion.getByTestId('message-question-submit').click();
      await expect.poll(() => interactionCommands.length).toBe(2);
      await expect.poll(() => pendingRefreshCount).toBeGreaterThan(1);
      await expect(conflictQuestion.getByTestId('message-question-submit')).toBeEnabled();
      await conflictQuestion.getByTestId('message-question-submit').click();
      await expect.poll(() => interactionCommands.length).toBe(3);
      await expect(conflictQuestion.getByTestId('message-question-status')).toBeVisible();

      await page.getByTestId('conversation-resources-trigger').click();
      await expect(page.getByText('final.xlsx')).toBeVisible();
      await expect(page.getByText('Production submission verified')).toBeVisible();
      await takeScreenshot(page, 'unified-agent-journey/managed-journey-complete.png');
    } finally {
      await page.unroute('**/api/assistants**', assistantHandler);
      await page.unroute('**/api/conversations**', conversationHandler);
      await page.unroute('**/api/interaction-requests**', interactionHandler);
      await page.evaluate((key) => sessionStorage.removeItem(key), E2E_STREAM_KEY);
    }
  });

  test('Team reuses member conversations and one aggregated record inspector', async ({ page, electronApp }) => {
    const teamId = 'e2e-unified-team';
    const team = {
      id: teamId,
      user_id: 'system_default_user',
      name: 'Unified E2E Team',
      workspace: '/tmp/aionui-team-e2e',
      workspace_mode: 'shared',
      leader_agent_id: 'slot-lead',
      agents: [
        {
          slot_id: 'slot-lead',
          conversation_id: 'team-lead-conversation',
          role: 'lead',
          name: 'Leader',
          backend: 'codex',
          assistant_id: MANAGED_ASSISTANT_ID,
          status: 'idle',
        },
        {
          slot_id: 'slot-member',
          conversation_id: 'team-member-conversation',
          role: 'teammate',
          name: 'Analyst',
          backend: 'codex',
          assistant_id: MANAGED_ASSISTANT_ID,
          status: 'idle',
        },
      ],
      created_at: 1,
      updated_at: 1,
    };
    const teamHandler = async (route: Route): Promise<void> => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'GET' && pathname === `/api/teams/${teamId}`) {
        await fulfillJson(route, team);
        return;
      }
      if (pathname === `/api/teams/${teamId}/work/snapshot`) {
        await fulfillJson(route, { team_id: teamId, sequence: 1, generated_at: 1, tasks: [], runs: [], attention: [] });
        return;
      }
      if (pathname === `/api/teams/${teamId}/work/events`) {
        await fulfillJson(route, { team_id: teamId, from_sequence: 1, to_sequence: 1, events: [] });
        return;
      }
      if (pathname === `/api/teams/${teamId}/run-state`) {
        await fulfillJson(route, { session_generation: null, active_run: null, slot_work: [] });
        return;
      }
      if (
        pathname === `/api/teams/${teamId}/session` ||
        pathname === `/api/teams/${teamId}/active-lease` ||
        pathname.includes('/config-options')
      ) {
        await fulfillJson(route, pathname.includes('/config-options') ? { options: [] } : {});
        return;
      }
      await route.continue();
    };
    const teamConversationHandler = async (route: Route): Promise<void> => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const conversationId = pathname.includes('team-lead-conversation')
        ? 'team-lead-conversation'
        : pathname.includes('team-member-conversation')
          ? 'team-member-conversation'
          : null;
      if (!conversationId) {
        await route.continue();
        return;
      }
      if (pathname.endsWith('/records')) {
        const isLead = conversationId === 'team-lead-conversation';
        await fulfillJson(route, {
          revision: 1,
          records: [
            {
              id: isLead ? 'lead-source' : 'member-source',
              revision: 1,
              record_type: 'context_evidence',
              conversation_id: conversationId,
              turn_id: isLead ? 'turn-lead' : 'turn-member',
              task_id: 'task-team-1',
              producer: { type: 'team_agent', id: isLead ? 'slot-lead' : 'slot-member' },
              created_at: '2026-08-12T00:00:00.000Z',
              resource: {
                kind: 'url',
                uri: isLead ? 'https://leader.example/evidence' : 'https://member.example/evidence',
                name: isLead ? 'Leader evidence' : 'Member evidence',
              },
            },
          ],
        });
        return;
      }
      if (pathname.endsWith('/messages')) {
        await fulfillJson(route, { items: [], total: 0, has_more: false });
        return;
      }
      if (pathname.endsWith('/confirmations')) {
        await fulfillJson(route, []);
        return;
      }
      if (pathname.endsWith('/active-lease') || pathname.endsWith('/runtime/ensure')) {
        await fulfillJson(route, {});
        return;
      }
      if (request.method() === 'GET' && pathname === `/api/conversations/${conversationId}`) {
        await fulfillJson(route, {
          id: conversationId,
          type: 'acp',
          name: conversationId,
          created_at: 1,
          updated_at: 1,
          extra: { workspace: '/tmp/aionui-team-e2e', backend: 'codex' },
        });
        return;
      }
      await route.continue();
    };

    await page.route(`**/api/teams/${teamId}**`, teamHandler);
    await page.route('**/api/conversations/team-*-conversation**', teamConversationHandler);
    try {
      await setZoomFactor(electronApp, 1);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate((id) => localStorage.setItem(`team-view-mode-${id}`, 'parallel'), teamId);
      await navigateTo(page, `#/team/${teamId}`);
      await expect(page.locator('[data-testid="team-agent-header"]')).toHaveCount(2, { timeout: 15_000 });
      await page.getByTestId('conversation-resources-trigger').first().click();
      await expect(page.getByTestId('team-resource-active-filter')).toContainText('Leader');
      await expect(page.getByText('Leader evidence')).toBeVisible();
      await page.getByTestId('team-resource-filter-all').click();
      await expect(page.getByText('Member evidence')).toBeVisible();

      await page.setViewportSize({ width: 390, height: 844 });
      await expectNoPageOverflow(page);
      await expect(page.locator('[data-testid="team-agent-header"]:visible')).toHaveCount(1);
      await takeScreenshot(page, 'unified-agent-journey/managed-team-390.png');
    } finally {
      await setZoomFactor(electronApp, 1);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.unroute(`**/api/teams/${teamId}**`, teamHandler);
      await page.unroute('**/api/conversations/team-*-conversation**', teamConversationHandler);
    }
  });
});
