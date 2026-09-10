import type { TFunction } from 'i18next';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelInference, conversation, type GeaSalesPlanSku } from '@/common/adapter/ipcBridge';
import RegionalApprovalLiveAdjustmentDialog from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/RegionalApprovalLiveAdjustmentDialog';
import type { SalesPlanDetailClient } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/hooks/useSalesPlanDetail';
import { toRegionalApprovalLiveRow } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/regionalApprovalQueryModel';
import zhCN from '@/renderer/services/i18n/locales/zh-CN/common.json';

const t = ((key: string, options?: Record<string, string | number>) => {
  const value = key
    .replace(/^common\./, '')
    .split('.')
    .reduce<unknown>(
      (current, segment) =>
        current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined,
      zhCN
    );
  return Object.entries(options ?? {}).reduce(
    (text, [name, replacement]) => text.replaceAll(`{{${name}}}`, String(replacement)),
    typeof value === 'string' ? value : key
  );
}) as TFunction;

const row = toRegionalApprovalLiveRow({
  planId: 'plan',
  versionId: 'version',
  seq: 1,
  periodId: 'period',
  planTypeCode: 'MONTHLY',
  dealerCode: 'dealer',
  orgCode: 'org',
  orgName: '测试区域',
  status: 2,
  targetQty: '12',
  targetAmount: '120',
  skuCount: 1,
  currentQty: '12',
  currentAmount: '120',
});
const rows = [row];
const drafts = {};
const skus: GeaSalesPlanSku[] = [
  {
    id: 'sku',
    versionId: 'version',
    skuCode: 'MOCK-SKU',
    materialDescription: 'MOCK 物料',
    baseQty: '10',
    qty: '12',
    price: '10',
    amt: '120',
    amtBase: '100',
  },
];
const client = { versionSkus: { invoke: vi.fn(async () => skus) } } as unknown as SalesPlanDetailClient;

afterEach(() => vi.restoreAllMocks());

describe('independent adjustment advice', () => {
  it('renders generated advice without a conversation context or a start-analysis button', async () => {
    const create = vi.spyOn(conversation.create, 'invoke');
    const invoke = vi.spyOn(modelInference, 'invoke').mockImplementation(async ({ question }) => {
      const scope = JSON.parse(question.slice(question.indexOf('\n') + 1));
      return {
        status: 'ok',
        provider_id: 'default',
        model: 'connected',
        answer: JSON.stringify({ [scope.rows[0].id]: '根据本页数量变化核实需求' }),
      };
    });
    const props = {
      visible: true,
      rows,
      row,
      initialDimension: 'region' as const,
      drafts,
      t,
      client,
      onDraftsChange: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(<RegionalApprovalLiveAdjustmentDialog {...props} />);
    expect(await screen.findByText('根据本页数量变化核实需求')).toBeVisible();
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '生成审批建议' })).not.toBeInTheDocument();
    rerender(<RegionalApprovalLiveAdjustmentDialog {...props} />);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('exposes a failure with an independent retry that replaces the failure', async () => {
    const invoke = vi
      .spyOn(modelInference, 'invoke')
      .mockResolvedValueOnce({ status: 'timeout', provider_id: 'default', model: 'connected' });
    render(
      <RegionalApprovalLiveAdjustmentDialog
        visible
        rows={rows}
        row={row}
        initialDimension='region'
        drafts={drafts}
        t={t}
        client={client}
        onDraftsChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const retry = await screen.findByRole('button', { name: '重试未生成建议' });
    expect(retry).toBeEnabled();
    invoke.mockImplementation(async ({ question }) => {
      const scope = JSON.parse(question.slice(question.indexOf('\n') + 1));
      return {
        status: 'ok',
        provider_id: 'default',
        model: 'connected',
        answer: JSON.stringify({ [scope.rows[0].id]: '重试后意见' }),
      };
    });
    fireEvent.click(retry);
    expect(await screen.findByText('重试后意见')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试未生成建议' })).not.toBeInTheDocument());
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
