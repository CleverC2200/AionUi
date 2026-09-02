import { describe, expect, it } from 'vitest';
import type {
  GeaSalesPlanApprovalLog,
  GeaSalesPlanDetail,
  GeaSalesPlanSku,
  GeaSalesPlanSkuDiff,
  GeaSalesPlanVersion,
} from '@/common/adapter/ipcBridge';
import {
  salesPlanComparisonMatches,
  salesPlanOverviewMatches,
  salesPlanSkusMatchVersion,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/models/salesPlanDetailModel';

const version = (id: string, planId = 'plan-1'): GeaSalesPlanVersion => ({
  id,
  planId,
  seq: id === 'version-2' ? 2 : 1,
  periodId: 'period-1',
  planTypeCode: 'MONTHLY',
  dealerCode: 'dealer-1',
  status: 4,
  effective: id === 'version-2',
  targetAmount: '200.00',
  targetQty: '20',
});

const sku = (versionId: string): GeaSalesPlanSku => ({
  id: `${versionId}-sku-1`,
  versionId,
  skuCode: 'SKU-1',
  productCategName: '饮品',
  baseQty: '10',
  qty: '12',
  price: '8.50',
  amt: '102.00',
  amtBase: '85.00',
});

const log = (versionId: string, planId = 'plan-1'): GeaSalesPlanApprovalLog => ({
  id: `${versionId}-log-1`,
  planId,
  versionId,
  toStatus: 4,
  actionCode: 'SUBMIT',
  operatorCode: 'operator-1',
  actionAt: '2026-09-01T08:00:00Z',
});

const detail = (currentVersion: GeaSalesPlanVersion): GeaSalesPlanDetail => ({
  currentVersion,
  // These nested arrays are deliberately inconsistent. The model treats only
  // the independent version/SKU/log endpoints as authoritative.
  skus: [sku('nested-stale-version')],
  versions: [version('nested-stale-version')],
  logs: [log('nested-stale-version')],
});

describe('salesPlanDetailModel', () => {
  it('accepts independent version and log resources for the exact queue plan/version', () => {
    const versions = [version('version-2'), version('version-1')];
    expect(
      salesPlanOverviewMatches('plan-1', 'version-2', detail(version('version-2')), versions, [log('version-1')])
    ).toBe(true);
  });

  it('rejects a detail current version that no longer matches the queue version', () => {
    const versions = [version('version-3'), version('version-2')];
    expect(salesPlanOverviewMatches('plan-1', 'version-2', detail(version('version-3')), versions, [])).toBe(false);
  });

  it('rejects resources belonging to another plan or an unknown version', () => {
    const versions = [version('version-2'), version('version-1')];
    expect(
      salesPlanOverviewMatches('plan-1', 'version-2', detail(version('version-2')), versions, [log('unknown')])
    ).toBe(false);
    expect(
      salesPlanOverviewMatches(
        'plan-1',
        'version-2',
        detail(version('version-2')),
        [version('version-2', 'plan-2')],
        []
      )
    ).toBe(false);
  });

  it('validates SKU and comparison version ownership without coercing values', () => {
    expect(salesPlanSkusMatchVersion('version-2', [sku('version-2')])).toBe(true);
    expect(salesPlanSkusMatchVersion('version-2', [sku('version-1')])).toBe(false);

    const difference: GeaSalesPlanSkuDiff = {
      skuCode: 'SKU-1',
      changeType: 'UPDATED',
      before: sku('version-1'),
      after: sku('version-2'),
      qtyDelta: '2',
      amountDelta: '17.00',
    };
    expect(salesPlanComparisonMatches('version-1', 'version-2', [difference])).toBe(true);
    expect(salesPlanComparisonMatches('version-2', 'version-1', [difference])).toBe(false);
  });

  it('rejects comparison rows whose top-level and snapshot SKU identities disagree', () => {
    const mismatch: GeaSalesPlanSkuDiff = {
      skuCode: 'SKU-OTHER',
      changeType: 'UPDATED',
      before: sku('version-1'),
      after: sku('version-2'),
      qtyDelta: '2',
      amountDelta: '17.00',
    };
    expect(salesPlanComparisonMatches('version-1', 'version-2', [mismatch])).toBe(false);
  });

  it('requires ADDED, DELETED, and UPDATED rows to carry their exact snapshot shape', () => {
    const added: GeaSalesPlanSkuDiff = {
      skuCode: 'SKU-1',
      changeType: 'ADDED',
      after: sku('version-2'),
      qtyDelta: '12',
      amountDelta: '102.00',
    };
    const deleted: GeaSalesPlanSkuDiff = {
      skuCode: 'SKU-1',
      changeType: 'DELETED',
      before: sku('version-1'),
      qtyDelta: '-12',
      amountDelta: '-102.00',
    };
    const updated: GeaSalesPlanSkuDiff = {
      skuCode: 'SKU-1',
      changeType: 'UPDATED',
      before: sku('version-1'),
      after: sku('version-2'),
      qtyDelta: '2',
      amountDelta: '17.00',
    };

    expect(salesPlanComparisonMatches('version-1', 'version-2', [added, deleted, updated])).toBe(true);
    expect(salesPlanComparisonMatches('version-1', 'version-2', [{ ...added, before: sku('version-1') }])).toBe(false);
    expect(salesPlanComparisonMatches('version-1', 'version-2', [{ ...deleted, after: sku('version-2') }])).toBe(false);
    expect(salesPlanComparisonMatches('version-1', 'version-2', [{ ...updated, after: undefined }])).toBe(false);
  });
});
