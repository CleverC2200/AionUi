import { describe, expect, it } from 'vitest';
import {
  SALES_PLAN_STATUS_BY_STAGE,
  addExactDecimals,
  approvalStageForSalesPlanStatus,
  chooseInitialSalesPlanPeriod,
  formatExactDecimal,
  toRegionalApprovalLiveRow,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/regionalApprovalQueryModel';

describe('regionalApprovalQueryModel', () => {
  it('maps all five approval stages to the frozen GEA page status semantics', () => {
    expect(SALES_PLAN_STATUS_BY_STAGE).toEqual({ customer: 1, region: 2, province: 3, area: 4, category: 5 });
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(approvalStageForSalesPlanStatus)).toEqual([
      'customer',
      'region',
      'province',
      'area',
      'category',
      'customer',
      'region',
      'province',
      'area',
      'category',
    ]);
  });

  it('chooses an open period without coercing its Long identifiers', () => {
    const selected = chooseInitialSalesPlanPeriod([
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
    ]);

    expect(selected?.periodId).toBe('9007199254740995');
  });

  it('adds and formats decimal text exactly beyond the JavaScript safe integer range', () => {
    expect(addExactDecimals(['9999999999999999.99', '0.01', '123456789012.345'])).toBe('10000123456789012.345');
    expect(formatExactDecimal('10000123456789012.345')).toBe('10,000,123,456,789,012.345');
  });

  it('keeps the wire identifiers and decimals unchanged in the shared live-row domain model', () => {
    const row = toRegionalApprovalLiveRow({
      planId: 'plan-1',
      versionId: 'version-1',
      seq: 1,
      periodId: '9007199254740993',
      planTypeCode: 'MONTHLY',
      dealerCode: '9007199254740997',
      status: 4,
      targetQty: '123456789012.345',
      targetAmount: '9999999999999999.99',
      skuCount: 1,
      currentQty: '123456789012.340',
      currentAmount: '9999999999999999.90',
    });

    expect(row).toMatchObject({
      source: 'gea',
      periodId: '9007199254740993',
      dealerCode: '9007199254740997',
      targetAmount: '9999999999999999.99',
      approvalState: 'pending',
    });
  });
});
