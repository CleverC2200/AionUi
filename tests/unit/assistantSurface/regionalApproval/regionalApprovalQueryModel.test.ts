import { describe, expect, it } from 'vitest';
import {
  SALES_PLAN_STATUS_BY_STAGE,
  addExactDecimals,
  approvalStageForSalesPlanStatus,
  approvalStageProgressForSalesPlanStatusTotals,
  chooseInitialSalesPlanPeriod,
  formatExactDecimal,
  toRegionalApprovalLiveRow,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/regionalApprovalQueryModel';

describe('regionalApprovalQueryModel', () => {
  it('maps all five approval stages to the frozen GEA page status semantics', () => {
    expect(SALES_PLAN_STATUS_BY_STAGE).toEqual({ customer: 6, region: 1, province: 2, area: 3, category: 4 });
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(approvalStageForSalesPlanStatus)).toEqual([
      'region',
      'province',
      'area',
      'category',
      'category',
      'customer',
      'region',
      'province',
      'area',
      'category',
    ]);
  });

  it('calculates each node arrival ratio from permission-scoped status totals', () => {
    expect(
      approvalStageProgressForSalesPlanStatusTotals(10, {
        6: 1,
        1: 2,
        7: 1,
        2: 2,
        8: 0,
        3: 1,
        9: 0,
        4: 4,
      })
    ).toEqual({
      customer: 90,
      region: 70,
      province: 80,
      area: 90,
      category: 60,
    });
    expect(approvalStageProgressForSalesPlanStatusTotals(0, {})).toEqual({
      customer: 0,
      region: 0,
      province: 0,
      area: 0,
      category: 0,
    });
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

  it('treats status 5 as category approval completed under the latest business mapping', () => {
    const row = toRegionalApprovalLiveRow({
      planId: 'plan-1',
      versionId: 'version-1',
      seq: 1,
      periodId: 'period-1',
      planTypeCode: 'MONTHLY',
      dealerCode: 'dealer-1',
      status: 5,
      targetQty: '1',
      targetAmount: '1',
      skuCount: 1,
      currentQty: '1',
      currentAmount: '1',
    });

    expect(row.approvalState).toBe('approved');
  });

  it('keeps legacy completed status 10 visible and read-only', () => {
    const row = toRegionalApprovalLiveRow({
      planId: 'plan-10',
      versionId: 'version-10',
      seq: 1,
      periodId: 'period-1',
      planTypeCode: 'MONTHLY',
      dealerCode: 'dealer-1',
      status: 10,
      targetQty: '1',
      targetAmount: '1',
      skuCount: 1,
      currentQty: '1',
      currentAmount: '1',
    });

    expect(row.approvalState).toBe('approved');
  });
});
