import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSalesPlanAction } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/hooks/useSalesPlanAction';
import type { SalesPlanActionClient } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/models/salesPlanActionModel';

const input = {
  planId: 'plan-1',
  versionId: 'version-1',
  request: { action: 'APPROVE' as const, expectedStatus: 4, remark: '同意' },
};

const receipt = {
  planId: 'plan-1',
  versionId: 'version-1',
  fromStatus: 4,
  toStatus: 5,
  replayed: false,
  requestId: 'request-1',
  traceId: 'trace-1',
  auditId: 'audit-1',
};

describe('useSalesPlanAction', () => {
  it('exposes one loading operation and settles a double click from one authoritative receipt', async () => {
    let resolve!: (value: typeof receipt) => void;
    let command!: Parameters<SalesPlanActionClient['action']['invoke']>[0];
    const invoke = vi.fn(
      (params: Parameters<SalesPlanActionClient['action']['invoke']>[0]) =>
        new Promise<typeof receipt>((resolvePromise) => {
          command = params;
          resolve = resolvePromise;
        })
    );
    const client: SalesPlanActionClient = { action: { invoke } };
    const { result } = renderHook(() => useSalesPlanAction({ client }));

    let first!: Promise<typeof receipt>;
    let duplicate!: Promise<typeof receipt>;
    act(() => {
      first = result.current.execute(input);
      duplicate = result.current.execute(input);
    });
    expect(result.current.state.status).toBe('loading');
    expect(invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ ...receipt, requestId: command.requestId });
      await Promise.all([first, duplicate]);
    });
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'success',
        receipt: { ...receipt, requestId: command.requestId },
      })
    );
  });

  it('surfaces a permission denial without converting it into a retryable action', async () => {
    const backendError = Object.assign(new Error('forbidden'), {
      name: 'BackendHttpError',
      status: 403,
      code: 'FORBIDDEN',
    });
    const client: SalesPlanActionClient = { action: { invoke: vi.fn().mockRejectedValue(backendError) } };
    const { result } = renderHook(() => useSalesPlanAction({ client }));

    await act(async () => {
      await expect(result.current.execute(input)).rejects.toMatchObject({ kind: 'permission', retrySameIntent: false });
    });
    expect(result.current.state).toMatchObject({
      status: 'error',
      error: { kind: 'permission', retrySameIntent: false },
    });
  });

  it('keeps submitter return status 6 outside the user approval action', async () => {
    const expectedStatus = 6;
    const invoke = vi.fn<SalesPlanActionClient['action']['invoke']>();
    const client: SalesPlanActionClient = { action: { invoke } };
    const { result } = renderHook(() => useSalesPlanAction({ client }));

    await act(async () => {
      await expect(
        result.current.execute({ ...input, request: { action: 'APPROVE', expectedStatus } })
      ).rejects.toMatchObject({ kind: 'validation', retrySameIntent: false });
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it('submits area-returned status 8 from its current province node', async () => {
    const invoke = vi.fn<SalesPlanActionClient['action']['invoke']>(async (params) => ({
      ...receipt,
      fromStatus: 8,
      toStatus: 3,
      requestId: params.requestId,
    }));
    const { result } = renderHook(() => useSalesPlanAction({ client: { action: { invoke } } }));

    await act(async () => {
      await expect(
        result.current.execute({ ...input, request: { action: 'APPROVE', expectedStatus: 8 } })
      ).resolves.toMatchObject({ fromStatus: 8, toStatus: 3 });
    });

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ request: { action: 'APPROVE', expectedStatus: 8 } }));
  });
});
