import type { TFunction } from 'i18next';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import zhCN from '@/renderer/services/i18n/locales/zh-CN/common.json';
import RegionalApprovalWorkbench, {
  type RegionalApprovalWorkbenchContext,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/RegionalApprovalWorkbench';
import type { SalesPlanQueryClient } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/useRegionalApprovalQuery';
import type {
  GeaSalesPlanDetail,
  GeaSalesPlanListItem,
  GeaSalesPlanPage,
  GeaSalesPlanSku,
} from '@/common/adapter/ipcBridge';
import type { SalesPlanActionClient } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/models/salesPlanActionModel';
import type { SalesPlanSubmitClient } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/models/salesPlanSubmitModel';
import {
  getAssistantSurfaceWorkbenchScope,
  writeAssistantSurfaceState,
} from '@/renderer/pages/assistantSurface/storage';

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
  baseName: `${planId} 基地`,
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
  size: pagination.size ?? 2,
  current: pagination.current ?? 1,
  pages: pagination.pages ?? 1,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('RegionalApprovalWorkbench live sales-plan query', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('derives the live node from the returned row and never injects the persisted Fixture stage into the query', async () => {
    const onContextChange = vi.fn<(context: RegionalApprovalWorkbenchContext, conversationId: string | null) => void>();
    const stateScope = 'user:forecast-live-01';
    writeAssistantSurfaceState('forecast', `${getAssistantSurfaceWorkbenchScope(stateScope)}:regional-approval-state`, {
      currentStage: 'area',
    });
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: vi.fn().mockResolvedValue(queuePage([liveRow('plan-live', 2)])) },
    };
    render(
      <RegionalApprovalWorkbench stateScope={stateScope} t={t} onContextChange={onContextChange} queryClient={client} />
    );

    expect((await screen.findAllByText('plan-live 基地'))[0]).toBeVisible();
    const periodSelect = screen.getByRole('combobox', { name: '销售计划周期' });
    expect(periodSelect).toHaveTextContent('2026-09');
    expect(periodSelect).not.toHaveTextContent('月度计划');
    fireEvent.click(periodSelect);
    expect(await screen.findByRole('option', { name: '2026-09' })).toBeVisible();
    expect(screen.getByText('OPEN')).toBeVisible();
    expect(screen.getAllByText(/9,999,999,999,999,999\.90/).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: '审批核对队列' }).querySelector('table')).toHaveStyle({
      width: '1195px',
    });
    expect(client.list.invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({
        periodId: '9007199254740995',
        planTypeCode: 'MONTHLY',
        pageNo: 1,
        pageSize: 20,
        signal: expect.any(AbortSignal),
      })
    );
    expect(client.list.invoke).toHaveBeenLastCalledWith(expect.not.objectContaining({ status: expect.anything() }));
    expect(screen.getByTestId('regional-approval-current-stage')).toHaveTextContent('区域审批');
    expect(screen.getByTestId('regional-approval-stage-region')).toHaveAttribute('data-state', 'current');
    expect(screen.getByTestId('regional-approval-stage-area')).toBeDisabled();
    expect(screen.queryByRole('combobox', { name: '当前查看版本' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '对比版本' })).not.toBeInTheDocument();
    expect(screen.queryByText('AI 建议和组织候选仍为样例能力，不作用于 GEA 队列。')).not.toBeInTheDocument();
    expect(screen.queryByText('组织候选 / AI 为样例能力')).not.toBeInTheDocument();
    expect(screen.queryByText('样例候选 · 不作用于 GEA 队列')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '大区' })).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('switch', { name: '启用品类比较维度' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '健康度' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox', { name: '大区' }));
    fireEvent.click(await screen.findByRole('option', { name: 'AREA-01' }));
    fireEvent.click(screen.getByRole('combobox', { name: '审批状态' }));
    fireEvent.click(await screen.findByRole('option', { name: '区域审批' }));
    expect(screen.getByRole('button', { name: '查询' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() =>
      expect(client.list.invoke).toHaveBeenLastCalledWith(
        expect.objectContaining({ areaCode: 'AREA-01', status: 2, pageNo: 1 })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    await waitFor(() =>
      expect(client.list.invoke).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ areaCode: expect.anything(), status: expect.anything() })
      )
    );
    expect(screen.getByRole('combobox', { name: '大区' })).toHaveTextContent('全部大区');
    await waitFor(() =>
      expect(onContextChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          authority: expect.objectContaining({
            source: 'gea-user-session-query',
            filterSummary: expect.objectContaining({ periodMonth: '2026-09', planTypeCode: 'MONTHLY' }),
          }),
          evidence: expect.objectContaining({
            source: 'gea-user-session',
            completeness: 'paged-queue',
            queryState: 'success',
          }),
        }),
        'conversation-query'
      )
    );

    fireEvent.click(screen.getByRole('combobox', { name: '每页条数' }));
    fireEvent.click(await screen.findByRole('option', { name: '50 条/页' }));
    await waitFor(() =>
      expect(client.list.invoke).toHaveBeenLastCalledWith(expect.objectContaining({ pageNo: 1, pageSize: 50 }))
    );
  });

  it('renders numeric decimal fields returned by the formal GEA list response without leaving the workbench', async () => {
    const numericRow = {
      ...liveRow('plan-numeric', 2),
      targetQty: 2075,
      targetAmount: 142500,
      currentQty: 2075,
      currentAmount: 141862.04,
    } as unknown as GeaSalesPlanListItem;
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: vi.fn().mockResolvedValue(queuePage([numericRow])) },
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
    expect(screen.getByRole('columnheader', { name: 'SKU 汇总 / 计划目标' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: '版本 / SKU' })).toBeVisible();
    expect(screen.getAllByText(/141,862\.04/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/目标 2,075 · ¥142,500/).length).toBeGreaterThan(0);
  });

  it('refreshes the live periods and queue together and shows an honest empty pending-data state', async () => {
    const periods = vi.fn().mockResolvedValue(periodPage);
    const list = vi.fn().mockResolvedValue(queuePage([]));
    const client: SalesPlanQueryClient = {
      periods: { invoke: periods },
      list: { invoke: list },
    };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-empty'
        t={t}
        onContextChange={vi.fn()}
        queryClient={client}
      />
    );

    expect(await screen.findByText('当前账户在本周期没有可见审批数据。')).toBeVisible();
    expect(screen.getByText(/可能当前暂无待办，或当前账户缺少对应组织或审批节点的可见范围/)).toBeVisible();
    expect(screen.getByTestId('regional-approval-current-stage')).toHaveTextContent('待数据');
    expect(screen.getByTestId('regional-approval-stage-customer')).toHaveAttribute('data-state', 'available');
    expect(screen.getByTestId('regional-approval-stage-customer')).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('button', { current: 'step' })).not.toBeInTheDocument();

    const refresh = screen.getByRole('button', { name: '刷新数据' });
    fireEvent.click(refresh);
    expect(refresh).toBeDisabled();
    await waitFor(() => {
      expect(periods).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps the production surface read-only while periods, plans, and details remain queryable', async () => {
    const onContextChange = vi.fn<(context: RegionalApprovalWorkbenchContext, conversationId: string | null) => void>();
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: vi.fn().mockResolvedValue(queuePage([liveRow('plan-read-only')])) },
    };
    const action = vi.fn<SalesPlanActionClient['action']['invoke']>();
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-read-only'
        t={t}
        onContextChange={onContextChange}
        queryClient={client}
        liveActionClient={{ action: { invoke: action } }}
      />
    );

    expect((await screen.findAllByText('plan-read-only 基地'))[0]).toBeVisible();
    const approval = screen.getByRole('button', { name: '审批 plan-read-only 基地' });
    const resubmit = screen.getByRole('button', { name: '重提 plan-read-only 基地' });
    expect(screen.getByRole('button', { name: '查看 plan-read-only 基地 真实计划详情' })).toBeEnabled();
    expect(approval).toBeDisabled();
    expect(approval).toHaveAttribute('title', '当前业务版仅开放真实 GEA 数据查询；审批、退回和提交均未启用。');
    expect(resubmit).toBeDisabled();
    expect(resubmit).toHaveAttribute('title', '当前业务版仅开放真实 GEA 数据查询；审批、退回和提交均未启用。');
    expect(screen.queryByTestId('regional-approval-primary-task')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '通过' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '退回' })).toBeDisabled();
    expect(action).not.toHaveBeenCalled();
    expect(screen.queryByTestId('regional-approval-live-action-dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(onContextChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          evidence: expect.objectContaining({ permission: 'read-only', queryState: 'success' }),
        }),
        'conversation-query'
      )
    );
  });

  it.each([
    ['APPROVE', '通过', undefined, 3],
    ['REJECT', '退回', '库存证据不足，请补充', 7],
  ] as const)(
    'opens the selected live row footer %s action with the authoritative status and no adjustments',
    async (actionKind, buttonLabel, remark, toStatus) => {
      const list = vi.fn().mockResolvedValue(queuePage([liveRow(`plan-footer-${actionKind.toLowerCase()}`, 2)]));
      const client: SalesPlanQueryClient = {
        periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
        list: { invoke: list },
      };
      const invoke = vi.fn<SalesPlanActionClient['action']['invoke']>(async (params) => ({
        planId: `plan-footer-${actionKind.toLowerCase()}`,
        versionId: `plan-footer-${actionKind.toLowerCase()}-version`,
        fromStatus: 2,
        toStatus,
        replayed: false,
        requestId: params.requestId,
        traceId: `trace-${actionKind.toLowerCase()}`,
        auditId: `audit-${actionKind.toLowerCase()}`,
      }));
      render(
        <RegionalApprovalWorkbench
          stateScope={`user:forecast-live-footer-${actionKind.toLowerCase()}`}
          t={t}
          onContextChange={vi.fn()}
          queryClient={client}
          liveActionClient={{ action: { invoke } }}
          liveActionsEnabled
        />
      );

      expect((await screen.findAllByText(`plan-footer-${actionKind.toLowerCase()} 基地`))[0]).toBeVisible();
      fireEvent.click(screen.getByRole('radio'));
      const footer = screen.getByTestId('regional-approval-queue-footer');
      expect(within(footer).getByRole('button', { name: '通过' })).toBeEnabled();
      expect(within(footer).getByRole('button', { name: '退回' })).toBeEnabled();
      fireEvent.click(within(footer).getByRole('button', { name: buttonLabel }));

      const dialog = await screen.findByRole('dialog', { name: '真实销售计划审批' });
      expect(within(dialog).getByRole('radio', { name: buttonLabel })).toBeChecked();
      if (remark) {
        fireEvent.change(within(dialog).getByRole('textbox', { name: '退回原因（必填）' }), {
          target: { value: remark },
        });
      }
      fireEvent.click(within(dialog).getByRole('checkbox'));
      fireEvent.click(within(dialog).getByRole('button', { name: actionKind === 'APPROVE' ? '确认通过' : '确认退回' }));

      await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
      expect(invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          versionId: `plan-footer-${actionKind.toLowerCase()}-version`,
          request: {
            action: actionKind,
            expectedStatus: 2,
            ...(remark ? { remark } : {}),
          },
        })
      );
      expect(invoke.mock.calls[0][0].request).not.toHaveProperty('adjustments');
      await waitFor(() => expect(screen.queryByTestId('regional-approval-live-action-dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(within(footer).getByRole('button', { name: '通过' })).toBeDisabled());
      expect(list).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenLastCalledWith(expect.not.objectContaining({ status: expect.anything() }));
    }
  );

  it('keeps page 3 authoritative when the live queue has more pages than the Fixture projection', async () => {
    const onContextChange = vi.fn<(context: RegionalApprovalWorkbenchContext, conversationId: string | null) => void>();
    const list = vi.fn((query?: { pageNo?: number }) => {
      const current = query?.pageNo ?? 1;
      return Promise.resolve(queuePage([liveRow(`page-${current}`)], { total: 20, current, pages: 10 }));
    });
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: list },
    };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-page-3'
        t={t}
        onContextChange={onContextChange}
        queryClient={client}
      />
    );

    expect((await screen.findAllByText('page-1 基地'))[0]).toBeVisible();
    const pageThree = within(screen.getByTestId('regional-approval-queue-footer')).getByText('3', {
      selector: '.arco-pagination-item',
    });
    fireEvent.click(pageThree);

    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ pageNo: 3 })));
    expect((await screen.findAllByText('page-3 基地'))[0]).toBeVisible();
    await waitFor(() =>
      expect(onContextChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ pagination: expect.objectContaining({ page: 3, total: 20 }) }),
        'conversation-query'
      )
    );
    expect(list.mock.calls.filter(([query]) => query?.pageNo === 3)).toHaveLength(1);
    expect(list.mock.calls.at(-1)?.[0]?.pageNo).toBe(3);
  });

  it('keeps the live stage lane display-only and does not query from a persisted node click', async () => {
    const first = deferred<GeaSalesPlanPage<GeaSalesPlanListItem>>();
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: vi.fn().mockReturnValueOnce(first.promise) },
    };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-02'
        t={t}
        onContextChange={vi.fn()}
        queryClient={client}
      />
    );
    await waitFor(() => expect(client.list.invoke).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId('regional-approval-stage-province')).toBeDisabled();
    fireEvent.click(screen.getByTestId('regional-approval-stage-province'));
    expect(client.list.invoke).toHaveBeenCalledTimes(1);
    first.resolve(queuePage([liveRow('authoritative-row', 3)]));
    expect((await screen.findAllByText('authoritative-row 基地'))[0]).toBeVisible();
    expect(client.list.invoke).toHaveBeenLastCalledWith(expect.not.objectContaining({ status: expect.anything() }));
  });

  it('keeps the loaded period on a queue failure and retries only the queue', async () => {
    const onContextChange = vi.fn<(context: RegionalApprovalWorkbenchContext, conversationId: string | null) => void>();
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: {
        invoke: vi
          .fn()
          .mockRejectedValueOnce(new TypeError('network disconnected'))
          .mockResolvedValueOnce(queuePage([])),
      },
    };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-03'
        t={t}
        onContextChange={onContextChange}
        queryClient={client}
      />
    );

    expect(await screen.findByText('销售计划服务暂时不可用；已保留当前筛选与周期。')).toBeVisible();
    expect(onContextChange.mock.calls.at(-1)?.[0].authority).toBeUndefined();
    expect(screen.getByText('OPEN')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('当前账户在本周期没有可见审批数据。')).toBeVisible();
    expect(client.periods.invoke).toHaveBeenCalledTimes(1);
    expect(client.list.invoke).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(onContextChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          evidence: expect.objectContaining({
            source: 'gea-user-session',
            completeness: 'paged-queue',
            queryState: 'empty',
          }),
        }),
        'conversation-query'
      )
    );
  });

  it('does not label an unsuccessful period request as GEA evidence', async () => {
    const onContextChange = vi.fn<(context: RegionalApprovalWorkbenchContext, conversationId: string | null) => void>();
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockRejectedValue(new TypeError('network disconnected')) },
      list: { invoke: vi.fn() },
    };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-unverified'
        t={t}
        onContextChange={onContextChange}
        queryClient={client}
      />
    );

    expect(await screen.findByText('销售计划服务暂时不可用；已保留当前筛选与周期。')).toBeVisible();
    await waitFor(() =>
      expect(onContextChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          visibleEntities: [],
          evidence: {
            source: 'unverified',
            permission: 'read-only',
            completeness: 'none',
            queryState: 'error',
            error: 'unavailable',
            dataVersion: 'unverified',
          },
        }),
        'conversation-query'
      )
    );
    expect(client.list.invoke).not.toHaveBeenCalled();
    expect(onContextChange.mock.calls.at(-1)?.[0].authority).toBeUndefined();
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

  it('marks retained queue data as stale when a later request fails', async () => {
    const onContextChange = vi.fn<(context: RegionalApprovalWorkbenchContext, conversationId: string | null) => void>();
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: {
        invoke: vi
          .fn()
          .mockResolvedValueOnce(queuePage([liveRow('retained')]))
          .mockRejectedValueOnce(new TypeError('network disconnected')),
      },
    };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-stale'
        t={t}
        onContextChange={onContextChange}
        queryClient={client}
      />
    );

    expect((await screen.findAllByText('retained 基地'))[0]).toBeVisible();
    fireEvent.click(screen.getByRole('combobox', { name: '每页条数' }));
    fireEvent.click(await screen.findByRole('option', { name: '50 条/页' }));
    expect(await screen.findByText('销售计划服务暂时不可用；已保留当前筛选与周期。')).toBeVisible();
    expect(screen.getAllByText('retained 基地')[0]).toBeVisible();
    await waitFor(() =>
      expect(onContextChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          visibleEntities: [expect.objectContaining({ id: 'retained' })],
          evidence: expect.objectContaining({
            source: 'gea-user-session',
            completeness: 'paged-queue',
            queryState: 'stale-error',
            error: 'unavailable',
          }),
        }),
        'conversation-query'
      )
    );
  });

  it('disables actions while a retained live row is loading or stale after an error', async () => {
    const staleRequest = deferred<GeaSalesPlanPage<GeaSalesPlanListItem>>();
    const list = vi
      .fn()
      .mockResolvedValueOnce(queuePage([liveRow('retained-action')]))
      .mockReturnValueOnce(staleRequest.promise);
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: list },
    };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-stale-action'
        t={t}
        onContextChange={vi.fn()}
        queryClient={client}
        liveActionsEnabled
      />
    );

    const actionButton = await screen.findByRole('button', { name: '审批 retained-action 基地' });
    expect(actionButton).toBeEnabled();
    fireEvent.click(screen.getByRole('combobox', { name: '每页条数' }));
    fireEvent.click(await screen.findByRole('option', { name: '50 条/页' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(actionButton).toBeDisabled();
    expect(actionButton).toHaveAttribute(
      'title',
      '审批队列正在刷新或已读取失败；保留的行可能陈旧，必须刷新成功后才能操作。'
    );

    staleRequest.reject(new TypeError('network disconnected'));
    expect(await screen.findByText('销售计划服务暂时不可用；已保留当前筛选与周期。')).toBeVisible();
    expect(actionButton).toBeDisabled();
    expect(actionButton).toHaveAttribute(
      'title',
      '审批队列正在刷新或已读取失败；保留的行可能陈旧，必须刷新成功后才能操作。'
    );
  });

  it('submits a live approval once through the user action client, then refreshes only after the receipt', async () => {
    const onContextChange = vi.fn<(context: RegionalApprovalWorkbenchContext, conversationId: string | null) => void>();
    const list = vi.fn().mockResolvedValue(queuePage([liveRow('plan-action')]));
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: list },
    };
    const invoke = vi.fn<SalesPlanActionClient['action']['invoke']>(async (params) => ({
      planId: 'plan-action',
      versionId: 'plan-action-version',
      fromStatus: 4,
      toStatus: 5,
      replayed: false,
      requestId: params.requestId,
      traceId: 'trace-action',
      auditId: 'audit-action',
    }));
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-action'
        t={t}
        onContextChange={onContextChange}
        queryClient={client}
        liveActionClient={{ action: { invoke } }}
        liveActionsEnabled
      />
    );

    const open = await screen.findByRole('button', { name: '审批 plan-action 基地' });
    fireEvent.click(open);
    await screen.findByTestId('regional-approval-live-action-dialog');
    const dialog = screen.getByRole('dialog', { name: '真实销售计划审批' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    const confirm = within(dialog).getByRole('button', { name: '确认通过' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        versionId: 'plan-action-version',
        request: { action: 'APPROVE', expectedStatus: 4 },
        idempotencyKey: expect.stringMatching(/^gea-sales-plan-action:/),
        requestId: expect.any(String),
      })
    );
    expect(JSON.stringify(invoke.mock.calls[0][0])).not.toMatch(/tenant|user|role|permission/i);
    await waitFor(() => expect(screen.queryByTestId('regional-approval-live-action-dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(onContextChange.mock.calls.at(-1)?.[0].authority).toEqual(
        expect.objectContaining({
          source: 'gea-user-session-action',
          planId: 'plan-action',
          versionId: 'plan-action-version',
          seq: 3,
          status: 5,
          replayed: false,
          auditId: 'audit-action',
        })
      )
    );
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: '审批 plan-action 基地' })).toBeDisabled();
  });

  it('submits a live rejection with its remark and expected status, without Fixture adjustments', async () => {
    const list = vi.fn().mockResolvedValue(queuePage([liveRow('plan-reject')]));
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: list },
    };
    const invoke = vi.fn<SalesPlanActionClient['action']['invoke']>(async (params) => ({
      planId: 'plan-reject',
      versionId: 'plan-reject-version',
      fromStatus: 4,
      toStatus: 3,
      replayed: false,
      requestId: params.requestId,
      traceId: 'trace-reject',
      auditId: 'audit-reject',
    }));
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-reject'
        t={t}
        onContextChange={vi.fn()}
        queryClient={client}
        liveActionClient={{ action: { invoke } }}
        liveActionsEnabled
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '审批 plan-reject 基地' }));
    await screen.findByTestId('regional-approval-live-action-dialog');
    const dialog = screen.getByRole('dialog', { name: '真实销售计划审批' });
    fireEvent.click(within(dialog).getByRole('radio', { name: '退回' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: '退回原因（必填）' }), {
      target: { value: '库存证据不足，请补充' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认退回' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        versionId: 'plan-reject-version',
        request: {
          action: 'REJECT',
          expectedStatus: 4,
          remark: '库存证据不足，请补充',
        },
      })
    );
    expect(invoke.mock.calls[0][0].request).not.toHaveProperty('adjustments');
    await waitFor(() => expect(screen.queryByTestId('regional-approval-live-action-dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it('locks a server-denied row for the round without updating or retrying the action', async () => {
    const onContextChange = vi.fn<(context: RegionalApprovalWorkbenchContext, conversationId: string | null) => void>();
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: vi.fn().mockResolvedValue(queuePage([liveRow('plan-forbidden')])) },
    };
    const forbidden = Object.assign(new Error('forbidden'), {
      name: 'BackendHttpError',
      status: 403,
      code: 'FORBIDDEN',
    });
    const invoke = vi.fn<SalesPlanActionClient['action']['invoke']>().mockRejectedValue(forbidden);
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-forbidden'
        t={t}
        onContextChange={onContextChange}
        queryClient={client}
        liveActionClient={{ action: { invoke } }}
        liveActionsEnabled
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '审批 plan-forbidden 基地' }));
    await screen.findByTestId('regional-approval-live-action-dialog');
    const dialog = screen.getByRole('dialog', { name: '真实销售计划审批' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认通过' }));
    expect(await within(dialog).findByText(/服务端确认当前用户无权审批/)).toBeVisible();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onContextChange.mock.calls.at(-1)?.[0].authority).toEqual(
      expect.objectContaining({ source: 'gea-user-session-query', planId: 'plan-forbidden' })
    );
    expect(onContextChange.mock.calls.at(-1)?.[0].authority).not.toHaveProperty('requestId');
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    expect(await screen.findByRole('button', { name: '审批 plan-forbidden 基地' })).toBeDisabled();
  });

  it('keeps an unknown result mounted so retry reuses the original action identity', async () => {
    const onContextChange = vi.fn<(context: RegionalApprovalWorkbenchContext, conversationId: string | null) => void>();
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: vi.fn().mockResolvedValue(queuePage([liveRow('plan-unknown')])) },
    };
    const invoke = vi
      .fn<SalesPlanActionClient['action']['invoke']>()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockImplementationOnce(async (params) => ({
        planId: 'plan-unknown',
        versionId: 'plan-unknown-version',
        fromStatus: 4,
        toStatus: 5,
        replayed: true,
        requestId: params.requestId,
        traceId: 'trace-unknown',
        auditId: 'audit-unknown',
      }));
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-unknown'
        t={t}
        onContextChange={onContextChange}
        queryClient={client}
        liveActionClient={{ action: { invoke } }}
        liveActionsEnabled
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '审批 plan-unknown 基地' }));
    await screen.findByTestId('regional-approval-live-action-dialog');
    const dialog = screen.getByRole('dialog', { name: '真实销售计划审批' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认通过' }));
    expect(await within(dialog).findByText(/可关闭弹窗后刷新权威状态/)).toBeVisible();
    expect(onContextChange.mock.calls.at(-1)?.[0].authority?.source).toBe('gea-user-session-query');
    expect(within(dialog).getByRole('button', { name: '关闭' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '以原幂等键重试' }));
    await waitFor(() => expect(screen.queryByTestId('regional-approval-live-action-dialog')).not.toBeInTheDocument());
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][0]).toEqual(invoke.mock.calls[0][0]);
    await waitFor(() =>
      expect(onContextChange.mock.calls.at(-1)?.[0].authority).toEqual(
        expect.objectContaining({ source: 'gea-user-session-action', replayed: true, auditId: 'audit-unknown' })
      )
    );
  });

  it('keeps non-returned plans out of resubmit and never uses queue mode as a status query', async () => {
    const onContextChange = vi.fn<(context: RegionalApprovalWorkbenchContext, conversationId: string | null) => void>();
    const returnedRow = {
      ...liveRow('p-jxs-2026-09-00001', 9),
      targetQty: '1.234',
      targetAmount: '2.47',
      currentQty: '1.234',
      currentAmount: '2.47',
      skuCount: 1,
    };
    const list = vi.fn(async (query?: { status?: number }) =>
      queuePage(query?.status === 9 ? [returnedRow] : [liveRow('approval-row')])
    );
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: list },
    };
    const currentVersion: GeaSalesPlanDetail['currentVersion'] = {
      id: returnedRow.versionId,
      planId: returnedRow.planId,
      seq: returnedRow.seq,
      periodId: returnedRow.periodId,
      planTypeCode: returnedRow.planTypeCode,
      dealerCode: returnedRow.dealerCode,
      orgCode: returnedRow.orgCode,
      provinceCode: returnedRow.provinceCode,
      areaCode: returnedRow.areaCode,
      baseName: returnedRow.baseName,
      status: 9,
      effective: true,
      targetQty: returnedRow.targetQty,
      targetAmount: returnedRow.targetAmount,
    };
    const versionSku: GeaSalesPlanSku = {
      id: '9007199254741100',
      versionId: returnedRow.versionId,
      skuCode: '9007199254741200',
      productCategName: '真实品类',
      baseQty: '1.000',
      qty: '1.234',
      price: '2.0000',
      amt: '2.47',
      amtBase: '2.00',
    };
    const submit = vi.fn<SalesPlanSubmitClient['submit']['invoke']>(async (params) => ({
      planId: returnedRow.planId,
      versionId: '9007199254742000',
      seq: 4,
      status: 4,
      replayed: false,
      requestId: params.requestId,
      traceId: 'trace-submit',
      auditId: 'audit-submit',
    }));
    const submitClient: SalesPlanSubmitClient = {
      detail: {
        invoke: vi.fn().mockResolvedValue({
          currentVersion,
          skus: [{ ...versionSku, versionId: 'stale-version', skuCode: '1' }],
          versions: [],
          logs: [],
        }),
      },
      versionSkus: { invoke: vi.fn().mockResolvedValue([versionSku]) },
      currentUser: { invoke: vi.fn().mockResolvedValue({ id: 'current-user', username: '当前用户' }) },
      submit: { invoke: submit },
    };
    const approval = vi.fn<SalesPlanActionClient['action']['invoke']>();
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-resubmit'
        t={t}
        onContextChange={onContextChange}
        queryClient={client}
        liveActionClient={{ action: { invoke: approval } }}
        liveActionsEnabled
        liveSubmitClient={submitClient}
      />
    );

    expect(await screen.findByRole('button', { name: '审批 approval-row 基地' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '首次提报' })).toBeDisabled();
    expect(screen.queryByRole('combobox', { name: '队列类型' })).not.toBeInTheDocument();
    expect(screen.queryByText(/当前接口没有真实的新计划草稿、经销商和 SKU 明细来源/)).not.toBeInTheDocument();

    expect(list).toHaveBeenLastCalledWith(expect.not.objectContaining({ status: expect.anything() }));
    const approvalButton = await screen.findByRole('button', { name: '审批 approval-row 基地' });
    const resubmitButton = screen.getByRole('button', { name: '重提 approval-row 基地' });
    expect(approvalButton).toBeEnabled();
    expect(resubmitButton).toBeDisabled();
    expect(resubmitButton).toHaveAttribute('title', '只有状态 6–9 的退回版本可以重提。');
    expect(submit).not.toHaveBeenCalled();
    expect(approval).not.toHaveBeenCalled();
    expect(onContextChange.mock.calls.at(-1)?.[0].authority?.source).toBe('gea-user-session-query');
  });

  it('offers resubmit and blocks approval actions for a returned plan', async () => {
    const returnedRow = liveRow('p-jxs-2026-09-00002', 8);
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: vi.fn().mockResolvedValue(queuePage([returnedRow])) },
    };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-returned-action'
        t={t}
        onContextChange={vi.fn()}
        queryClient={client}
        liveActionsEnabled
      />
    );

    const approvalButton = await screen.findByRole('button', { name: '审批 p-jxs-2026-09-00002 基地' });
    expect(approvalButton).toBeDisabled();
    expect(approvalButton).toHaveAttribute('title', '该计划已不在当前审批节点，请刷新队列。');
    expect(screen.getByRole('button', { name: '重提 p-jxs-2026-09-00002 基地' })).toBeEnabled();
  });

  it('replaces the focused plan query Context instead of carrying the previous plan receipt forward', async () => {
    const onContextChange = vi.fn<(context: RegionalApprovalWorkbenchContext, conversationId: string | null) => void>();
    const client: SalesPlanQueryClient = {
      periods: { invoke: vi.fn().mockResolvedValue(periodPage) },
      list: { invoke: vi.fn().mockResolvedValue(queuePage([liveRow('plan-a'), liveRow('plan-b')])) },
    };
    render(
      <RegionalApprovalWorkbench
        stateScope='user:forecast-live-plan-switch'
        t={t}
        onContextChange={onContextChange}
        queryClient={client}
        liveActionsEnabled
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '审批 plan-a 基地' }));
    const firstDialog = await screen.findByRole('dialog', { name: '真实销售计划审批' });
    await waitFor(() => expect(onContextChange.mock.calls.at(-1)?.[0].authority?.planId).toBe('plan-a'));
    fireEvent.click(within(firstDialog).getByRole('button', { name: '关闭' }));

    fireEvent.click(await screen.findByRole('button', { name: '审批 plan-b 基地' }));
    await waitFor(() =>
      expect(onContextChange.mock.calls.at(-1)?.[0].authority).toEqual(
        expect.objectContaining({
          source: 'gea-user-session-query',
          planId: 'plan-b',
          versionId: 'plan-b-version',
        })
      )
    );
    expect(onContextChange.mock.calls.at(-1)?.[0].authority).not.toHaveProperty('requestId');
  });
});
