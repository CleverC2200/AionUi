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
});
