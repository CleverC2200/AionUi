import { describe, expect, it } from 'vitest';
import type { GeaSalesPlanSku } from '@/common/adapter/ipcBridge';
import {
  adjustmentDimensionsFrom,
  createSalesPlanAdjustmentRecords,
  distributeAggregateQuantity,
  groupSalesPlanAdjustmentRecords,
  updateAggregateAmount,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/models/salesPlanAdjustmentModel';
import { toRegionalApprovalLiveRow } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/regionalApprovalQueryModel';

const plan = (planId: string, dealerName: string) =>
  toRegionalApprovalLiveRow({
    planId,
    versionId: `${planId}-version`,
    seq: 1,
    periodId: 'period',
    planTypeCode: 'MONTHLY',
    dealerCode: `${planId}-dealer`,
    orgCode: 'anyang',
    provinceCode: 'henan',
    areaCode: 'east',
    areaName: '华东大区',
    provinceName: '河南省区',
    orgName: '安阳经销分区',
    baseName: '郑州基地',
    dealerName,
    status: 2,
    targetQty: '100',
    targetAmount: '1200',
    skuCount: 1,
    currentQty: '100',
    currentAmount: '1200',
  });

const sku = (versionId: string, id: string, baseQty: string): GeaSalesPlanSku => ({
  id,
  versionId,
  skuCode: '10005817',
  productCategName: '水饺',
  baseQty,
  qty: baseQty,
  price: '12',
  amt: String(Number(baseQty) * 12),
  amtBase: String(Number(baseQty) * 12),
});

describe('sales plan aggregate adjustment rules', () => {
  it('keeps the prototype dimension order from the clicked organization level', () => {
    expect(adjustmentDimensionsFrom('region')).toEqual(['region', 'base', 'customer']);
    expect(adjustmentDimensionsFrom('base')).toEqual(['base', 'customer']);
    expect(adjustmentDimensionsFrom('customer')).toEqual(['customer']);
  });

  it('aggregates equal SKUs and allocates by original base share with the last-row remainder', () => {
    const first = plan('first', '客户甲');
    const second = plan('second', '客户乙');
    const records = createSalesPlanAdjustmentRecords([
      { plan: first, skus: [sku(first.versionId, 'sku-first', '30')] },
      { plan: second, skus: [sku(second.versionId, 'sku-second', '70')] },
    ]);
    const [group] = groupSalesPlanAdjustmentRecords(records, 'region');

    expect(group).toMatchObject({ baseQty: '100', qty: '100', baseAmount: '1200', amount: '1200' });
    const distributed = distributeAggregateQuantity(group.records, 11);
    expect(distributed.map((record) => record.qty)).toEqual(['3', '8']);
    expect(distributed.map((record) => record.amount)).toEqual(['36', '96']);
    expect(distributed.reduce((sum, record) => sum + Number(record.qty), 0)).toBe(11);
  });

  it('links amount back to quantity before applying the same allocation rule', () => {
    const first = plan('first', '客户甲');
    const second = plan('second', '客户乙');
    const records = createSalesPlanAdjustmentRecords([
      { plan: first, skus: [sku(first.versionId, 'sku-first', '30')] },
      { plan: second, skus: [sku(second.versionId, 'sku-second', '70')] },
    ]);
    const [group] = groupSalesPlanAdjustmentRecords(records, 'region');
    const updated = updateAggregateAmount(records, group, 132);

    expect(updated.map((record) => record.qty)).toEqual(['3', '8']);
    expect(updated.map((record) => record.amount)).toEqual(['36', '96']);
  });

  it('does not invent an allocation when the original base total is zero', () => {
    const first = plan('first', '客户甲');
    const records = createSalesPlanAdjustmentRecords([{ plan: first, skus: [sku(first.versionId, 'sku-first', '0')] }]);
    const distributed = distributeAggregateQuantity(records, 5);

    expect(distributed).toEqual(records);
  });
});
