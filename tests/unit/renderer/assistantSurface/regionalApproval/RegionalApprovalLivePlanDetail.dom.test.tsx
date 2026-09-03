import type { TFunction } from 'i18next';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  GeaSalesPlanApprovalLog,
  GeaSalesPlanDetail,
  GeaSalesPlanSku,
  GeaSalesPlanSkuDiff,
  GeaSalesPlanVersion,
} from '@/common/adapter/ipcBridge';
import RegionalApprovalLivePlanDetail from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/RegionalApprovalLivePlanDetail';
import type { SalesPlanDetailClient } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/hooks/useSalesPlanDetail';
import { toRegionalApprovalLiveRow } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/regionalApprovalQueryModel';
import zhCN from '@/renderer/services/i18n/locales/zh-CN/common.json';

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

const version = (id: string, seq: number, effective = false): GeaSalesPlanVersion => ({
  id,
  planId: 'plan-live',
  seq,
  periodId: 'period-live',
  planTypeCode: 'MONTHLY',
  dealerCode: 'dealer-live',
  status: 4,
  effective,
  targetAmount: seq === 2 ? '200.00' : '170.00',
  targetQty: seq === 2 ? '20' : '18',
  submitter: `提交人 ${seq}`,
  submitTime: `2026-09-0${seq}T08:00:00Z`,
  returnReason: seq === 1 ? '退回后修订销量证据' : null,
});

const sku = (versionId: string, code: string, qty: string): GeaSalesPlanSku => ({
  id: `${versionId}-${code}`,
  versionId,
  skuCode: code,
  productCategName: '饮品',
  baseQty: '10',
  qty,
  price: '8.50',
  amt: '102.00',
  amtBase: '85.00',
});

const versions = [version('version-2', 2, true), version('version-1', 1)];
const logs: GeaSalesPlanApprovalLog[] = [
  {
    id: 'log-1',
    planId: 'plan-live',
    versionId: 'version-1',
    fromStatus: 3,
    toStatus: 4,
    actionCode: 'SUBMIT',
    operatorCode: 'operator-1',
    operatorName: '审批人甲',
    remark: '进入区域审批',
    actionAt: '2026-09-01T08:00:00Z',
  },
];
const detail: GeaSalesPlanDetail = {
  currentVersion: versions[0],
  skus: [sku('nested-stale', 'NESTED-SKU', '999')],
  versions: [],
  logs: [],
};
const differences: GeaSalesPlanSkuDiff[] = [
  {
    skuCode: 'REAL-SKU',
    changeType: 'UPDATED',
    before: sku('version-1', 'REAL-SKU', '10'),
    after: sku('version-2', 'REAL-SKU', '12'),
    qtyDelta: '2',
    amountDelta: '17.00',
  },
];
const row = toRegionalApprovalLiveRow({
  planId: 'plan-live',
  versionId: 'version-2',
  seq: 2,
  periodId: 'period-live',
  planTypeCode: 'MONTHLY',
  dealerCode: 'dealer-live',
  orgCode: 'ORG-LIVE',
  baseName: '真实基地',
  status: 4,
  targetQty: '20',
  targetAmount: '200.00',
  skuCount: 1,
  currentQty: '12',
  currentAmount: '102.00',
});

const createClient = (): SalesPlanDetailClient => ({
  detail: { invoke: vi.fn().mockResolvedValue(detail) },
  versions: { invoke: vi.fn().mockResolvedValue(versions) },
  logs: { invoke: vi.fn().mockResolvedValue(logs) },
  versionSkus: {
    invoke: vi.fn(async ({ versionId }) => [
      sku(versionId, versionId === 'version-2' ? 'REAL-SKU' : 'OLDER-SKU', '12'),
    ]),
  },
  compare: { invoke: vi.fn().mockResolvedValue(differences) },
});

describe('RegionalApprovalLivePlanDetail', () => {
  it('can open directly on the version comparison without changing comparison semantics', async () => {
    render(
      <RegionalApprovalLivePlanDetail
        visible
        rows={[row]}
        row={row}
        t={t}
        client={createClient()}
        initialTab='compare'
        onClose={vi.fn()}
        onRowChange={vi.fn()}
      />
    );

    expect(await screen.findByRole('tab', { name: '版本比较' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('10 → 12 (2)')).toBeVisible();
    expect(screen.getByLabelText('版本退回原因')).toHaveTextContent('退回后修订销量证据');
  });

  it('renders independent real resources and keeps nested detail resources out of the projection', async () => {
    const client = createClient();
    render(
      <RegionalApprovalLivePlanDetail
        visible
        rows={[row]}
        row={row}
        t={t}
        client={client}
        onClose={vi.fn()}
        onRowChange={vi.fn()}
      />
    );

    expect(await screen.findByText('REAL-SKU')).toBeVisible();
    expect(screen.queryByText('NESTED-SKU')).not.toBeInTheDocument();
    expect(client.detail.invoke).toHaveBeenCalledWith({ planId: 'plan-live', signal: expect.any(AbortSignal) });
    expect(client.versions.invoke).toHaveBeenCalledWith({ planId: 'plan-live', signal: expect.any(AbortSignal) });
    expect(client.logs.invoke).toHaveBeenCalledWith({ planId: 'plan-live', signal: expect.any(AbortSignal) });
    expect(client.versionSkus.invoke).toHaveBeenCalledWith({
      versionId: 'version-2',
      signal: expect.any(AbortSignal),
    });
    expect(client.compare.invoke).toHaveBeenCalledWith({
      planId: 'plan-live',
      fromVersionId: 'version-1',
      toVersionId: 'version-2',
      signal: expect.any(AbortSignal),
    });

    fireEvent.click(screen.getByRole('combobox', { name: 'SKU 版本' }));
    fireEvent.click(await screen.findByRole('option', { name: /第 1 版 · version-1/ }));
    expect(await screen.findByText('OLDER-SKU')).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: '历史版本' }));
    expect(screen.getByText('提交人 1 · 2026-09-01T08:00:00Z')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '审批日志' }));
    expect(screen.getByText('进入区域审批')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '版本比较' }));
    expect(screen.getByText('10 → 12 (2)')).toBeVisible();
    expect(screen.getByText('¥8.50 → ¥8.50')).toBeVisible();
  });

  it('shows a recoverable version mismatch instead of mixing a stale queue version', async () => {
    const client = createClient();
    vi.mocked(client.detail.invoke).mockResolvedValue({ ...detail, currentVersion: version('version-3', 3, true) });
    render(
      <RegionalApprovalLivePlanDetail
        visible
        rows={[row]}
        row={row}
        t={t}
        client={client}
        onClose={vi.fn()}
        onRowChange={vi.fn()}
      />
    );

    expect(await screen.findByText('返回的版本不属于当前计划；已拒绝展示，避免混入其他计划证据。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(client.detail.invoke).toHaveBeenCalledTimes(2));
  });
});
