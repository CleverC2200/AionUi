import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncFromGea: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    clientResources: {
      syncFromGea: { invoke: mocks.syncFromGea },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`),
  }),
}));

import { useGeaResourceSync } from '@/renderer/hooks/system/useGeaResourceSync';

describe('useGeaResourceSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs one resource kind and refreshes its existing AionCore projection', async () => {
    mocks.syncFromGea.mockResolvedValue({ status: 'completed', changed: 2, skipped: 0, failed: 0 });
    const message = { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() };
    const refresh = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useGeaResourceSync({ message, refresh, resource: 'skills' }));

    await act(async () => result.current.syncFromGea());

    expect(mocks.syncFromGea).toHaveBeenCalledWith({ resources: ['skills'] });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(message.success).toHaveBeenCalledWith('settings.geaResourceFetchSuccess:2');
  });

  it('does not refresh when GEA authentication is missing', async () => {
    mocks.syncFromGea.mockResolvedValue({
      status: 'notAuthenticated',
      changed: 0,
      skipped: 0,
      failed: 0,
    });
    const message = { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() };
    const refresh = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useGeaResourceSync({ message, refresh, resource: 'assistants' }));

    await act(async () => result.current.syncFromGea());

    expect(refresh).not.toHaveBeenCalled();
    expect(message.warning).toHaveBeenCalledWith('settings.geaResourceLoginRequired');
  });

  it('shows a compatibility error when the current AionCore has no sync route', async () => {
    mocks.syncFromGea.mockRejectedValue(
      Object.assign(new Error('missing'), { name: 'BackendHttpError', status: 404, code: 'NOT_FOUND' })
    );
    const message = { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() };
    const refresh = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useGeaResourceSync({ message, refresh, resource: 'mcps' }));

    await act(async () => result.current.syncFromGea());

    expect(refresh).not.toHaveBeenCalled();
    expect(message.error).toHaveBeenCalledWith('settings.geaResourceUnavailable');
  });

  it('does not report sync success when the refreshed projection is unavailable', async () => {
    mocks.syncFromGea.mockResolvedValue({ status: 'completed', changed: 2, skipped: 0, failed: 0 });
    const message = { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() };
    const refresh = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() => useGeaResourceSync({ message, refresh, resource: 'assistants' }));

    await act(async () => result.current.syncFromGea());

    expect(message.success).not.toHaveBeenCalled();
    expect(message.error).toHaveBeenCalledWith('settings.geaResourceFetchFailed');
  });

  it('coalesces calls made before React can publish the syncing state', async () => {
    let resolveSync:
      | ((value: { status: 'completed'; changed: number; skipped: number; failed: number }) => void)
      | null = null;
    mocks.syncFromGea.mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      })
    );
    const message = { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() };
    const refresh = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useGeaResourceSync({ message, refresh, resource: 'mcps' }));

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current.syncFromGea();
      second = result.current.syncFromGea();
    });

    expect(mocks.syncFromGea).toHaveBeenCalledTimes(1);
    resolveSync?.({ status: 'completed', changed: 0, skipped: 0, failed: 0 });
    await act(async () => Promise.all([first, second]));
  });
});
