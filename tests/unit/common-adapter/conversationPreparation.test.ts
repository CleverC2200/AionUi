import { ConversationPreparation } from '@/common/adapter/conversation';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { managedConversationBlocked, managedConversationReady } from '../../fixtures/conversationConfiguration';
import { describe, expect, it, vi } from 'vitest';

const standardAssistant = { id: 'builtin-writer', source: 'builtin' } as Assistant;
const managedAssistant = {
  id: 'enterprise-finance',
  source: 'managed',
  managed: {
    assignment_id: 'assignment-finance',
    template_id: 'finance-close',
    template_version: '1.0.0',
    catalog_revision: 'catalog-r1',
    activation: 'required',
    state: 'active',
    minimum_client_version: '2.1.53',
    sync_status: 'fresh',
    required_skill_ids: ['finance-close'],
    required_mcp_ids: ['finance-production'],
    user_extensions: { mode: 'additive', allow_skills: true, allow_mcps: true },
    extensions: {
      revision: 'extension-r1',
      skill_ids: ['spreadsheet-helper'],
      mcp_ids: [],
      status: 'active',
      violations: [],
    },
  },
} as Assistant;

const input = (assistant: Assistant) => ({
  assistant,
  locale: 'zh-CN',
  idempotencyKey: 'prepare-1',
  workspace: '/workspace',
  overrides: {
    model: 'enterprise/default',
    permission: 'controlled',
    skill_ids: ['finance-close', 'spreadsheet-helper'],
    mcp_ids: ['finance-production'],
  },
});

const createDeferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('ConversationPreparation', () => {
  it('keeps standard assistants on the existing behavior-equivalent path', async () => {
    const prepare = vi.fn();
    const result = await new ConversationPreparation({ prepare }).prepare(input(standardAssistant));
    expect(result).toEqual({ status: 'ready', mode: 'standard', preparation: null, snapshot: null });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('publishes only a fully validated managed preparation', async () => {
    const prepare = vi.fn().mockResolvedValue(managedConversationReady);
    const result = await new ConversationPreparation({ prepare }).prepare(input(managedAssistant));
    expect(result).toMatchObject({
      status: 'ready',
      mode: 'managed',
      preparation: { id: 'preparation-1', revision: 'preparation-r1' },
      snapshot: { snapshot_id: 'snapshot-1', assistant: { template_version: '1.0.0' } },
    });
    expect(prepare).toHaveBeenCalledWith({
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
      overrides: input(managedAssistant).overrides,
    });
  });

  it('does not turn a blocked response or last-good evidence into a runnable preparation', async () => {
    const prepare = vi
      .fn()
      .mockResolvedValueOnce(managedConversationReady)
      .mockResolvedValueOnce(managedConversationBlocked);
    const module = new ConversationPreparation({ prepare });
    await module.prepare(input(managedAssistant));
    const blocked = await module.prepare({ ...input(managedAssistant), idempotencyKey: 'prepare-2' });

    expect(blocked).toMatchObject({
      status: 'blocked',
      issues: [{ code: 'MCP_AUTH_REQUIRED' }],
      last_good_snapshot: { snapshot_id: 'snapshot-1' },
    });
    expect(blocked).not.toHaveProperty('preparation');
  });

  it('cancels stale concurrent results so only the latest revision can be consumed', async () => {
    const first = createDeferred();
    const prepare = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        ...managedConversationReady,
        preparation_id: 'preparation-2',
        revision: 'preparation-r2',
      });
    const module = new ConversationPreparation({ prepare });
    const firstResult = module.prepare(input(managedAssistant));
    const secondResult = module.prepare({ ...input(managedAssistant), idempotencyKey: 'prepare-2' });
    first.resolve(managedConversationReady);

    await expect(firstResult).resolves.toEqual({ status: 'cancelled' });
    await expect(secondResult).resolves.toMatchObject({
      status: 'ready',
      preparation: { id: 'preparation-2', revision: 'preparation-r2' },
    });
  });

  it('supports explicit cancellation without exposing the late response', async () => {
    const pending = createDeferred();
    const module = new ConversationPreparation({ prepare: vi.fn().mockReturnValue(pending.promise) });
    const result = module.prepare(input(managedAssistant));
    module.cancel();
    await expect(result).resolves.toEqual({ status: 'cancelled' });
    pending.resolve(managedConversationReady);
  });

  it('rejects secret-bearing snapshots at the adapter boundary', async () => {
    const module = new ConversationPreparation({
      prepare: vi.fn().mockResolvedValue({ ...managedConversationReady, api_token: 'must-not-cross' }),
    });
    await expect(module.prepare(input(managedAssistant))).rejects.toThrow('CONVERSATION_CONFIGURATION_SENSITIVE_FIELD');
  });
});
