import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TFunction } from 'i18next';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type {
  GeaSalesPlanDetail,
  GeaSalesPlanPeriod,
  GeaSalesPlanSku,
  GeaSalesPlanSubmitParams,
} from '@/common/adapter/ipcBridge';
import RegionalApprovalLiveSubmitDialog from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/RegionalApprovalLiveSubmitDialog';
import type { SalesPlanSubmitClient } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/models/salesPlanSubmitModel';
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

const period: GeaSalesPlanPeriod = {
  periodId: '9007199254740993',
  tenantId: '9007199254740995',
  periodMonth: '2026-09',
  planType: '月度计划',
  planTypeCode: 'MONTHLY',
  status: 'OPEN',
};

const row = {
  source: 'gea' as const,
  approvalState: 'returned' as const,
  planId: 'p-jxs-2026-09-00001',
  versionId: '9007199254741000',
  seq: 4,
  periodId: period.periodId,
  planTypeCode: period.planTypeCode,
  dealerCode: '9007199254740997',
  orgCode: 'ORG-REAL',
  baseName: '真实基地',
  status: 9,
  targetQty: '1.234',
  targetAmount: '2.47',
  skuCount: 1,
  currentQty: '1.234',
  currentAmount: '2.47',
  channelCode: 'jxs',
};

const realSku: GeaSalesPlanSku = {
  id: '9007199254741100',
  versionId: row.versionId,
  skuCode: '9007199254741200',
  productCategName: '速冻食品',
  baseQty: '1.000',
  qty: '1.234',
  price: '2.0000',
  amt: '2.47',
  amtBase: '2.00',
};

const detail: GeaSalesPlanDetail = {
  currentVersion: {
    id: row.versionId,
    planId: row.planId,
    seq: row.seq,
    periodId: row.periodId,
    planTypeCode: row.planTypeCode,
    dealerCode: row.dealerCode,
    orgCode: row.orgCode,
    baseName: row.baseName,
    status: row.status,
    effective: true,
    targetQty: row.targetQty,
    targetAmount: row.targetAmount,
  },
  skus: [{ ...realSku, versionId: 'stale-version', skuCode: '1', qty: '999.000' }],
  versions: [],
  logs: [],
};

const receipt = (command: GeaSalesPlanSubmitParams, replayed = false) => ({
  planId: row.planId,
  versionId: '9007199254742000',
  seq: 5,
  status: 4,
  replayed,
  requestId: command.requestId,
  traceId: 'trace-real',
  auditId: 'audit-real',
});

const createClient = (submit: SalesPlanSubmitClient['submit']['invoke']): SalesPlanSubmitClient => ({
  detail: { invoke: vi.fn().mockResolvedValue(detail) },
  versionSkus: { invoke: vi.fn().mockResolvedValue([realSku]) },
  currentUser: { invoke: vi.fn().mockResolvedValue({ id: 'current-user', username: '当前用户' }) },
  submit: { invoke: vi.fn(submit) },
});

