import { BackendHttpError } from '@/common/adapter/httpBridge';
import type {
  GeaSalesPlanDetail,
  GeaSalesPlanPeriod,
  GeaSalesPlanSku,
  GeaSalesPlanSubmitParams,
  GeaSalesPlanSubmitReceipt,
} from '@/common/adapter/ipcBridge';
import {
  SalesPlanSubmitAttempt,
  SalesPlanSubmitError,
  prepareSalesPlanResubmit,
  type SalesPlanResubmitSource,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/models/salesPlanSubmitModel';
import { describe, expect, it, vi } from 'vitest';

const period: GeaSalesPlanPeriod = {
  periodId: '9007199254740993',
  tenantId: '9007199254740995',
  periodMonth: '2026-09',
  planType: '月度计划',
  planTypeCode: 'MONTHLY',
  status: 'OPEN',
};

const sku = (overrides: Partial<GeaSalesPlanSku> = {}): GeaSalesPlanSku => ({
  id: '9007199254741100',
  versionId: '9007199254741000',
  skuCode: '9007199254741200',
  productCategName: '速冻食品',
  baseQty: '1.000',
  qty: '1.234',
  price: '2.0000',
  amt: '2.47',
  amtBase: '2.00',
  ...overrides,
});

const detail: GeaSalesPlanDetail = {
  currentVersion: {
    id: '9007199254741000',
    planId: 'p-jxs-2026-09-00001',
    seq: 4,
    periodId: period.periodId,
    planTypeCode: period.planTypeCode,
    dealerCode: '9007199254740997',
    orgCode: 'ORG-REAL',
    provinceCode: 'PROVINCE-REAL',
    areaCode: 'AREA-REAL',
    baseName: '真实基地',
    status: 9,
    effective: true,
    targetQty: '3.234',
    targetAmount: '4.48',
  },
  // Nested detail resources are deliberately stale and must never supply submit items.
  skus: [sku({ versionId: 'stale-version', skuCode: '1', qty: '999.000' })],
  versions: [],
  logs: [],
};

const source = (overrides: Partial<SalesPlanResubmitSource> = {}): SalesPlanResubmitSource => ({
  period,
  planId: detail.currentVersion.planId,
  versionId: detail.currentVersion.id,
  detail,
  skus: [sku(), sku({ id: '9007199254741101', skuCode: '9007199254741201', qty: '2', price: '1.005' })],
  currentUser: { id: 'current-user', username: '当前用户' },
  channelCode: 'jxs',
  ...overrides,
});

const receiptFor = (command: GeaSalesPlanSubmitParams): GeaSalesPlanSubmitReceipt => ({
  planId: command.request.channelCode === 'jxs' ? detail.currentVersion.planId : 'wrong-plan',
  versionId: '9007199254742000',
  seq: 5,
  status: 4,
  replayed: false,
  requestId: command.requestId,
  traceId: 'trace-real',
  auditId: 'audit-real',
});

describe('sales plan resubmit model', () => {
  it('builds exact-decimal items from versionSkus and ignores conflicting nested detail SKUs', () => {
    const input = prepareSalesPlanResubmit(source());

    expect(input.request).toMatchObject({
      periodId: '9007199254740993',
      dealerCode: '9007199254740997',
      channelCode: 'jxs',
      targetQty: '3.234',
      targetAmount: '4.48',
      submitterCode: 'current-user',
    });
    expect(input.request.items).toEqual([
      {
        skuCode: '9007199254741200',
        productCategName: '速冻食品',
        baseQty: '1.000',
        qty: '1.234',
        price: '2.0000',
      },
      {
        skuCode: '9007199254741201',
        productCategName: '速冻食品',
        baseQty: '1.000',
        qty: '2.000',
        price: '1.0050',
      },
    ]);
    expect(input.request.items).not.toContainEqual(expect.objectContaining({ skuCode: '1' }));
    expect(input.sourceSummary).toEqual({
      skuCount: 2,
      submittedQty: '3.234',
      submittedAmount: '4.48',
    });
  });

  it('preserves plan targets independently from the submitted SKU rollup', () => {
    const input = prepareSalesPlanResubmit(
      source({
        detail: {
          ...detail,
          currentVersion: {
            ...detail.currentVersion,
            targetQty: '4',
            targetAmount: '9.99',
          },
        },
      })
    );

    expect(input.request).toMatchObject({ targetQty: '4.000', targetAmount: '9.99' });
    expect(input.sourceSummary).toMatchObject({ submittedQty: '3.234', submittedAmount: '4.48' });
  });

  it('derives the channel code from the server-generated business plan ID', () => {
    const input = prepareSalesPlanResubmit(source({ channelCode: undefined }));

    expect(input.request.channelCode).toBe('jxs');
    expect(input.request.targetQty).toBe('3.234');
    expect(input.request.targetAmount).toBe('4.48');
  });

  it.each([
    ['duplicate SKU', source({ skus: [sku(), sku({ id: '2' })] })],
    ['foreign version SKU', source({ skus: [sku({ versionId: 'other-version' })] })],
    ['non-authoritative plan id', source({ planId: 'fixture-plan' })],
    ['invalid authoritative channel code', source({ channelCode: 'JXS-from-plan-id' })],
    ['channel code conflicting with the business plan ID', source({ channelCode: 'ka' })],
  ])('rejects %s before transport', (_label, invalidSource) => {
    expect(() => prepareSalesPlanResubmit(invalidSource)).toThrowError(
      expect.objectContaining({ kind: 'sourceMismatch' })
    );
  });

  it.each([
    [6, 1],
    [7, 2],
    [8, 3],
    [9, 4],
  ])('maps returned status %s to resubmitted status %s', (status, expectedStatus) => {
    const input = prepareSalesPlanResubmit(
      source({
        detail: {
          ...detail,
          currentVersion: { ...detail.currentVersion, status },
        },
      })
    );
    expect(input.expected.nextStatus).toBe(expectedStatus);
  });

  it.each([
    ['empty SKU source', []],
    ['more than 5,000 SKUs', Array.from({ length: 5_001 }, () => sku())],
  ])('rejects %s before iterating submit items', (_label, skus) => {
    expect(() => prepareSalesPlanResubmit(source({ skus }))).toThrowError(
      expect.objectContaining({ kind: 'sourceMismatch' })
    );
  });

  it('shares the in-flight promise for a double click and validates the receipt', async () => {
    let resolve!: (receipt: GeaSalesPlanSubmitReceipt) => void;
    const invoke = vi.fn(
      (command: GeaSalesPlanSubmitParams) =>
        new Promise<GeaSalesPlanSubmitReceipt>((next) => {
          resolve = next;
        })
    );
    const attempt = new SalesPlanSubmitAttempt(
      { submit: { invoke } },
      vi.fn().mockReturnValueOnce('key').mockReturnValueOnce('request')
    );
    const input = prepareSalesPlanResubmit(source());

    const first = attempt.submit(input);
    const second = attempt.submit(input);
    expect(second).toBe(first);
    expect(invoke).toHaveBeenCalledTimes(1);
    resolve(receiptFor(invoke.mock.calls[0][0]));
    await expect(first).resolves.toMatchObject({ planId: detail.currentVersion.planId, status: 4 });
  });

  it('retries an unknown result with the exact same command and rejects deterministic conflicts', async () => {
    const input = prepareSalesPlanResubmit(source());
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network disconnected'))
      .mockImplementationOnce(async (command: GeaSalesPlanSubmitParams) => ({
        ...receiptFor(command),
        replayed: true,
      }));
    const attempt = new SalesPlanSubmitAttempt(
      { submit: { invoke } },
      vi.fn().mockReturnValueOnce('key').mockReturnValueOnce('request')
    );

    await expect(attempt.submit(input)).rejects.toMatchObject({ kind: 'unavailable', retrySameIntent: true });
    await expect(attempt.retry()).resolves.toMatchObject({ replayed: true });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][0]).toEqual(invoke.mock.calls[0][0]);

    for (const status of [400, 403, 409]) {
      const failure = new BackendHttpError({ method: 'POST', path: '/submissions', status, body: { code: 'TEST' } });
      const deterministicInvoke = vi.fn().mockRejectedValue(failure);
      const deterministicAttempt = new SalesPlanSubmitAttempt(
        { submit: { invoke: deterministicInvoke } },
        vi.fn().mockReturnValueOnce('key').mockReturnValueOnce('request')
      );
      await expect(deterministicAttempt.submit(input)).rejects.toBeInstanceOf(SalesPlanSubmitError);
      await expect(deterministicAttempt.retry()).rejects.toMatchObject({ retrySameIntent: false });
      expect(deterministicInvoke).toHaveBeenCalledTimes(1);
    }
  });

  it('enforces one three-call budget across mixed retryable failures and preserves the exact command', async () => {
    const input = prepareSalesPlanResubmit(source());
    const mismatch = (command: GeaSalesPlanSubmitParams) => ({
      ...receiptFor(command),
      requestId: 'mismatched-request',
    });
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network disconnected'))
      .mockImplementationOnce(async (command: GeaSalesPlanSubmitParams) => mismatch(command))
      .mockRejectedValueOnce(new TypeError('network disconnected again'));
    const attempt = new SalesPlanSubmitAttempt(
      { submit: { invoke } },
      vi.fn().mockReturnValueOnce('key').mockReturnValueOnce('request')
    );

    await expect(attempt.submit(input)).rejects.toMatchObject({ kind: 'unavailable', retrySameIntent: true });
    await expect(attempt.retry()).rejects.toMatchObject({ kind: 'unavailable', retrySameIntent: true });
    await expect(attempt.retry()).rejects.toMatchObject({ kind: 'retryExhausted', retrySameIntent: false });
    await expect(attempt.retry()).rejects.toMatchObject({ kind: 'retryExhausted', retrySameIntent: false });

    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      invoke.mock.calls[0][0],
      invoke.mock.calls[0][0],
      invoke.mock.calls[0][0],
    ]);
  });

  it.each([
    [429, 'rateLimited'],
    [503, 'serviceUnavailable'],
  ] as const)('does not open a second client retry round after final HTTP %s', async (status, kind) => {
    const input = prepareSalesPlanResubmit(source());
    const finalHttpFailure = new BackendHttpError({
      method: 'POST',
      path: '/submissions',
      status,
      body: { code: 'FINAL_HTTP_FAILURE', details: { retryAfterMs: 5_000 } },
    });
    const invoke = vi.fn().mockRejectedValue(finalHttpFailure);
    const attempt = new SalesPlanSubmitAttempt(
      { submit: { invoke } },
      vi.fn().mockReturnValueOnce('key').mockReturnValueOnce('request')
    );

    await expect(attempt.submit(input)).rejects.toMatchObject({ kind, retrySameIntent: false });
    await expect(attempt.retry()).rejects.toMatchObject({ kind, retrySameIntent: false });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
