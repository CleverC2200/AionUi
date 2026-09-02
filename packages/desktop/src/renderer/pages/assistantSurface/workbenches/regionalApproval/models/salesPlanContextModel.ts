import type {
  GeaSalesPlanActionReceipt,
  GeaSalesPlanListItem,
  GeaSalesPlanSubmitReceipt,
} from '@/common/adapter/ipcBridge';
import type { ApprovalStageId } from '../regionalApprovalFixture';

export type SalesPlanContextSource =
  | 'fixture'
  | 'gea-user-session-query'
  | 'gea-user-session-action'
  | 'gea-service-submit';

export type SalesPlanContextFilterSummary = {
  periodMonth?: string;
  planTypeCode?: string;
  approvalStage: ApprovalStageId;
  queueMode: 'approval' | 'resubmit';
  organizationFilterCount: number;
};

export type SalesPlanAuthorityContext = {
  source: SalesPlanContextSource;
  filterSummary: SalesPlanContextFilterSummary;
  planId?: string;
  versionId?: string;
  seq?: number;
  status?: number;
  replayed?: boolean;
  requestId?: string;
  traceId?: string;
  auditId?: string;
};

type SalesPlanAuthorityRow = Pick<GeaSalesPlanListItem, 'planId' | 'versionId' | 'seq' | 'status'>;

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const PLAN_TYPE_PATTERN = /^[A-Za-z0-9._:-]{1,32}$/;
const PERIOD_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const safeOpaqueId = (value: unknown): value is string => typeof value === 'string' && OPAQUE_ID_PATTERN.test(value);

const safePlanState = (row: SalesPlanAuthorityRow): boolean =>
  safeOpaqueId(row.planId) &&
  safeOpaqueId(row.versionId) &&
  Number.isSafeInteger(row.seq) &&
  row.seq > 0 &&
  Number.isSafeInteger(row.status) &&
  row.status >= 1 &&
  row.status <= 9;

export const buildSalesPlanFilterSummary = ({
  periodMonth,
  planTypeCode,
  approvalStage,
  queueMode,
  appliedFilters,
}: {
  periodMonth?: string;
  planTypeCode?: string;
  approvalStage: ApprovalStageId;
  queueMode: 'approval' | 'resubmit';
  appliedFilters: Readonly<Record<string, unknown>>;
}): SalesPlanContextFilterSummary => ({
  ...(periodMonth && PERIOD_MONTH_PATTERN.test(periodMonth) ? { periodMonth } : {}),
  ...(planTypeCode && PLAN_TYPE_PATTERN.test(planTypeCode) ? { planTypeCode } : {}),
  approvalStage,
  queueMode,
  organizationFilterCount: Object.values(appliedFilters).filter(
    (value) => typeof value === 'string' && value.length > 0 && value !== 'all'
  ).length,
});

export const projectFixtureSalesPlanContext = (
  filterSummary: SalesPlanContextFilterSummary
): SalesPlanAuthorityContext => ({
  source: 'fixture',
  filterSummary,
});

export const projectSalesPlanQueryContext = (
  row: SalesPlanAuthorityRow | undefined,
  filterSummary: SalesPlanContextFilterSummary
): SalesPlanAuthorityContext | undefined => {
  if (!row) {
    return {
      source: 'gea-user-session-query',
      filterSummary,
    };
  }
  if (!safePlanState(row)) return undefined;
  return {
    source: 'gea-user-session-query',
    filterSummary,
    planId: row.planId,
    versionId: row.versionId,
    seq: row.seq,
    status: row.status,
  };
};

export const projectSalesPlanActionContext = (
  row: SalesPlanAuthorityRow,
  receipt: GeaSalesPlanActionReceipt,
  filterSummary: SalesPlanContextFilterSummary
): SalesPlanAuthorityContext | undefined => {
  if (
    !safePlanState(row) ||
    receipt.planId !== row.planId ||
    receipt.versionId !== row.versionId ||
    receipt.fromStatus !== row.status ||
    !Number.isSafeInteger(receipt.toStatus) ||
    receipt.toStatus < 1 ||
    receipt.toStatus > 9 ||
    typeof receipt.replayed !== 'boolean' ||
    !safeOpaqueId(receipt.requestId) ||
    !safeOpaqueId(receipt.traceId) ||
    !safeOpaqueId(receipt.auditId)
  ) {
    return undefined;
  }
  return {
    source: 'gea-user-session-action',
    filterSummary,
    planId: receipt.planId,
    versionId: receipt.versionId,
    seq: row.seq,
    status: receipt.toStatus,
    replayed: receipt.replayed,
    requestId: receipt.requestId,
    traceId: receipt.traceId,
    auditId: receipt.auditId,
  };
};

export const projectSalesPlanSubmitContext = (
  row: SalesPlanAuthorityRow,
  receipt: GeaSalesPlanSubmitReceipt,
  filterSummary: SalesPlanContextFilterSummary
): SalesPlanAuthorityContext | undefined => {
  if (
    !safePlanState(row) ||
    row.status < 6 ||
    row.status > 9 ||
    receipt.planId !== row.planId ||
    receipt.versionId === row.versionId ||
    !safeOpaqueId(receipt.versionId) ||
    receipt.seq !== row.seq + 1 ||
    receipt.status !== row.status - 5 ||
    typeof receipt.replayed !== 'boolean' ||
    !safeOpaqueId(receipt.requestId) ||
    !safeOpaqueId(receipt.traceId) ||
    !safeOpaqueId(receipt.auditId)
  ) {
    return undefined;
  }
  return {
    source: 'gea-service-submit',
    filterSummary,
    planId: receipt.planId,
    versionId: receipt.versionId,
    seq: receipt.seq,
    status: receipt.status,
    replayed: receipt.replayed,
    requestId: receipt.requestId,
    traceId: receipt.traceId,
    auditId: receipt.auditId,
  };
};
