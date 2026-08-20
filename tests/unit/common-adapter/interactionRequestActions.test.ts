import { InteractionRequestActions } from '@/common/adapter/interaction-request';
import { describe, expect, it, vi } from 'vitest';

const accepted = {
  receipt_id: 'receipt-1',
  request_id: 'request-1',
  version: 'v2',
  status: 'accepted' as const,
  resolved_at: '2026-08-12T00:00:00.000Z',
};

const command = {
  request_id: 'request-1',
  expected_version: 'v1',
  action_id: 'approve',
  payload: { choice: 'yes' },
};

describe('InteractionRequestActions', () => {
  it('blocks a stale action when the active snapshot freshness is unconfirmed', async () => {
    const submit = vi.fn();
    const preflightActive = vi.fn().mockResolvedValue({
      revision: 'active-failed',
      items: [],
      sync_state: 'failed',
      failed_session_count: 1,
      failure_codes: ['GEA_SESSION_REJECTED'],
    });
    const actions = new InteractionRequestActions({ submit, preflightActive });

    await expect(actions.submit(command)).rejects.toThrow('INTERACTION_REQUEST_STALE');
    expect(submit).not.toHaveBeenCalled();
  });

  it('allows a fresh item from a successful session during partial sync', async () => {
    const submit = vi.fn().mockResolvedValue(accepted);
    const preflightActive = vi.fn().mockResolvedValue({
      revision: 'active-partial',
      items: [
        {
          id: 'request-1',
          version: 'v1',
          kind: 'permission',
          status: 'pending',
          title: 'Run command',
          source: { type: 'business_system' },
          conversation_id: 'conversation-1',
          allowed_actions: ['approve'],
          stale: false,
        },
      ],
      sync_state: 'partial',
      failed_session_count: 1,
      failure_codes: ['GEA_SESSION_REJECTED'],
    });
    const actions = new InteractionRequestActions({ submit, preflightActive });

    await expect(actions.submit(command)).resolves.toEqual(accepted);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('coalesces double submission and keeps one stable idempotency key', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((resolvePromise) => {
      resolve = resolvePromise;
    });
    const submit = vi.fn().mockReturnValue(pending);
    const actions = new InteractionRequestActions({ submit });
    const first = actions.submit(command);
    const second = actions.submit(command);
    resolve(accepted);

    await expect(first).resolves.toEqual(accepted);
    await expect(second).resolves.toEqual(accepted);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      ...command,
      idempotency_key: 'interaction:request-1:v1:approve',
    });
  });

  it('returns the authoritative terminal receipt after remount-like replay', async () => {
    const submit = vi.fn().mockResolvedValue(accepted);
    const actions = new InteractionRequestActions({ submit });
    await actions.submit(command);
    await expect(actions.submit(command)).resolves.toEqual(accepted);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('never retries an unknown external write automatically', async () => {
    const unknown = { ...accepted, status: 'unknown_external_write' as const, resolved_at: undefined };
    const submit = vi.fn().mockResolvedValue(unknown);
    const actions = new InteractionRequestActions({ submit });
    await expect(actions.submit(command)).resolves.toEqual(unknown);
    await expect(actions.submit(command)).resolves.toEqual(unknown);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it.each(['processing', 'failed'] as const)('accepts the v1.1 %s receipt shape', async (status) => {
    const receipt = {
      ...accepted,
      status,
      resolved_at: undefined,
      request: {
        id: 'request-1',
        version: 'v2',
        kind: 'permission',
        status: status === 'processing' ? 'processing' : 'pending',
        title: 'Run command',
        source: { type: 'business_system' },
        conversation_id: 'conversation-1',
        allowed_actions: ['approve'],
      },
    };
    const actions = new InteractionRequestActions({ submit: vi.fn().mockResolvedValue(receipt) });

    await expect(actions.submit(command)).resolves.toMatchObject({ status });
  });

  it('keeps the same idempotency key for an explicit retry after transport failure', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(accepted);
    const actions = new InteractionRequestActions({ submit });
    await expect(actions.submit(command)).rejects.toThrow('offline');
    await expect(actions.submit(command)).resolves.toEqual(accepted);
    expect(submit.mock.calls[0][0].idempotency_key).toBe(submit.mock.calls[1][0].idempotency_key);
  });

  it.each(['conflict', 'expired', 'forbidden'] as const)(
    'does not resubmit a stale command after an authoritative %s receipt',
    async (status) => {
      const receipt = { ...accepted, status, resolved_at: undefined };
      const submit = vi.fn().mockResolvedValue(receipt);
      const actions = new InteractionRequestActions({ submit });

      await expect(actions.submit(command)).resolves.toEqual(receipt);
      await expect(actions.submit(command)).resolves.toEqual(receipt);
      expect(submit).toHaveBeenCalledTimes(1);
    }
  );

  it('refreshes pending state when a conflict receipt omits the authoritative request', async () => {
    const receipt = { ...accepted, status: 'conflict' as const, resolved_at: undefined };
    const authoritativeRequest = {
      id: 'request-1',
      version: 'v2',
      kind: 'permission' as const,
      status: 'pending' as const,
      title: 'Run command',
      source: { type: 'agent' as const },
      conversation_id: 'conversation-1',
      allowed_actions: ['approve'],
      updated_at: '2026-08-12T00:00:01.000Z',
    };
    const refreshPending = vi.fn().mockResolvedValue({ revision: 'pending-r2', items: [authoritativeRequest] });
    const actions = new InteractionRequestActions({ submit: vi.fn().mockResolvedValue(receipt), refreshPending });

    await expect(actions.submit(command)).resolves.toEqual({
      ...receipt,
      request: { ...authoritativeRequest, stale: false },
    });
    expect(refreshPending).toHaveBeenCalledTimes(1);
  });

  it('reconciles a cached conflict again without resubmitting the stale command', async () => {
    const receipt = { ...accepted, status: 'conflict' as const, resolved_at: undefined };
    const authoritativeRequest = {
      id: 'request-1',
      version: 'v2',
      kind: 'permission' as const,
      status: 'pending' as const,
      title: 'Run command',
      source: { type: 'agent' as const },
      conversation_id: 'conversation-1',
      allowed_actions: ['approve'],
      updated_at: '2026-08-12T00:00:01.000Z',
    };
    const submit = vi.fn().mockResolvedValue(receipt);
    const refreshPending = vi
      .fn()
      .mockResolvedValueOnce({ revision: 'pending-r1', items: [] })
      .mockResolvedValueOnce({ revision: 'pending-r2', items: [authoritativeRequest] });
    const actions = new InteractionRequestActions({ submit, refreshPending });

    await expect(actions.submit(command)).resolves.toEqual(receipt);
    await expect(actions.submit(command)).resolves.toEqual({
      ...receipt,
      request: { ...authoritativeRequest, stale: false },
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(refreshPending).toHaveBeenCalledTimes(2);
  });
});
