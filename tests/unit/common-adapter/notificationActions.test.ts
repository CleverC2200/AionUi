import { NotificationActions } from '@/common/adapter/notification-inbox';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { describe, expect, it, vi } from 'vitest';

const receipt = {
  receipt_id: 'receipt-1',
  notification_id: 'notification-1',
  version: 'v2',
  status: 'read' as const,
};

describe('NotificationActions', () => {
  it('coalesces duplicate actions and uses one stable idempotency key', async () => {
    let resolve!: (value: unknown) => void;
    const submit = vi.fn().mockReturnValue(new Promise((done) => (resolve = done)));
    const refresh = vi.fn().mockResolvedValue(undefined);
    const actions = new NotificationActions({ submit, refresh });

    const first = actions.submit({
      scopeId: 'user-1',
      action: 'read',
      notificationId: 'notification-1',
      expectedVersion: 'v1',
    });
    const second = actions.submit({
      scopeId: 'user-1',
      action: 'read',
      notificationId: 'notification-1',
      expectedVersion: 'v1',
    });
    resolve(receipt);

    await expect(first).resolves.toEqual(receipt);
    await expect(second).resolves.toEqual(receipt);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith('read', 'notification-1', {
      expected_version: 'v1',
      idempotency_key: 'notification:notification-1:v1:read',
    });
    expect(refresh).toHaveBeenCalledWith('user-1');
  });

  it('reuses the same backend idempotency key after the in-flight request has completed', async () => {
    const submit = vi.fn().mockResolvedValue(receipt);
    const actions = new NotificationActions({ submit, refresh: vi.fn().mockResolvedValue(undefined) });
    const input = {
      scopeId: 'user-1',
      action: 'read' as const,
      notificationId: 'notification-1',
      expectedVersion: 'v1',
    };

    await actions.submit(input);
    await expect(actions.submit(input)).resolves.toEqual(receipt);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][2]).toEqual(submit.mock.calls[1][2]);
  });

  it('keeps the same key for an explicit retry after a transport failure', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(receipt);
    const actions = new NotificationActions({ submit, refresh: vi.fn().mockResolvedValue(undefined) });
    const input = {
      scopeId: 'user-1',
      action: 'read' as const,
      notificationId: 'notification-1',
      expectedVersion: 'v1',
    };

    await expect(actions.submit(input)).rejects.toThrow('offline');
    await expect(actions.submit(input)).resolves.toEqual(receipt);
    expect(submit.mock.calls[0][2]).toEqual(submit.mock.calls[1][2]);
  });

  it('never coalesces in-flight actions across authenticated user scopes', async () => {
    const submit = vi.fn().mockResolvedValue(receipt);
    const actions = new NotificationActions({ submit, refresh: vi.fn().mockResolvedValue(undefined) });

    await Promise.all([
      actions.submit({
        scopeId: 'user-1',
        action: 'read',
        notificationId: 'notification-1',
        expectedVersion: 'v1',
      }),
      actions.submit({
        scopeId: 'user-2',
        action: 'read',
        notificationId: 'notification-1',
        expectedVersion: 'v1',
      }),
    ]);

    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('refreshes the authoritative snapshot after a version conflict', async () => {
    const conflict = new BackendHttpError({
      method: 'POST',
      path: '/api/notifications/notification-1/read',
      status: 409,
      body: { code: 'GEA_NOTIFICATION_VERSION_CONFLICT' },
    });
    const refresh = vi.fn().mockResolvedValue(undefined);
    const actions = new NotificationActions({ submit: vi.fn().mockRejectedValue(conflict), refresh });

    await expect(
      actions.submit({
        scopeId: 'user-1',
        action: 'read',
        notificationId: 'notification-1',
        expectedVersion: 'v1',
      })
    ).rejects.toBe(conflict);
    expect(refresh).toHaveBeenCalledWith('user-1');
  });
});
