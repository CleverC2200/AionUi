import { InteractionRequestActions } from '@/common/adapter/interactionRequest';
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

    await expect(actions.submit(command)).resolves.toEqual({ ...receipt, request: authoritativeRequest });
    expect(refreshPending).toHaveBeenCalledTimes(1);
  });
});
