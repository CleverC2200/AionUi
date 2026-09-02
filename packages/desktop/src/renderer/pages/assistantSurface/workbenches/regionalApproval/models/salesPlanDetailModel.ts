import type {
  GeaSalesPlanApprovalLog,
  GeaSalesPlanDetail,
  GeaSalesPlanSku,
  GeaSalesPlanSkuDiff,
  GeaSalesPlanVersion,
} from '@/common/adapter/ipcBridge';

export const salesPlanOverviewMatches = (
  planId: string,
  initialVersionId: string,
  detail: GeaSalesPlanDetail,
  versions: readonly GeaSalesPlanVersion[],
  logs: readonly GeaSalesPlanApprovalLog[]
): boolean =>
  detail.currentVersion.planId === planId &&
  detail.currentVersion.id === initialVersionId &&
  versions.length > 0 &&
  versions.every((version) => version.planId === planId) &&
  versions.some((version) => version.id === initialVersionId) &&
  logs.every((log) => log.planId === planId && versions.some((version) => version.id === log.versionId));

export const salesPlanSkusMatchVersion = (versionId: string, skus: readonly GeaSalesPlanSku[]): boolean =>
  skus.every((sku) => sku.versionId === versionId);

export const salesPlanComparisonMatches = (
  fromVersionId: string,
  toVersionId: string,
  differences: readonly GeaSalesPlanSkuDiff[]
): boolean =>
  differences.every((difference) => {
    const beforeMatches =
      !difference.before ||
      (difference.before.versionId === fromVersionId && difference.before.skuCode === difference.skuCode);
    const afterMatches =
      !difference.after ||
      (difference.after.versionId === toVersionId && difference.after.skuCode === difference.skuCode);
    const shapeMatches =
      (difference.changeType === 'ADDED' && !difference.before && !!difference.after) ||
      (difference.changeType === 'DELETED' && !!difference.before && !difference.after) ||
      (difference.changeType === 'UPDATED' && !!difference.before && !!difference.after);
    return beforeMatches && afterMatches && shapeMatches;
  });
