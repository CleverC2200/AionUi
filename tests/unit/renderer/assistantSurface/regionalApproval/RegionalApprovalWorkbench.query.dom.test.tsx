import type { TFunction } from 'i18next';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { GeaSalesPlanListItem, GeaSalesPlanPage, GeaSalesPlanPageQuery } from '@/common/adapter/ipcBridge';
import RegionalApprovalWorkbench, {
  type RegionalApprovalWorkbenchContext,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/RegionalApprovalWorkbench';
import type { SalesPlanQueryClient } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/useRegionalApprovalQuery';
import zhCN from '@/renderer/services/i18n/locales/zh-CN/common.json';

vi.mock('@/renderer/pages/assistantSurface/components/BusinessSurfaceShell', () => ({
  useBusinessSurfaceSession: () => ({ conversationId: 'conversation-query' }),
}));

const t = ((key: string, options?: Record<string, string | number>) => {
  const value = key
    .replace(/^common\./, '')
    .split('.')
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[segment];
    }, zhCN);
  return Object.entries(options ?? {}).reduce(
    (text, [name, replacement]) => text.replaceAll(`{{${name}}}`, String(replacement)),
    typeof value === 'string' ? value : key
  );
}) as TFunction;

const periodPage = {
  records: [
    {
      periodId: '9007199254740993',
      tenantId: '9007199254740994',
      periodMonth: '2026-08',
      planType: '月度计划',
      planTypeCode: 'MONTHLY',
      status: 'CLOSED',
    },
    {
      periodId: '9007199254740995',
      tenantId: '9007199254740994',
      periodMonth: '2026-09',
      planType: '月度计划',
      planTypeCode: 'MONTHLY',
      status: 'OPEN',
    },
  ],
  total: 2,
  size: 100,
  current: 1,
  pages: 1,
};

const liveRow = (planId: string, status = 4): GeaSalesPlanListItem => ({
  planId,
  versionId: `${planId}-version`,
  seq: 3,
  periodId: '9007199254740995',
  planTypeCode: 'MONTHLY',
  dealerCode: '9007199254740997',
  orgCode: 'ORG-001',
  provinceCode: 'PROVINCE-01',
  areaCode: 'AREA-01',
  regionName: '华东大区',
  provinceRegionName: '浙江省区',
  salesGroupName: `${planId} 经销分区`,
  baseName: `${planId} 基地`,
  dealerName: `${planId} 经销商`,
  status,
  returnReason: null,
  targetQty: '123456789012.345',
  targetAmount: '9999999999999999.99',
  skuCount: 3,
  currentQty: '123456789012.340',
  currentAmount: '9999999999999999.90',
});

const queuePage = (
  records: GeaSalesPlanListItem[],
  pagination: Partial<Pick<GeaSalesPlanPage<GeaSalesPlanListItem>, 'total' | 'size' | 'current' | 'pages'>> = {}
): GeaSalesPlanPage<GeaSalesPlanListItem> => ({
  records,
  total: pagination.total ?? records.length,
  size: pagination.size ?? 20,
  current: pagination.current ?? 1,
  pages: pagination.pages ?? 1,
});

const filteredRows = (rows: readonly GeaSalesPlanListItem[], query?: GeaSalesPlanPageQuery) =>
  rows.filter(
    (row) =>
      (query?.status === undefined || row.status === query.status) &&
      (query?.areaCode === undefined || row.areaCode === query.areaCode) &&
      (query?.provinceCode === undefined || row.provinceCode === query.provinceCode) &&
      (query?.orgCode === undefined || row.orgCode === query.orgCode) &&
      (query?.dealerCode === undefined || row.dealerCode === query.dealerCode)
  );

const listMockFor = (rows: readonly GeaSalesPlanListItem[]) =>
  vi.fn(async (query?: GeaSalesPlanPageQuery) => {
    const matches = filteredRows(rows, query);
    if (query?.pageSize === 1) return queuePage([], { total: matches.length, size: 1 });
    return queuePage(matches, {
      total: matches.length,
      size: query?.pageSize ?? 20,
      current: query?.pageNo ?? 1,
    });
  });

