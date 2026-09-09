import { describe, expect, it } from 'vitest';
import {
  salesPlanAccessForRow,
  salesPlanStagesForPermissions,
  verifySavedSalesPlan,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/models/salesPlanAccessModel';
import type {
  GeaSalesPlanActionReceipt,
  GeaSalesPlanActionRequest,
  GeaSalesPlanDetail,
  GeaSalesPlanListItem,
  GeaSalesPlanSku,
} from '@/common/adapter/ipcBridge';

const row = { planId: 'p', versionId: 'v', status: 10 } as GeaSalesPlanListItem;
const detail = {
  currentVersion: { id: 'v', planId: 'p', status: 10, effective: true },
  skus: [],
  versions: [],
  logs: [],
  actionContext: { versionId: 'v', status: 10, nodeOrder: 5, allowedActions: ['SAVE'], snapshotHash: 'a'.repeat(64) },
} as GeaSalesPlanDetail;

describe('sales plan authoritative action projection', () => {
  it('defaults to no role and orders only explicit node permissions', () => {
    expect(salesPlanStagesForPermissions()).toEqual([]);
    expect(salesPlanStagesForPermissions(['sales-plan:plan:approve'])).toEqual([]);
    expect(
      salesPlanStagesForPermissions([
        'sales-plan:plan:category-approve',
        'sales-plan:plan:region-approve',
        'sales-plan:plan:region-approve',
      ])
    ).toEqual(['region', 'category']);
  });
  it('allows standalone category saving without inferring approval from readability', () => {
    expect(salesPlanAccessForRow(row, detail)?.allowedActions).toEqual(['SAVE']);
    expect(salesPlanAccessForRow(row, { ...detail, actionContext: undefined })).toBeUndefined();
  });
  it('rejects mismatched versions, status changes and malformed action metadata', () => {
    expect(salesPlanAccessForRow({ ...row, versionId: 'other' }, detail)).toBeUndefined();
    expect(salesPlanAccessForRow({ ...row, status: 5 }, detail)).toBeUndefined();
    expect(
      salesPlanAccessForRow(row, { ...detail, actionContext: { ...detail.actionContext!, snapshotHash: '' } })
    ).toBeUndefined();
  });
});

describe('same-version SAVE readback', () => {
  it('verifies saved decimals and audit receipt, rejecting stale quantities, lost edits and state advancement', () => {
    const sku = {
      id: 's',
      versionId: 'v',
      skuCode: '10001',
      price: '2',
      areaConfirmedQty: '12',
      categoryConfirmedQty: '13',
    } as GeaSalesPlanSku;
    const before = { ...detail, skus: [sku] };
    const receipt = {
      planId: 'p',
      versionId: 'v',
      fromStatus: 10,
      toStatus: 10,
      auditId: 'sales-plan-log:42',
      requestId: 'request',
      traceId: 'trace',
    } as GeaSalesPlanActionReceipt;
    const request: GeaSalesPlanActionRequest = {
      action: 'SAVE',
      expectedStatus: 10,
      adjustments: [{ skuCode: '10001', adjustQty: '2.125' }],
    };
    const after = {
      ...before,
      skus: [{ ...sku, categoryConfirmedQty: '15.125', categoryConfirmedAmount: '30.25' }],
      logs: [
        {
          id: '42',
          planId: 'p',
          requestId: 'request',
          traceId: 'trace',
          versionId: 'v',
          fromStatus: 10,
          toStatus: 10,
          actionCode: 'SAVE',
        },
      ],
    } as GeaSalesPlanDetail;
    expect(verifySavedSalesPlan(before, after, request, receipt)).toBe(true);
    expect(
      verifySavedSalesPlan(
        before,
        { ...after, skus: [{ ...after.skus[0], categoryConfirmedAmount: '26' }] },
        request,
        receipt
      )
    ).toBe(false);
    expect(verifySavedSalesPlan(before, { ...after, skus: [sku] }, request, receipt)).toBe(false);
    expect(verifySavedSalesPlan(before, { ...after, logs: [] }, request, receipt)).toBe(false);
    expect(
      verifySavedSalesPlan(
        before,
        { ...after, currentVersion: { ...after.currentVersion, id: 'new' } },
        request,
        receipt
      )
    ).toBe(false);
    expect(
      verifySavedSalesPlan(
        before,
        { ...after, currentVersion: { ...after.currentVersion, status: 5 } },
        request,
        receipt
      )
    ).toBe(false);
  });
});