describe('RegionalApprovalLiveSubmitDialog', () => {
  it('submits only independent versionSkus and renders a validated receipt', async () => {
    const client = createClient(async (command) => receipt(command));
    const onSucceeded = vi.fn();
    render(
      <RegionalApprovalLiveSubmitDialog
        visible
        row={row}
        period={period}
        t={t}
        client={client}
        onSucceeded={onSucceeded}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '真实销售计划退回重提' });
    expect(await within(dialog).findByText(/1 个 SKU · 提报汇总 1.234 · ¥2.47/)).toBeVisible();
    expect(within(dialog).getByText(/计划目标 1.234 · ¥2.47/)).toBeVisible();
    expect(client.versionSkus.invoke).toHaveBeenCalledWith({
      versionId: row.versionId,
      signal: expect.any(AbortSignal),
    });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认重提' }));

    expect(await within(dialog).findByText(/服务端已确认计划.*审计 audit-real/)).toBeVisible();
    await waitFor(() => expect(onSucceeded).toHaveBeenCalledTimes(1));
    const command = vi.mocked(client.submit.invoke).mock.calls[0][0];
    expect(command.request.items).toEqual([expect.objectContaining({ skuCode: realSku.skuCode, qty: '1.234' })]);
    expect(command.request.targetQty).toBe('1.234');
    expect(command.request.targetAmount).toBe('2.47');
    expect(command.request.items).not.toContainEqual(expect.objectContaining({ skuCode: '1' }));
  });

  it('retries an unknown result with the same command and body', async () => {
    const client = createClient(
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError('renderer-to-core disconnected'))
        .mockImplementationOnce(async (command) => receipt(command, true))
    );
    render(
      <RegionalApprovalLiveSubmitDialog
        visible
        row={row}
        period={period}
        t={t}
        client={client}
        onSucceeded={vi.fn()}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '真实销售计划退回重提' });
    await within(dialog).findByText(/真实重提来源已校验/);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认重提' }));
    expect(await within(dialog).findByText(/结果暂时未知/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '关闭' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '以原幂等键重试' }));
    expect(await within(dialog).findByText(/幂等回放/)).toBeVisible();

    const calls = vi.mocked(client.submit.invoke).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toEqual(calls[0][0]);
  });

  it('fails closed when the independent version SKU list conflicts with the current version', async () => {
    const client = createClient(async (command) => receipt(command));
    vi.mocked(client.versionSkus.invoke).mockResolvedValue([{ ...realSku, versionId: 'other-version' }]);
    render(
      <RegionalApprovalLiveSubmitDialog
        visible
        row={row}
        period={period}
        t={t}
        client={client}
        onSucceeded={vi.fn()}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '真实销售计划退回重提' });
    expect(await within(dialog).findByText(/SKU 或汇总证据不一致/)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '确认重提' })).toBeDisabled();
    expect(client.submit.invoke).not.toHaveBeenCalled();
  });

  it.each([
    [429, /请求过于频繁/],
    [503, /服务仍不可用/],
  ] as const)(
    'treats final HTTP %s as known and does not open a second client retry round',
    async (status, message) => {
      const finalHttpFailure = new BackendHttpError({
        method: 'POST',
        path: '/submissions',
        status,
        body: { code: 'FINAL_HTTP_FAILURE', details: { retryAfterMs: 3_000 } },
      });
      const client = createClient(vi.fn().mockRejectedValue(finalHttpFailure));
      const onRefresh = vi.fn();
      const onClose = vi.fn();
      render(
        <RegionalApprovalLiveSubmitDialog
          visible
          row={row}
          period={period}
          t={t}
          client={client}
          onSucceeded={vi.fn()}
          onRefresh={onRefresh}
          onClose={onClose}
        />
      );

      const dialog = screen.getByRole('dialog', { name: '真实销售计划退回重提' });
      expect(await within(dialog).findByText(/真实重提来源已校验/)).toBeVisible();
      fireEvent.click(within(dialog).getByRole('checkbox'));
      fireEvent.click(within(dialog).getByRole('button', { name: '确认重提' }));
      expect(await within(dialog).findByText(message)).toBeVisible();
      expect(within(dialog).getByRole('button', { name: '关闭' })).toBeEnabled();
      expect(within(dialog).queryByRole('button', { name: '以原幂等键重试' })).not.toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: '刷新权威状态' }));
      expect(client.submit.invoke).toHaveBeenCalledTimes(1);
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  );

  it('stops after three retryable calls and offers an authoritative refresh', async () => {
    const client = createClient(vi.fn().mockRejectedValue(new TypeError('renderer-to-core disconnected')));
    const onRefresh = vi.fn();
    const onClose = vi.fn();
    render(
      <RegionalApprovalLiveSubmitDialog
        visible
        row={row}
        period={period}
        t={t}
        client={client}
        onSucceeded={vi.fn()}
        onRefresh={onRefresh}
        onClose={onClose}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '真实销售计划退回重提' });
    await within(dialog).findByText(/真实重提来源已校验/);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认重提' }));
    await within(dialog).findByText(/结果暂时未知/);
    fireEvent.click(within(dialog).getByRole('button', { name: '以原幂等键重试' }));
    await waitFor(() => expect(client.submit.invoke).toHaveBeenCalledTimes(2));
    fireEvent.click(within(dialog).getByRole('button', { name: '以原幂等键重试' }));

    expect(await within(dialog).findByText(/三次总调用预算已用尽/)).toBeVisible();
    expect(client.submit.invoke).toHaveBeenCalledTimes(3);
    expect(within(dialog).queryByRole('button', { name: '以原幂等键重试' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '刷新权威状态' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