describe('RegionalApprovalWorkbench live sales-plan query', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('keeps the production workbench fail-closed while preserving readable GEA evidence and Context', async () => {
    const onContextChange = vi.fn<(context: RegionalApprovalWorkbenchContext, conversationId: string | null) => void>();
    const list = listMockFor([liveRow('plan-live', 2)]);
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: list },
    };

    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-authority'
        t={t}
        onContextChange={onContextChange}
        queryClient={client}
      />
    );

    expect((await screen.findAllByText('plan-live 基地'))[0]).toBeVisible();
    expect(screen.getByTestId('regional-approval-current-stage')).toHaveTextContent('待服务端确认职责节点');
    expect(screen.queryByText('审批操作已安全关闭')).not.toBeInTheDocument();
    const toolbarActions = screen.getByTestId('regional-approval-toolbar-actions');
    expect(within(toolbarActions).getByRole('button', { name: '通过' })).toBeDisabled();
    expect(within(toolbarActions).getByRole('button', { name: '退回' })).toBeDisabled();
    expect(screen.queryByRole('columnheader', { name: '审批操作' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '业务范围' })).not.toBeInTheDocument();
    expect(screen.getByText('plan-live 经销分区')).toBeVisible();
    expect(screen.getByText('9007199254740997')).toBeVisible();
    expect(screen.queryByText('经销商 9007199254740997')).not.toBeInTheDocument();
    expect(screen.getByTestId('regional-approval-scope-plan-live')).toHaveTextContent(
      '华东大区 / 浙江省区 / plan-live 基地'
    );
    expect(screen.queryByText('AREA-01')).not.toBeInTheDocument();
    expect(screen.queryByText('PROVINCE-01 · ORG-001')).not.toBeInTheDocument();
    expect(screen.getByRole('radio')).toBeDisabled();
    expect(screen.getByRole('button', { name: '查看 plan-live 经销分区 真实计划详情' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '版本对比' })).toBeDisabled();
    expect(screen.queryByRole('tablist', { name: '审批队列维度' })).not.toBeInTheDocument();
    expect(screen.queryByText('GEA · 用户会话队列')).not.toBeInTheDocument();

    await waitFor(() =>
      expect(onContextChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          fixtureState: 'live',
          visibleEntities: [
            expect.objectContaining({
              id: 'plan-live',
              organizationKey: 'plan-live 基地',
              currentQty: '123456789012.340',
              currentAmount: '9999999999999999.90',
              targetQty: '123456789012.345',
              targetAmount: '9999999999999999.99',
              versionId: 'plan-live-version',
            }),
          ],
          evidence: expect.objectContaining({
            source: 'gea-user-session',
            permission: 'read-only',
            completeness: 'paged-queue',
            queryState: 'success',
          }),
          changes: [],
          localApprovalResults: [],
          metrics: expect.objectContaining({ savedAdjustmentCount: 0, localApprovalResultCount: 0 }),
          authority: expect.objectContaining({
            source: 'gea-user-session-query',
            filterSummary: expect.objectContaining({
              periodMonth: '2026-09',
              approvalStage: 'all',
              queueMode: 'approval',
            }),
          }),
          scope: expect.objectContaining({ approvalStage: 'all' }),
        }),
        'conversation-query'
      )
    );
  });

  it('treats the five progress nodes as independent aggregate filters', async () => {
    const rows = [
      liveRow('region-pending', 1),
      liveRow('region-returned', 7),
      liveRow('customer-returned', 6),
      liveRow('category-pending', 4),
    ];
    const list = listMockFor(rows);
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: list },
    };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-stage-filter'
        t={t}
        onContextChange={vi.fn()}
        queryClient={client}
      />
    );

    expect((await screen.findAllByText('region-pending 基地'))[0]).toBeVisible();
    await waitFor(() => expect(screen.getByTestId('regional-approval-stage-region')).toHaveTextContent('进度 50%'));
    expect(screen.getByTestId('regional-approval-stage-region')).toHaveAttribute('data-state', 'partial');
    expect(screen.getByTestId('regional-approval-stage-province')).toHaveTextContent('进度 100%');

    fireEvent.click(screen.getByTestId('regional-approval-stage-region'));
    await waitFor(() => {
      expect(list.mock.calls.some(([query]) => query?.status === 1 && query.pageSize === 20)).toBe(true);
      expect(list.mock.calls.some(([query]) => query?.status === 7 && query.pageSize === 20)).toBe(true);
    });
    expect(screen.getByTestId('regional-approval-stage-region')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('region-pending 基地')[0]).toBeVisible();
    expect(screen.getAllByText('region-returned 基地')[0]).toBeVisible();
    expect(screen.queryByText('customer-returned 基地')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('regional-approval-stage-region'));
    await waitFor(() => expect(screen.getAllByText('category-pending 基地')[0]).toBeVisible());
    expect(screen.getByTestId('regional-approval-stage-region')).toHaveAttribute('aria-pressed', 'false');
  });

  it('applies organization and status filters without deriving approval authority', async () => {
    const list = listMockFor([liveRow('plan-filtered', 2)]);
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: list },
    };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-filters'
        t={t}
        onContextChange={vi.fn()}
        queryClient={client}
      />
    );

    expect((await screen.findAllByText('plan-filtered 基地'))[0]).toBeVisible();
    fireEvent.click(screen.getByRole('combobox', { name: '大区' }));
    fireEvent.click(await screen.findByRole('option', { name: 'AREA-01' }));
    fireEvent.click(screen.getByRole('combobox', { name: '审批状态' }));
    fireEvent.click(await screen.findByRole('option', { name: '区域审批' }));
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    await waitFor(() =>
      expect(
        list.mock.calls.some(
          ([query]) =>
            query?.areaCode === 'AREA-01' && query.status === 2 && query.pageNo === 1 && query.pageSize === 20
        )
      ).toBe(true)
    );
    expect(screen.getByTestId('regional-approval-current-stage')).toHaveTextContent('待服务端确认职责节点');
  });

  it('normalizes numeric decimal fields returned by the live list response', async () => {
    const numericRow = {
      ...liveRow('plan-numeric', 2),
      targetQty: 2075,
      targetAmount: 142500,
      currentQty: 2075,
      currentAmount: 141862.04,
    } as unknown as GeaSalesPlanListItem;
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: listMockFor([numericRow]) },
    };

    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-numeric-decimals'
        t={t}
        onContextChange={vi.fn()}
        queryClient={client}
      />
    );

    expect((await screen.findAllByText('plan-numeric 基地'))[0]).toBeVisible();
    expect(screen.getAllByText(/141,862\.04/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/目标 2,075 · ¥142,500/).length).toBeGreaterThan(0);
  });

  it('refreshes periods and queue, and keeps an honest empty state', async () => {
    const periods = vi.fn().mockResolvedValue(periodPage);
    const list = listMockFor([]);
    const client: SalesPlanQueryClient = { periods: { invoke: periods }, list: { invoke: list } };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-empty'
        t={t}
        onContextChange={vi.fn()}
        queryClient={client}
      />
    );

    expect(await screen.findByText('当前账户在本周期没有可见审批数据。')).toBeVisible();
    const refresh = screen.getByRole('button', { name: '刷新数据' });
    fireEvent.click(refresh);
    await waitFor(() => expect(periods).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(list.mock.calls.filter(([query]) => query?.pageSize === 20 && query.status === undefined)).toHaveLength(2)
    );
  });

  it('keeps a loaded period on queue failure and retries only the queue', async () => {
    let mainCalls = 0;
    const list = vi.fn(async (query?: GeaSalesPlanPageQuery) => {
      if (query?.pageSize === 1) return queuePage([], { total: 0, size: 1 });
      mainCalls += 1;
      if (mainCalls === 1) throw new TypeError('network disconnected');
      return queuePage([]);
    });
    const periods = vi.fn().mockResolvedValue(periodPage);
    const client: SalesPlanQueryClient = { periods: { invoke: periods }, list: { invoke: list } };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-retry'
        t={t}
        onContextChange={vi.fn()}
        queryClient={client}
      />
    );

    expect(await screen.findByText('销售计划服务暂时不可用；已保留当前筛选与周期。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('当前账户在本周期没有可见审批数据。')).toBeVisible();
    expect(periods).toHaveBeenCalledTimes(1);
    expect(mainCalls).toBe(2);
  });

  it.each([
    [401, 'GEA 用户会话已过期，请重新登录后重试。'],
    [403, '当前账号没有读取该销售计划范围的权限。'],
  ] as const)('shows the localized read-only period error for HTTP %s', async (status, message) => {
    const client: SalesPlanQueryClient = {
      periods: {
        invoke: vi
          .fn()
          .mockRejectedValue(
            new BackendHttpError({ method: 'GET', path: '/api/gea/sales-plan/periods', status, body: {} })
          ),
      },
      list: { invoke: vi.fn() },
    };
    render(
      <RegionalApprovalWorkbench
        stateScope={`user:forecast-live-error-${status}`}
        t={t}
        onContextChange={vi.fn()}
        queryClient={client}
      />
    );

    expect(await screen.findByText(message)).toBeVisible();
    expect(client.list.invoke).not.toHaveBeenCalled();
  });

  it('keeps the server pagination authoritative', async () => {
    const list = vi.fn(async (query?: GeaSalesPlanPageQuery) => {
      if (query?.pageSize === 1) return queuePage([], { total: 20, size: 1 });
      const current = query?.pageNo ?? 1;
      return queuePage([liveRow(`page-${current}`)], { total: 20, current, pages: 10, size: 2 });
    });
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: list },
    };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-pagination'
        t={t}
        onContextChange={vi.fn()}
        queryClient={client}
      />
    );

    expect((await screen.findAllByText('page-1 基地'))[0]).toBeVisible();
    fireEvent.click(
      within(screen.getByTestId('regional-approval-queue-footer')).getByText('3', {
        selector: '.arco-pagination-item',
      })
    );
    expect((await screen.findAllByText('page-3 基地'))[0]).toBeVisible();
    expect(list.mock.calls.some(([query]) => query?.pageNo === 3 && query.pageSize === 20)).toBe(true);
  });
});
