import { describe, expect, it } from 'vitest';
import {
  EMPTY_APPROVAL_DETAIL_STORE,
  approvalPlan,
  approvalPlanValidationErrors,
  isApprovalPlanDirty,
  reduceApprovalDetailStore,
  savedApprovalAdjustments,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/regionalApprovalDetailModel';
import { REGIONAL_APPROVAL_ROWS } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/regionalApprovalFixture';

const row = REGIONAL_APPROVAL_ROWS[0];

describe('regional approval detail model', () => {
  it('accepts, ignores, and restores Fixture AI guidance without a silent quantity change', () => {
    const initialPlan = approvalPlan(EMPTY_APPROVAL_DETAIL_STORE, row, 'current');
    const skuId = Object.keys(initialPlan.working)[0];
    const initial = initialPlan.working[skuId];

    const acceptedStore = reduceApprovalDetailStore(EMPTY_APPROVAL_DETAIL_STORE, row, 'current', {
      type: 'accept-suggestion',
      skuId,
    });
    const accepted = approvalPlan(acceptedStore, row, 'current').working[skuId];
    expect(accepted.editedQuantity).toBe(initial.aiQuantity);
    expect(accepted.suggestionDisposition).toBe('accepted');

    const ignoredStore = reduceApprovalDetailStore(acceptedStore, row, 'current', {
      type: 'ignore-suggestion',
      skuId,
    });
    const ignored = approvalPlan(ignoredStore, row, 'current').working[skuId];
    expect(ignored.editedQuantity).toBe(initial.initialQuantity);
    expect(ignored.suggestionDisposition).toBe('ignored');

    const restoredStore = reduceApprovalDetailStore(ignoredStore, row, 'current', {
      type: 'restore-suggestion',
      skuId,
    });
    expect(approvalPlan(restoredStore, row, 'current').working[skuId]).toMatchObject({
      editedQuantity: initial.initialQuantity,
      suggestionDisposition: 'pending',
    });
  });

  it('requires reasons only for changed required rows and saves validated changes into Context summaries', () => {
    const plan = approvalPlan(EMPTY_APPROVAL_DETAIL_STORE, row, 'current');
    const requiredSku = Object.values(plan.working).find((sku) => sku.reasonRequirement === 'required')!;
    let store = reduceApprovalDetailStore(EMPTY_APPROVAL_DETAIL_STORE, row, 'current', {
      type: 'edit',
      skuId: requiredSku.skuId,
      quantity: requiredSku.initialQuantity + 25,
    });
    expect(approvalPlanValidationErrors(approvalPlan(store, row, 'current'))).toEqual([requiredSku.skuId]);
    expect(savedApprovalAdjustments(store)).toEqual([]);

    store = reduceApprovalDetailStore(store, row, 'current', {
      type: 'reason',
      skuId: requiredSku.skuId,
      reason: 'Fixture 节庆备货调整',
    });
    expect(approvalPlanValidationErrors(approvalPlan(store, row, 'current'))).toEqual([]);
    store = reduceApprovalDetailStore(store, row, 'current', { type: 'save' });
    expect(isApprovalPlanDirty(approvalPlan(store, row, 'current'))).toBe(false);
    expect(savedApprovalAdjustments(store)).toEqual([
      expect.objectContaining({
        organizationId: row.id,
        version: 'current',
        skuId: requiredSku.skuId,
        editedQuantity: requiredSku.initialQuantity + 25,
        reason: 'Fixture 节庆备货调整',
      }),
    ]);
  });

  it('keeps retained working drafts and discards only the selected organization-version plan', () => {
    const currentPlan = approvalPlan(EMPTY_APPROVAL_DETAIL_STORE, row, 'current');
    const skuId = Object.keys(currentPlan.working)[1];
    const initial = currentPlan.working[skuId].initialQuantity;
    let store = reduceApprovalDetailStore(EMPTY_APPROVAL_DETAIL_STORE, row, 'current', {
      type: 'edit',
      skuId,
      quantity: initial + 10,
    });
    const retained = store;
    expect(isApprovalPlanDirty(approvalPlan(retained, row, 'current'))).toBe(true);

    store = reduceApprovalDetailStore(store, row, 'current', { type: 'discard' });
    expect(approvalPlan(store, row, 'current').working[skuId].editedQuantity).toBe(initial);
    expect(isApprovalPlanDirty(approvalPlan(store, row, 'current'))).toBe(false);
  });

  it('edits whole-plan quantity and amount, adopts every SKU suggestion, and applies one business reason', () => {
    const initialPlan = approvalPlan(EMPTY_APPROVAL_DETAIL_STORE, row, 'current');
    const initialQuantity = Object.values(initialPlan.working).reduce(
      (total, adjustment) => total + adjustment.editedQuantity,
      0
    );
    const initialAmount = Object.values(initialPlan.working).reduce(
      (total, adjustment) => total + adjustment.editedAmount,
      0
    );
    let store = reduceApprovalDetailStore(EMPTY_APPROVAL_DETAIL_STORE, row, 'current', {
      type: 'edit-plan-quantity',
      quantity: initialQuantity + 120,
    });
    store = reduceApprovalDetailStore(store, row, 'current', {
      type: 'edit-plan-amount',
      amount: initialAmount + 9600,
    });
    store = reduceApprovalDetailStore(store, row, 'current', {
      type: 'reason-all',
      reason: 'Fixture 整单促销调整',
    });
    let plan = approvalPlan(store, row, 'current');
    expect(Object.values(plan.working).reduce((total, item) => total + item.editedQuantity, 0)).toBe(
      initialQuantity + 120
    );
    expect(Object.values(plan.working).reduce((total, item) => total + item.editedAmount, 0)).toBe(
      initialAmount + 9600
    );
    expect(Object.values(plan.working).every((item) => item.reason === 'Fixture 整单促销调整')).toBe(true);

    store = reduceApprovalDetailStore(store, row, 'current', { type: 'accept-all-suggestions' });
    plan = approvalPlan(store, row, 'current');
    expect(Object.values(plan.working).every((item) => item.suggestionDisposition === 'accepted')).toBe(true);
    expect(Object.values(plan.working).reduce((total, item) => total + item.editedQuantity, 0)).toBe(
      Object.values(plan.working).reduce((total, item) => total + item.aiQuantity, 0)
    );
  });

  it('preserves store identity when controlled whole-plan inputs repeat their current value', () => {
    const plan = approvalPlan(EMPTY_APPROVAL_DETAIL_STORE, row, 'current');
    const quantity = Object.values(plan.working).reduce((total, item) => total + item.editedQuantity, 0);
    const amount = Object.values(plan.working).reduce((total, item) => total + item.editedAmount, 0);
    const initialized = reduceApprovalDetailStore(EMPTY_APPROVAL_DETAIL_STORE, row, 'current', {
      type: 'edit-plan-quantity',
      quantity,
    });

    const unchangedQuantity = reduceApprovalDetailStore(initialized, row, 'current', {
      type: 'edit-plan-quantity',
      quantity,
    });
    const unchangedAmount = reduceApprovalDetailStore(unchangedQuantity, row, 'current', {
      type: 'edit-plan-amount',
      amount,
    });
    const sku = Object.values(approvalPlan(initialized, row, 'current').working)[0];
    const unchangedSkuQuantity = reduceApprovalDetailStore(unchangedAmount, row, 'current', {
      type: 'edit',
      skuId: sku.skuId,
      quantity: sku.editedQuantity,
    });
    const unchangedSkuAmount = reduceApprovalDetailStore(unchangedSkuQuantity, row, 'current', {
      type: 'edit-amount',
      skuId: sku.skuId,
      amount: sku.editedAmount,
    });
    const unchangedReason = reduceApprovalDetailStore(unchangedSkuAmount, row, 'current', {
      type: 'reason-all',
      reason: '',
    });

    expect(unchangedQuantity).toBe(initialized);
    expect(unchangedAmount).toBe(initialized);
    expect(unchangedSkuQuantity).toBe(initialized);
    expect(unchangedSkuAmount).toBe(initialized);
    expect(unchangedReason).toBe(initialized);
  });
});
