import { describe, expect, it } from 'vitest';
import type {
  GeaSalesPlanActionReceipt,
  GeaSalesPlanListItem,
  GeaSalesPlanSubmitReceipt,
} from '@/common/adapter/ipcBridge';
import {
  buildSalesPlanFilterSummary,
  projectFixtureSalesPlanContext,
  projectSalesPlanActionContext,
  projectSalesPlanQueryContext,
  projectSalesPlanSubmitContext,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/models/salesPlanContextModel';

const filters = buildSalesPlanFilterSummary({
  periodMonth: '2026-09',
  planTypeCode: 'MONTHLY',
  approvalStage: 'area',
  queueMode: 'approval',
  appliedFilters: {
    area: 'east',
    branch: 'all',
    department: 'all',
    customer: 'customer-a',
  },
});

const row: GeaSalesPlanListItem = {
  planId: 'plan-1',
  versionId: 'version-7',
  seq: 7,
  periodId: 'period-1',
  planTypeCode: 'MONTHLY',
  dealerCode: '10001',
  status: 3,
  targetQty: '10.000',
  targetAmount: '20.00',
  skuCount: 1,
  currentQty: '10.000',
  currentAmount: '20.00',
};

const actionReceipt: GeaSalesPlanActionReceipt = {
  planId: 'plan-1',
  versionId: 'version-7',
  fromStatus: 3,
  toStatus: 4,
  replayed: true,
  requestId: 'request-action-1',
  traceId: 'trace-action-1',
  auditId: 'audit-action-1',
};

const submitReceipt: GeaSalesPlanSubmitReceipt = {
  planId: 'plan-1',
  versionId: 'version-8',
  seq: 8,
  status: 3,
  replayed: false,
  requestId: 'request-submit-1',
  traceId: 'trace-submit-1',
  auditId: 'audit-submit-1',
};

const returnedRow: GeaSalesPlanListItem = { ...row, status: 8 };

describe('sales plan Context projection', () => {
  it('projects a live query through an explicit safe-field whitelist', () => {
    const context = projectSalesPlanQueryContext(
      {
        ...row,
        client_secret: 'never-serialize',
        nested: { access_token: 'never-serialize', Authorization: 'Bearer secret' },
        items: [{ skuCode: '1', qty: '10' }],
      } as GeaSalesPlanListItem,
      filters
    );

    expect(context).toEqual({
      source: 'gea-user-session-query',
      filterSummary: {
        periodMonth: '2026-09',
        planTypeCode: 'MONTHLY',
        approvalStage: 'area',
        queueMode: 'approval',
        organizationFilterCount: 2,
      },
      planId: 'plan-1',
      versionId: 'version-7',
      seq: 7,
      status: 3,
    });
    expect(JSON.stringify(context)).not.toMatch(/secret|token|authorization|items|sku|permission/i);
  });

  it('projects replayed approval and service-submit receipts without their request payloads', () => {
    expect(projectSalesPlanActionContext(row, actionReceipt, filters)).toEqual({
      source: 'gea-user-session-action',
      filterSummary: filters,
      planId: 'plan-1',
      versionId: 'version-7',
      seq: 7,
      status: 4,
      replayed: true,
      requestId: 'request-action-1',
      traceId: 'trace-action-1',
      auditId: 'audit-action-1',
    });
    expect(projectSalesPlanSubmitContext(returnedRow, submitReceipt, filters)).toEqual({
      source: 'gea-service-submit',
      filterSummary: filters,
      planId: 'plan-1',
      versionId: 'version-8',
      seq: 8,
      status: 3,
      replayed: false,
      requestId: 'request-submit-1',
      traceId: 'trace-submit-1',
      auditId: 'audit-submit-1',
    });
  });

  it('fails closed for mismatched, incomplete, or untrusted receipts', () => {
    expect(projectSalesPlanActionContext(row, { ...actionReceipt, planId: 'plan-2' }, filters)).toBeUndefined();
    expect(projectSalesPlanActionContext(row, { ...actionReceipt, traceId: '' }, filters)).toBeUndefined();
    expect(
      projectSalesPlanSubmitContext(returnedRow, { ...submitReceipt, versionId: returnedRow.versionId }, filters)
    ).toBeUndefined();
    expect(
      projectSalesPlanSubmitContext(returnedRow, { ...submitReceipt, requestId: 'line\nbreak' }, filters)
    ).toBeUndefined();
  });

  it('fails closed when replayed is not a runtime boolean', () => {
    expect(
      projectSalesPlanActionContext(
        row,
        {
          ...actionReceipt,
          replayed: {
            Authorization: 'Bearer secret',
            payload: { access_token: 'secret' },
          },
        } as unknown as GeaSalesPlanActionReceipt,
        filters
      )
    ).toBeUndefined();
    expect(
      projectSalesPlanSubmitContext(
        returnedRow,
        { ...submitReceipt, replayed: 'false' } as unknown as GeaSalesPlanSubmitReceipt,
        filters
      )
    ).toBeUndefined();
  });

  it('keeps Fixture and live authority visibly distinct', () => {
    expect(projectFixtureSalesPlanContext(filters)).toEqual({
      source: 'fixture',
      filterSummary: filters,
    });
  });
});
