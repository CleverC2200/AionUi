import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TFunction } from 'i18next';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import RegionalApprovalLiveActionDialog from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/RegionalApprovalLiveActionDialog';
import zhCN from '@/renderer/services/i18n/locales/zh-CN/common.json';
import type { SalesPlanActionClient } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/models/salesPlanActionModel';

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

const row = {
  source: 'gea' as const,
  approvalState: 'pending' as const,
  planId: 'plan-1',
  versionId: 'version-1',
  seq: 1,
  periodId: 'period-1',
  planTypeCode: 'MONTHLY',
  dealerCode: 'dealer-1',
  baseName: '真实计划',
  areaCode: '华北',
  provinceCode: '河北',
  orgCode: 'ORG-01',
  status: 4,
  targetQty: '10',
  targetAmount: '100',
  skuCount: 1,
  currentQty: '12',
  currentAmount: '120',
};

const cases = [
  [400, /请求内容不合法/, '关闭'],
  [401, /用户会话已过期/, '关闭'],
  [409, /版本状态已变化或存在并发操作/, '刷新权威状态'],
  [429, /请求过于频繁/, '以原幂等键重试'],
  [503, /结果暂时未知/, '以原幂等键重试'],
] as const;

describe('RegionalApprovalLiveActionDialog', () => {
  it('keeps SKU adjustments unavailable at the first regional approval node', () => {
    const versionSkus = vi.fn();
    render(
      <RegionalApprovalLiveActionDialog
        visible
        row={{ ...row, status: 1 }}
        approvalStage='region'
        t={t}
        client={{ action: { invoke: vi.fn() }, versionSkus: { invoke: versionSkus } }}
        onPermissionDenied={vi.fn()}
        onSucceeded={vi.fn()}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '真实销售计划审批' });
    expect(within(dialog).getByText(/区域首节点只确认提交数据/)).toBeVisible();
    expect(within(dialog).queryByText('节点调整明细')).not.toBeInTheDocument();
    expect(versionSkus).not.toHaveBeenCalled();
  });

  it('loads live SKUs and submits non-zero signed quantity adjustments for an approval node', async () => {
    const invoke = vi
      .fn()
      .mockImplementation(
        async (params: {
          requestId: string;
          request: { adjustments?: Array<{ skuCode: string; adjustQty: string }> };
        }) => ({
          planId: row.planId,
          versionId: row.versionId,
          fromStatus: row.status,
          toStatus: 5,
          replayed: false,
          requestId: params.requestId,
          traceId: 'trace-1',
          auditId: 'audit-1',
        })
      );
    const versionSkus = vi.fn().mockResolvedValue([
      {
        id: 'sku-row-1',
        versionId: row.versionId,
        skuCode: '10001',
        productCategName: '速冻食品',
        baseQty: '8',
        qty: '10',
        price: '7.5',
        amt: '75',
        amtBase: '60',
        provinceConfirmedQty: '12',
        provinceConfirmedAmount: '90',
      },
    ]);
    const client = {
      action: { invoke },
      versionSkus: { invoke: versionSkus },
    } as SalesPlanActionClient & { versionSkus: { invoke: typeof versionSkus } };

    render(
      <RegionalApprovalLiveActionDialog
        visible
        row={row}
        approvalStage='area'
        t={t}
        client={client}
        onPermissionDenied={vi.fn()}
        onSucceeded={vi.fn()}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '真实销售计划审批' });
    expect(await within(dialog).findByText('节点调整明细')).toBeVisible();
    expect(versionSkus).toHaveBeenCalledWith(expect.objectContaining({ versionId: row.versionId }));
    const nodeSummary = within(dialog).getByLabelText('审批节点差异汇总');
    expect(nodeSummary).toHaveTextContent('上一节点数量 / 金额12 · ¥90');
    expect(nodeSummary).toHaveTextContent('本节点变化数量 / 金额0 · ¥0.00');
    expect(nodeSummary).toHaveTextContent('本节点确认数量 / 金额12 · ¥90.00');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'SKU 10001 调整量' }), {
      target: { value: '-2.5' },
    });
    expect(nodeSummary).toHaveTextContent('本节点变化数量 / 金额-2.5 · -¥18.75');
    expect(nodeSummary).toHaveTextContent('本节点确认数量 / 金额9.5 · ¥71.25');
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认通过' }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({ adjustments: [{ skuCode: '10001', adjustQty: '-2.5' }] }),
        })
      )
    );
  });

  it('keeps the approval dialog mounted when live SKU decimals arrive as JSON numbers', async () => {
    const versionSkus = vi.fn().mockResolvedValue([
      {
        id: 1174,
        versionId: row.versionId,
        skuCode: 10000075,
        productCategName: '汤圆',
        baseQty: 1,
        qty: 1,
        price: 113.27,
        amt: 113.27,
        amtBase: 113.27,
      },
    ]);
    const client = {
      action: { invoke: vi.fn() },
      versionSkus: { invoke: versionSkus },
    } as unknown as SalesPlanActionClient;

    render(
      <RegionalApprovalLiveActionDialog
        visible
        row={row}
        approvalStage='area'
        t={t}
        client={client}
        onPermissionDenied={vi.fn()}
        onSucceeded={vi.fn()}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '真实销售计划审批' });
    expect((await within(dialog).findAllByText('¥113.27')).length).toBeGreaterThan(0);
    expect(dialog).toBeVisible();
  });

  it('requires confirmation before discarding session-only SKU adjustments', async () => {
    const onClose = vi.fn();
    const versionSkus = vi.fn().mockResolvedValue([
      {
        id: 'sku-row-1',
        versionId: row.versionId,
        skuCode: '10001',
        productCategName: '速冻食品',
        baseQty: '8',
        qty: '10',
        price: '7.5',
        amt: '75',
        amtBase: '60',
      },
    ]);
    render(
      <RegionalApprovalLiveActionDialog
        visible
        row={row}
        approvalStage='area'
        t={t}
        client={{ action: { invoke: vi.fn() }, versionSkus: { invoke: versionSkus } }}
        onPermissionDenied={vi.fn()}
        onSucceeded={vi.fn()}
        onRefresh={vi.fn()}
        onClose={onClose}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '真实销售计划审批' });
    fireEvent.change(await within(dialog).findByRole('textbox', { name: 'SKU 10001 调整量' }), {
      target: { value: '2' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));

    const confirmation = await screen.findByRole('dialog', { name: '放弃未提交的调整？' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: '放弃调整' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it.each(cases)('renders a recoverable, status-specific HTTP %s result', async (status, message, recovery) => {
    const backendError = Object.assign(new Error(`HTTP ${status}`), {
      name: 'BackendHttpError',
      status,
      code: `HTTP_${status}`,
    });
    const client: SalesPlanActionClient = { action: { invoke: vi.fn().mockRejectedValue(backendError) } };
    const onClose = vi.fn();
    render(
      <RegionalApprovalLiveActionDialog
        visible
        row={row}
        approvalStage='area'
        t={t}
        client={client}
        onPermissionDenied={vi.fn()}
        onSucceeded={vi.fn()}
        onRefresh={vi.fn()}
        onClose={onClose}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '真实销售计划审批' });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认通过' }));
    expect(await within(dialog).findByText(message)).toBeVisible();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: recovery })).toBeVisible());
    const close = within(dialog).getByRole('button', { name: '关闭' });
    expect(close).toBeEnabled();
    if (status >= 500) {
      fireEvent.click(close);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });

  it('shows the business checksum and updates the action target before confirmation', () => {
    render(
      <RegionalApprovalLiveActionDialog
        visible
        row={row}
        approvalStage='area'
        t={t}
        onPermissionDenied={vi.fn()}
        onSucceeded={vi.fn()}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const checksum = screen.getByTestId('regional-approval-live-action-checksum');
    expect(checksum).toHaveTextContent('真实计划 · 华北 / 河北 / ORG-01');
    expect(checksum).toHaveTextContent('大区审批');
    expect(checksum).toHaveTextContent('目标 10 → 当前 12');
    expect(checksum).toHaveTextContent('目标 ¥100 → 当前 ¥120');
    expect(checksum).toHaveTextContent('1 个计划 · 1 个 SKU');
    expect(checksum).toHaveTextContent('通过 → 审批完成');
    expect(checksum).toHaveTextContent('当前登录用户（由 GEA 服务端会话校验）');
    expect(screen.queryByText(/本操作通过当前 GEA 用户会话提交/)).not.toBeInTheDocument();
    expect(screen.queryByText(/结果未知时仅以原幂等键重试同一意图/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: '退回' }));
    expect(checksum).toHaveTextContent('退回 → 大区退回');
  });

  it('labels absent checksum values as unknown instead of inventing business data', () => {
    render(
      <RegionalApprovalLiveActionDialog
        visible
        row={{
          ...row,
          baseName: undefined,
          areaCode: undefined,
          provinceCode: undefined,
          orgCode: undefined,
          targetQty: undefined as unknown as string,
          currentQty: undefined as unknown as string,
          skuCount: undefined as unknown as number,
        }}
        approvalStage='area'
        t={t}
        onPermissionDenied={vi.fn()}
        onSucceeded={vi.fn()}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('regional-approval-live-action-checksum')).toHaveTextContent('未知');
  });

  it('disables completed status 5 before any request is sent', () => {
    const client: SalesPlanActionClient = { action: { invoke: vi.fn() } };
    render(
      <RegionalApprovalLiveActionDialog
        visible
        row={{ ...row, status: 5 }}
        approvalStage='category'
        t={t}
        client={client}
        onPermissionDenied={vi.fn()}
        onSucceeded={vi.fn()}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog', { name: '真实销售计划审批' });
    expect(within(dialog).getByRole('radio', { name: '退回' })).toBeDisabled();
    expect(within(dialog).getByRole('radio', { name: '通过' })).toBeDisabled();
    expect(within(dialog).getByText(/已完成品类审批/)).toBeVisible();
  });
});
