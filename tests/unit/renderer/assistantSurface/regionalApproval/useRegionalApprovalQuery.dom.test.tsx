import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GeaSalesPlanPage, GeaSalesPlanPeriod } from '@/common/adapter/ipcBridge';
import {
  useRegionalApprovalQuery,
  type SalesPlanQueryClient,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/useRegionalApprovalQuery';

const period = (periodId: string, periodMonth: string): GeaSalesPlanPeriod => ({
  periodId,
  tenantId: 'tenant-1',
  periodMonth,
  planType: '月度计划',
  planTypeCode: 'MONTHLY',
  status: 'OPEN',
});

const periodsPage = (records: GeaSalesPlanPeriod[]): GeaSalesPlanPage<GeaSalesPlanPeriod> => ({
  records,
  total: records.length,
  size: 100,
  current: 1,
  pages: 1,
});

const emptyQueue = { records: [], total: 0, size: 20, current: 1, pages: 1 } as const;

describe('useRegionalApprovalQuery refresh', () => {
  it('forwards the applied live organization and status scope to the formal list query', async () => {
    const september = period('period-september', '2026-09');
    const list = vi.fn().mockResolvedValue(emptyQueue);
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodsPage([september])) },
      list: { invoke: list },
    };

    renderHook(() =>
      useRegionalApprovalQuery({
        client,
        page: 1,
        pageSize: 20,
        scope: {
          areaCode: '28',
          provinceCode: '0014',
          orgCode: '052',
          dealerCode: '10151759',
          status: 2,
        },
      })
    );

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          areaCode: '28',
          provinceCode: '0014',
          orgCode: '052',
          dealerCode: '10151759',
          status: 2,
        })
      )
    );
  });

  it('refreshes periods and the current queue once while retaining a period that still exists', async () => {
    const august = period('period-august', '2026-08');
    const september = period('period-september', '2026-09');
    const periods = vi.fn().mockResolvedValue(periodsPage([august, september]));
    const list = vi.fn().mockResolvedValue(emptyQueue);
    const client: SalesPlanQueryClient = { periods: { invoke: periods }, list: { invoke: list } };
    const { result } = renderHook(() => useRegionalApprovalQuery({ client, page: 1, pageSize: 20 }));

    await waitFor(() => expect(result.current.queueState.status).toBe('success'));
    act(() => result.current.selectPeriod(august.periodId));
    await waitFor(() => expect(result.current.selectedPeriod?.periodId).toBe(august.periodId));
    periods.mockClear();
    list.mockClear();

    act(() => result.current.refresh());
    expect(result.current.refreshing).toBe(true);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.refreshing).toBe(false));

    expect(periods).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.current.selectedPeriod?.periodId).toBe(august.periodId);
  });

  it('falls back only when the selected period disappears from the refreshed response', async () => {
    const august = period('period-august', '2026-08');
    const september = period('period-september', '2026-09');
    const periods = vi
      .fn()
      .mockResolvedValueOnce(periodsPage([august, september]))
      .mockResolvedValueOnce(periodsPage([september]));
    const client: SalesPlanQueryClient = {
      periods: { invoke: periods },
      list: { invoke: vi.fn().mockResolvedValue(emptyQueue) },
    };
    const { result } = renderHook(() => useRegionalApprovalQuery({ client, page: 1, pageSize: 20 }));

    await waitFor(() => expect(result.current.queueState.status).toBe('success'));
    act(() => result.current.selectPeriod(august.periodId));
    await waitFor(() => expect(result.current.selectedPeriod?.periodId).toBe(august.periodId));
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.selectedPeriod?.periodId).toBe(september.periodId));
  });

  it('loads permission-scoped status totals in parallel for the aggregate stage board', async () => {
    const september = period('period-september', '2026-09');
    const totals: Record<number, number> = { 1: 2, 2: 2, 3: 1, 4: 4, 6: 1, 7: 1, 8: 0, 9: 0 };
    const list = vi.fn(async (query: Parameters<SalesPlanQueryClient['list']['invoke']>[0] = {}) => ({
      ...emptyQueue,
      total: query.pageSize === 1 ? (query.status === undefined ? 10 : (totals[query.status] ?? 0)) : 10,
    }));
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodsPage([september])) },
      list: { invoke: list },
    };
    const { result } = renderHook(() =>
      useRegionalApprovalQuery({ client, page: 1, pageSize: 20, loadStageProgress: true })
    );

    await waitFor(() => expect(result.current.progressState.status).toBe('success'));
    expect(result.current.progressState.data).toEqual({
      customer: 90,
      region: 70,
      province: 80,
      area: 90,
      category: 60,
    });
    expect(
      list.mock.calls
        .map(([query]) => query)
        .filter((query) => query.pageSize === 1)
        .map((query) => query.status)
        .toSorted((left, right) => (left ?? 0) - (right ?? 0))
    ).toEqual([1, 2, 3, 4, 6, 7, 8, 9, undefined]);
  });

  it('loads enough server pages to merge a two-status node beyond the 200-row API limit', async () => {
    const september = period('period-september', '2026-09');
    const list = vi.fn(async (query: Parameters<SalesPlanQueryClient['list']['invoke']>[0] = {}) => ({
      ...emptyQueue,
      total: query.status === 1 ? 300 : 20,
      size: query.pageSize ?? 20,
      current: query.pageNo ?? 1,
      pages: query.status === 1 ? 2 : 1,
    }));
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodsPage([september])) },
      list: { invoke: list },
    };
    const { result } = renderHook(() =>
      useRegionalApprovalQuery({ client, page: 11, pageSize: 20, stageStatuses: [1, 7] })
    );

    await waitFor(() => expect(result.current.queueState.status).toBe('success'));
    expect(
      list.mock.calls.map(([query]) => ({ status: query.status, pageNo: query.pageNo, pageSize: query.pageSize }))
    ).toEqual(
      expect.arrayContaining([
        { status: 1, pageNo: 1, pageSize: 200 },
        { status: 1, pageNo: 2, pageSize: 200 },
        { status: 7, pageNo: 1, pageSize: 200 },
      ])
    );
  });
});
