import type {
  GeaSalesPlanActionContext,
  GeaSalesPlanActionReceipt,
  GeaSalesPlanActionRequest,
  GeaSalesPlanDetail,
  GeaSalesPlanListItem,
  GeaSalesPlanSku,
} from '@/common/adapter/ipcBridge';
import { addExactDecimals, multiplyExactDecimals } from '../regionalApprovalQueryModel';
import { salesPlanSkusMatchVersion } from './salesPlanDetailModel';
import { salesPlanActionTargetStatus, salesPlanApprovalNodeForStatus } from './salesPlanActionModel';
import type { ApprovalStageId } from '../regionalApprovalFixture';

const NODE_PERMISSIONS: readonly [ApprovalStageId, string][] = [
  ['customer', 'sales-confirm'],
  ['region', 'region-approve'],
  ['province', 'province-approve'],
  ['area', 'area-approve'],
  ['category', 'category-approve'],
];

/** Role permissions choose UI entry points; object-level actionContext still authorizes writes. */
export const salesPlanStagesForPermissions = (permissions: readonly string[] = []): ApprovalStageId[] =>
  NODE_PERMISSIONS.filter(([, permission]) => permissions.includes(`sales-plan:plan:${permission}`)).map(
    ([stage]) => stage
  );

/** Capabilities come from the existing authenticated detail response, never from row visibility. */
export const salesPlanAccessForRow = (
  row: Pick<GeaSalesPlanListItem, 'planId' | 'versionId' | 'status'>,
  detail: GeaSalesPlanDetail
): GeaSalesPlanActionContext | undefined => {
  const context = detail.actionContext;
  if (
    !context ||
    detail.currentVersion.id !== row.versionId ||
    detail.currentVersion.planId !== row.planId ||
    !detail.currentVersion.effective ||
    detail.currentVersion.status !== row.status ||
    context.versionId !== row.versionId ||
    context.status !== row.status ||
    !/^[a-f0-9]{64}$/.test(context.snapshotHash) ||
    !Array.isArray(context.allowedActions) ||
    context.allowedActions.some(
      (action) =>
        !['SAVE', 'APPROVE', 'REJECT'].includes(action) || salesPlanActionTargetStatus(action, row.status) === undefined
    )
  )
    return undefined;
  const node = row.status === 10 ? 5 : salesPlanApprovalNodeForStatus(row.status);
  if (context.allowedActions.length && context.nodeOrder !== node) return undefined;
  return context;
};

/** A saved node remains the baseline for the next edit and subsequent approval. */
export const salesPlanEditableQuantity = (sku: GeaSalesPlanSku, status: number): string | undefined => {
  const node = status === 10 ? 5 : salesPlanApprovalNodeForStatus(status);
  const candidates =
    node === 5
      ? [sku.categoryConfirmedQty, sku.areaConfirmedQty]
      : node === 4
        ? [sku.areaConfirmedQty, sku.provinceConfirmedQty]
        : node === 3
          ? [sku.provinceConfirmedQty, sku.regionConfirmedQty]
          : node === 2
            ? [sku.regionConfirmedQty, sku.qty]
            : [sku.qty];
  const value = candidates.find((candidate) => candidate !== null && candidate !== undefined);
  return value === undefined ? undefined : String(value);
};

/** A successful write receipt is followed by a same-version read, including its audit log. */
export const verifySavedSalesPlan = (
  before: GeaSalesPlanDetail,
  after: GeaSalesPlanDetail,
  request: GeaSalesPlanActionRequest,
  receipt: GeaSalesPlanActionReceipt
): boolean => {
  const version = before.currentVersion;
  if (
    request.action !== 'SAVE' ||
    receipt.planId !== version.planId ||
    receipt.versionId !== version.id ||
    receipt.fromStatus !== version.status ||
    receipt.toStatus !== version.status ||
    after.currentVersion.id !== version.id ||
    after.currentVersion.planId !== version.planId ||
    after.currentVersion.status !== version.status ||
    !after.currentVersion.effective ||
    !salesPlanSkusMatchVersion(version.id, after.skus) ||
    before.skus.length !== after.skus.length ||
    !after.logs.some(
      (log) =>
        `sales-plan-log:${log.id}` === receipt.auditId &&
        log.planId === version.planId &&
        log.requestId === receipt.requestId &&
        log.traceId === receipt.traceId &&
        log.actionCode === 'SAVE' &&
        log.versionId === version.id &&
        log.fromStatus === version.status &&
        log.toStatus === version.status
    )
  )
    return false;
  const deltas = new Map((request.adjustments ?? []).map((item) => [String(item.skuCode), String(item.adjustQty)]));
  return before.skus.every((sku) => {
    const code = String(sku.skuCode);
    const saved = after.skus.find((item) => String(item.skuCode) === code);
    const baseline = salesPlanEditableQuantity(sku, version.status);
    const actual = saved && salesPlanEditableQuantity(saved, version.status);
    if (baseline === undefined || actual === undefined) return false;
    const expected = addExactDecimals([baseline, deltas.get(code) ?? '0']);
    const node = version.status === 10 ? 5 : salesPlanApprovalNodeForStatus(version.status);
    const amount =
      node === 5
        ? saved?.categoryConfirmedAmount
        : node === 4
          ? saved?.areaConfirmedAmount
          : node === 3
            ? saved?.provinceConfirmedAmount
            : saved?.regionConfirmedAmount;
    const expectedAmount = multiplyExactDecimals(expected, String(sku.price));
    const equal = (left: unknown, right: string) => /^0(?:\.0+)?$/.test(addExactDecimals([String(left), `-${right}`]));
    return (
      expected !== '—' &&
      expectedAmount !== undefined &&
      equal(actual, expected) &&
      equal(saved?.price, String(sku.price)) &&
      equal(amount, expectedAmount)
    );
  });
};
