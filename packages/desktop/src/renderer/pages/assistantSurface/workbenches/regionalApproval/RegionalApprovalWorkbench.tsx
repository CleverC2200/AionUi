import {
  Alert,
  Button,
  Empty,
  Modal,
  Pagination,
  Progress,
  Select,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import { CheckOne, Download, Refresh } from '@icon-park/react';
import type { TFunction } from 'i18next';
import React, { useEffect, useMemo, useState } from 'react';
import { useBusinessSurfaceSession } from '../../components/BusinessSurfaceShell';
import {
  getAssistantSurfaceWorkbenchScope,
  readAssistantSurfaceState,
  writeAssistantSurfaceState,
} from '../../storage';
import {
  APPROVAL_STAGE_FIXTURES,
  APPROVAL_DIMENSIONS_BY_STAGE,
  REGIONAL_APPROVAL_ROWS,
  approvalRowsForStage,
  isApprovalStageId,
  type ApprovalHealth,
  type ApprovalDimension,
  type ApprovalStageId,
  type ApprovalState,
  type ApprovalVersion,
  type RegionalApprovalRow,
} from './regionalApprovalFixture';
import {
  ALL_ORGANIZATIONS,
  DEFAULT_APPROVAL_FILTERS,
  approvalFilterOptions,
  buildApprovalCsv,
  metricsForApprovalVersion,
  normalizeApprovalFilters,
  paginateApprovalRows,
  projectApprovalRows,
  updateApprovalFilter,
  type ApprovalCsvLabels,
  type ApprovalOrganizationFilterField,
  type ApprovalOrganizationFilters,
} from './regionalApprovalModel';
import RegionalApprovalPlanDetail from './RegionalApprovalPlanDetail';
import RegionalApprovalLivePlanDetail from './RegionalApprovalLivePlanDetail';
import RegionalApprovalActionDialog from './RegionalApprovalActionDialog';
import RegionalApprovalLiveActionDialog, { type LiveActionKind } from './RegionalApprovalLiveActionDialog';
import RegionalApprovalLiveSubmitDialog from './RegionalApprovalLiveSubmitDialog';
import {
  EMPTY_REGIONAL_APPROVAL_ACTION_STORE,
  regionalApprovalFixtureResults,
  type RegionalApprovalActionExecutor,
  type RegionalApprovalActionStore,
} from './regionalApprovalActionModel';
import {
  EMPTY_APPROVAL_DETAIL_STORE,
  savedApprovalAdjustments,
  type ApprovalDetailStore,
} from './regionalApprovalDetailModel';
import {
  addExactDecimals,
  approvalStageForSalesPlanStatus,
  clampSalesPlanPageNumber,
  formatExactDecimal,
  isOpenSalesPlanPeriod,
  toRegionalApprovalLiveRow,
  type RegionalApprovalLiveRow,
} from './regionalApprovalQueryModel';
import {
  useRegionalApprovalQuery,
  type RegionalApprovalQueryError,
  type SalesPlanQueryClient,
} from './useRegionalApprovalQuery';
import type { SalesPlanDetailClient } from './hooks/useSalesPlanDetail';
import { salesPlanApprovalNodeForStatus, type SalesPlanActionClient } from './models/salesPlanActionModel';
import { salesPlanChannelCodeForPlanId, type SalesPlanSubmitClient } from './models/salesPlanSubmitModel';
import type { GeaSalesPlanActionReceipt, GeaSalesPlanSubmitReceipt } from '@/common/adapter/ipcBridge';
import {
  buildSalesPlanFilterSummary,
  projectFixtureSalesPlanContext,
  projectSalesPlanActionContext,
  projectSalesPlanQueryContext,
  projectSalesPlanSubmitContext,
  type SalesPlanAuthorityContext,
} from './models/salesPlanContextModel';
import styles from './RegionalApprovalWorkbench.module.css';

type ApprovalContextFilters = { [Field in keyof ApprovalOrganizationFilters]: string };

export type RegionalApprovalWorkbenchContext = {
  view: 'regional-approval';
  fixtureState: 'ready' | 'mixed';
  scope: {
    planType: string;
    month: string;
    approvalStage: ApprovalStageId;
    authority: 'organization';
    primaryVersion: ApprovalVersion;
    compareVersion: ApprovalVersion;
    appliedFilters: ApprovalContextFilters;
  };
  visibleEntities: Array<{
    id: string;
    organizationKey: string;
    approvalState: ApprovalState | 'returned';
    health: ApprovalHealth | 'unknown';
  }>;
  selectedEntities: Array<{ id: string; organizationKey: string }>;
  changes: ReturnType<typeof savedApprovalAdjustments>;
  localApprovalResults: ReturnType<typeof regionalApprovalFixtureResults>;
  metrics: {
    visibleCount: number;
    pendingCount: number;
    warningCount: number;
    quantity: string;
    amount: string;
    savedAdjustmentCount: number;
    localApprovalResultCount: number;
  };
  pagination: { page: number; pageSize: number; total: number };
  evidence: {
    source: 'fixture' | 'gea-user-session' | 'unverified';
    permission: 'read-only' | 'user-session-action';
    completeness: 'skeleton' | 'periods-only' | 'paged-queue' | 'none';
    queryState: 'fixture' | 'loading' | 'error' | 'empty-periods' | 'empty' | 'success' | 'refreshing' | 'stale-error';
    error?: RegionalApprovalQueryError;
    dataVersion: string;
  };
  authority?: SalesPlanAuthorityContext;
};

const stageLabelKey = (stage: ApprovalStageId) => `common.assistantSurface.regionalApproval.stages.${stage}` as const;

const organizationLabelKey = (organization: RegionalApprovalRow['organizationKey']) =>
  `common.assistantSurface.regionalApproval.organizations.${organization}` as const;

const areaLabelKey = (area: RegionalApprovalRow['areaKey']) =>
  `common.assistantSurface.regionalApproval.areas.${area}` as const;

const branchLabelKey = (branch: RegionalApprovalRow['branchKey']) =>
  `common.assistantSurface.regionalApproval.branches.${branch}` as const;

const departmentLabelKey = (department: RegionalApprovalRow['departmentKey']) =>
  `common.assistantSurface.regionalApproval.departments.${department}` as const;

const customerLabelKey = (customer: RegionalApprovalRow['customerKey']) =>
  `common.assistantSurface.regionalApproval.customers.${customer}` as const;

const number = (value: number) => value.toLocaleString();
const money = (value: number) => `¥${value.toLocaleString()}`;
const exactMoney = (value: string) => `¥${formatExactDecimal(value)}`;
const csvCells = (values: Array<string | number>) =>
  values.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',');

type ExportFeedback = { type: 'success' | 'warning' | 'error'; message: string };
type LiveQueueMode = 'approval' | 'resubmit';
type LiveApprovalFilters = {
  areaCode: string;
  provinceCode: string;
  orgCode: string;
  dealerCode: string;
  status: string;
};

const EMPTY_LIVE_APPROVAL_FILTERS: LiveApprovalFilters = {
  areaCode: ALL_ORGANIZATIONS,
  provinceCode: ALL_ORGANIZATIONS,
  orgCode: ALL_ORGANIZATIONS,
  dealerCode: ALL_ORGANIZATIONS,
  status: ALL_ORGANIZATIONS,
};

const uniqueLiveFilterValues = (values: Array<string | null | undefined>) =>
  [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].toSorted();

type PersistedApprovalWorkbenchState = {
  currentStage: ApprovalStageId;
  draftFilters: ApprovalOrganizationFilters;
  appliedFilters: ApprovalOrganizationFilters;
  primaryVersion: ApprovalVersion;
  compareVersion: ApprovalVersion;
  page: number;
  pageSize: number;
  dimension: ApprovalDimension;
  categoryComparison: boolean;
  selectedRowIds: string[];
};

const APPROVAL_VERSIONS = ['current', 'previous', 'initial'] as const satisfies readonly ApprovalVersion[];
const approvalVersionOffset = (version: ApprovalVersion) => APPROVAL_VERSIONS.indexOf(version);

const isApprovalVersion = (value: unknown): value is ApprovalVersion =>
  APPROVAL_VERSIONS.includes(value as ApprovalVersion);

const queryErrorKey = (error: RegionalApprovalQueryError) =>
  `common.assistantSurface.regionalApproval.query.errors.${error}` as const;

const isLiveApprovalRow = (row: RegionalApprovalRow | RegionalApprovalLiveRow): row is RegionalApprovalLiveRow =>
  'source' in row && row.source === 'gea';

const fixturePriority = (row: RegionalApprovalRow) => {
  if (row.approvalState === 'pending' && row.health === 'warning') return 0;
  if (row.approvalState === 'pending') return 1;
  if (row.health === 'warning' || row.health === 'attention') return 2;
  if (row.approvalState === 'approved') return 3;
  return 4;
};

const livePriority = (row: RegionalApprovalLiveRow) => {
  if (row.approvalState === 'returned') return 0;
  if (row.approvalState === 'pending') return 1;
  return 2;
};

const RegionalApprovalWorkbench: React.FC<{
  stateScope: string;
  t: TFunction;
  onContextChange: (context: RegionalApprovalWorkbenchContext, conversationId: string | null) => void;
  actionExecutor?: RegionalApprovalActionExecutor;
  queryClient?: SalesPlanQueryClient | null;
  detailClient?: SalesPlanDetailClient;
  liveActionClient?: SalesPlanActionClient;
  liveSubmitClient?: SalesPlanSubmitClient;
  liveActionsEnabled?: boolean;
}> = ({
  stateScope,
  t,
  onContextChange,
  actionExecutor,
  queryClient,
  detailClient,
  liveActionClient,
  liveSubmitClient,
  liveActionsEnabled = false,
}) => {
  const { conversationId } = useBusinessSurfaceSession();
  const scopedState = getAssistantSurfaceWorkbenchScope(stateScope);
  const [initialState] = useState<PersistedApprovalWorkbenchState>(() => {
    const saved = readAssistantSurfaceState<Partial<PersistedApprovalWorkbenchState>>(
      'forecast',
      `${scopedState}:regional-approval-state`,
      {}
    );
    const legacyStage = readAssistantSurfaceState<unknown>('forecast', `${scopedState}:approval-stage`, 'area');
    const currentStage = isApprovalStageId(saved.currentStage)
      ? saved.currentStage
      : isApprovalStageId(legacyStage)
        ? legacyStage
        : 'area';
    const stageRows = approvalRowsForStage(REGIONAL_APPROVAL_ROWS, currentStage);
    return {
      currentStage,
      draftFilters: normalizeApprovalFilters(stageRows, {
        ...DEFAULT_APPROVAL_FILTERS,
        ...saved.draftFilters,
      }),
      appliedFilters: normalizeApprovalFilters(stageRows, {
        ...DEFAULT_APPROVAL_FILTERS,
        ...saved.appliedFilters,
      }),
      primaryVersion: isApprovalVersion(saved.primaryVersion) ? saved.primaryVersion : 'current',
      compareVersion: isApprovalVersion(saved.compareVersion) ? saved.compareVersion : 'previous',
      page: typeof saved.page === 'number' && saved.page >= 1 ? Math.floor(saved.page) : 1,
      pageSize: [10, 20, 50, 100].includes(saved.pageSize ?? 0) ? saved.pageSize! : 20,
      dimension: APPROVAL_DIMENSIONS_BY_STAGE[currentStage].includes(saved.dimension as ApprovalDimension)
        ? (saved.dimension as ApprovalDimension)
        : APPROVAL_DIMENSIONS_BY_STAGE[currentStage][0],
      categoryComparison: saved.categoryComparison === true,
      selectedRowIds: Array.isArray(saved.selectedRowIds)
        ? saved.selectedRowIds.filter((value): value is string => typeof value === 'string')
        : [],
    };
  });
  const [currentStage, setCurrentStage] = useState(initialState.currentStage);
  const [draftFilters, setDraftFilters] = useState(initialState.draftFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialState.appliedFilters);
  const [primaryVersion, setPrimaryVersion] = useState(initialState.primaryVersion);
  const [compareVersion, setCompareVersion] = useState(initialState.compareVersion);
  const [pageSize, setPageSize] = useState(initialState.pageSize);
  const [page, setPage] = useState(initialState.page);
  const [dimension, setDimension] = useState(initialState.dimension);
  const [categoryComparison, setCategoryComparison] = useState(initialState.categoryComparison);
  const [draftLiveFilters, setDraftLiveFilters] = useState<LiveApprovalFilters>(EMPTY_LIVE_APPROVAL_FILTERS);
  const [appliedLiveFilters, setAppliedLiveFilters] = useState<LiveApprovalFilters>(EMPTY_LIVE_APPROVAL_FILTERS);
  const [selectedRowIds, setSelectedRowIds] = useState(initialState.selectedRowIds);
  const [progressOpen, setProgressOpen] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<ExportFeedback>();
  const [detailRowId, setDetailRowId] = useState<string>();
  const [liveDetailPlanId, setLiveDetailPlanId] = useState<string>();
  const [liveActionPlanId, setLiveActionPlanId] = useState<string>();
  const [liveActionKind, setLiveActionKind] = useState<LiveActionKind>('APPROVE');
  const [liveSubmitPlanId, setLiveSubmitPlanId] = useState<string>();
  const [liveQueueMode, setLiveQueueMode] = useState<LiveQueueMode>('approval');
  const [liveActionReceipts, setLiveActionReceipts] = useState<Record<string, GeaSalesPlanActionReceipt>>({});
  const [liveSubmitReceipts, setLiveSubmitReceipts] = useState<Record<string, GeaSalesPlanSubmitReceipt>>({});
  const [lastLiveSubmitReceipt, setLastLiveSubmitReceipt] = useState<GeaSalesPlanSubmitReceipt>();
  const [liveAuthorityContext, setLiveAuthorityContext] = useState<SalesPlanAuthorityContext>();
  const [permissionDeniedVersions, setPermissionDeniedVersions] = useState<Set<string>>(() => new Set());
  const liveSubmissionsEnabled = liveActionsEnabled;
  const [actionRowId, setActionRowId] = useState<string>();
  const [detailStore, setDetailStore] = useState<ApprovalDetailStore>(() =>
    readAssistantSurfaceState<ApprovalDetailStore>(
      'forecast',
      `${scopedState}:regional-approval-detail-state`,
      EMPTY_APPROVAL_DETAIL_STORE
    )
  );
  const [actionStore, setActionStore] = useState<RegionalApprovalActionStore>(() =>
    readAssistantSurfaceState<RegionalApprovalActionStore>(
      'forecast',
      `${scopedState}:regional-approval-action-state`,
      EMPTY_REGIONAL_APPROVAL_ACTION_STORE
    )
  );
  const liveQueryScope = useMemo(
    () => ({
      areaCode: appliedLiveFilters.areaCode === ALL_ORGANIZATIONS ? undefined : appliedLiveFilters.areaCode,
      provinceCode: appliedLiveFilters.provinceCode === ALL_ORGANIZATIONS ? undefined : appliedLiveFilters.provinceCode,
      orgCode: appliedLiveFilters.orgCode === ALL_ORGANIZATIONS ? undefined : appliedLiveFilters.orgCode,
      dealerCode: appliedLiveFilters.dealerCode === ALL_ORGANIZATIONS ? undefined : appliedLiveFilters.dealerCode,
      status: appliedLiveFilters.status === ALL_ORGANIZATIONS ? undefined : Number(appliedLiveFilters.status),
    }),
    [appliedLiveFilters]
  );
  const liveQuery = useRegionalApprovalQuery({
    client: queryClient,
    page,
    pageSize,
    scope: liveQueryScope,
  });
  const stageRows = useMemo(() => approvalRowsForStage(REGIONAL_APPROVAL_ROWS, currentStage), [currentStage]);
  const filterOptions = useMemo(() => approvalFilterOptions(stageRows, draftFilters), [draftFilters, stageRows]);
  const visibleRows = useMemo(() => projectApprovalRows(stageRows, appliedFilters), [appliedFilters, stageRows]);
  const prioritizedVisibleRows = useMemo(
    () => visibleRows.toSorted((left, right) => fixturePriority(left) - fixturePriority(right)),
    [visibleRows]
  );
  const pageData = useMemo(
    () => paginateApprovalRows(prioritizedVisibleRows, page, pageSize),
    [page, pageSize, prioritizedVisibleRows]
  );
  const filtersDirty = JSON.stringify(draftFilters) !== JSON.stringify(appliedFilters);
  const liveFiltersDirty = JSON.stringify(draftLiveFilters) !== JSON.stringify(appliedLiveFilters);
  const savedAdjustments = useMemo(() => savedApprovalAdjustments(detailStore), [detailStore]);
  const localApprovalResults = useMemo(() => regionalApprovalFixtureResults(actionStore), [actionStore]);
  const liveRows = useMemo(
    () => (liveQuery.queueState.data?.records ?? []).map(toRegionalApprovalLiveRow),
    [liveQuery.queueState.data?.records]
  );
  const liveFilterOptions = useMemo(() => {
    const provinceRows =
      draftLiveFilters.areaCode !== ALL_ORGANIZATIONS
        ? liveRows.filter((row) => row.areaCode?.trim() === draftLiveFilters.areaCode)
        : liveRows;
    const organizationRows =
      draftLiveFilters.provinceCode !== ALL_ORGANIZATIONS
        ? provinceRows.filter((row) => row.provinceCode?.trim() === draftLiveFilters.provinceCode)
        : provinceRows;
    const customerRows =
      draftLiveFilters.orgCode !== ALL_ORGANIZATIONS
        ? organizationRows.filter((row) => row.orgCode?.trim() === draftLiveFilters.orgCode)
        : organizationRows;
    return {
      areaCodes: uniqueLiveFilterValues(liveRows.map((row) => row.areaCode)),
      provinceCodes: uniqueLiveFilterValues(provinceRows.map((row) => row.provinceCode)),
      orgCodes: uniqueLiveFilterValues(organizationRows.map((row) => row.orgCode)),
      customers: customerRows
        .map((row) => ({ dealerCode: row.dealerCode.trim(), baseName: row.baseName?.trim() }))
        .filter(
          (option, index, options) => options.findIndex((item) => item.dealerCode === option.dealerCode) === index
        ),
    };
  }, [draftLiveFilters.areaCode, draftLiveFilters.orgCode, draftLiveFilters.provinceCode, liveRows]);
  const prioritizedLiveRows = useMemo(
    () => liveRows.toSorted((left, right) => livePriority(left) - livePriority(right)),
    [liveRows]
  );
  const selectableFixtureRow = (row: RegionalApprovalRow) =>
    row.approvalState === 'pending' && row.permission === 'writable' && row.reachedStage === currentStage;
  const selectedFixtureRows = useMemo(
    () => visibleRows.filter((row) => selectedRowIds.includes(row.id)),
    [selectedRowIds, visibleRows]
  );
  const selectedLiveRows = useMemo(
    () => liveRows.filter((row) => selectedRowIds.includes(row.planId)),
    [liveRows, selectedRowIds]
  );
  const liveStageRow =
    selectedLiveRows[0] ??
    prioritizedLiveRows.find((row) => row.status >= 1 && row.status <= 5) ??
    prioritizedLiveRows[0];
  const liveDisplayStage = approvalStageForSalesPlanStatus(liveStageRow?.status ?? 0);
  const displayStage = liveQuery.enabled ? liveDisplayStage : currentStage;
  const effectiveStage = displayStage ?? currentStage;
  const contextAppliedFilters = useMemo<ApprovalContextFilters>(
    () =>
      liveQuery.enabled
        ? {
            area: appliedLiveFilters.areaCode,
            branch: appliedLiveFilters.provinceCode,
            department: appliedLiveFilters.orgCode,
            customer: appliedLiveFilters.dealerCode,
            approval: appliedLiveFilters.status,
            health: ALL_ORGANIZATIONS,
          }
        : appliedFilters,
    [appliedFilters, appliedLiveFilters, liveQuery.enabled]
  );
  const activeDetailRow = visibleRows.find((row) => row.id === detailRowId);
  const activeLiveDetailRow = liveRows.find((row) => row.planId === liveDetailPlanId);
  const activeLiveActionRow = liveRows.find((row) => row.planId === liveActionPlanId);
  const activeLiveSubmitRow = liveRows.find((row) => row.planId === liveSubmitPlanId);
  const activeActionRow = visibleRows.find((row) => row.id === actionRowId);
  const contextFilterSummary = useMemo(
    () =>
      buildSalesPlanFilterSummary({
        periodMonth: liveQuery.selectedPeriod?.periodMonth ?? (liveQuery.enabled ? undefined : '2026-09'),
        planTypeCode: liveQuery.selectedPeriod?.planTypeCode ?? (liveQuery.enabled ? undefined : 'monthly'),
        approvalStage: effectiveStage,
        queueMode: liveQueueMode,
        appliedFilters: contextAppliedFilters,
      }),
    [contextAppliedFilters, effectiveStage, liveQuery.enabled, liveQuery.selectedPeriod, liveQueueMode]
  );

  const liveActionDisabledReason = (row: RegionalApprovalLiveRow) => {
    if (!liveActionsEnabled) return 'readOnly';
    if (liveActionReceipts[row.versionId]) return 'completed';
    if (permissionDeniedVersions.has(row.versionId)) return 'permission';
    if (liveQuery.queueState.status !== 'success') return 'queueNotFresh';
    if (!isOpenSalesPlanPeriod(liveQuery.selectedPeriod)) return 'closedPeriod';
    if (salesPlanApprovalNodeForStatus(row.status) === undefined) return 'notCurrentStage';
    return undefined;
  };
  const liveSubmitDisabledReason = (row: RegionalApprovalLiveRow) => {
    if (!liveSubmissionsEnabled) return 'readOnly';
    if (liveSubmitReceipts[row.versionId]) return 'completed';
    if (liveQuery.queueState.status !== 'success') return 'queueNotFresh';
    if (!isOpenSalesPlanPeriod(liveQuery.selectedPeriod)) return 'closedPeriod';
    if (row.status < 6 || row.status > 9) return 'notReturned';
    const derivedChannelCode = liveQuery.selectedPeriod
      ? salesPlanChannelCodeForPlanId(row.planId, liveQuery.selectedPeriod.periodMonth)
      : undefined;
    if (!derivedChannelCode || (row.channelCode?.trim() && row.channelCode.trim() !== derivedChannelCode)) {
      return 'channelMissing';
    }
    return undefined;
  };
  const metrics = useMemo(() => {
    if (liveQuery.enabled) {
      return {
        visibleCount: liveRows.length,
        pendingCount: liveRows.filter((row) => row.approvalState === 'pending').length,
        warningCount: liveRows.filter((row) => row.approvalState === 'returned').length,
        quantity: addExactDecimals(liveRows.map((row) => row.currentQty)),
        amount: addExactDecimals(liveRows.map((row) => row.currentAmount)),
        savedAdjustmentCount: savedAdjustments.length,
        localApprovalResultCount: localApprovalResults.length,
      };
    }
    return {
      visibleCount: visibleRows.length,
      pendingCount: visibleRows.filter((row) => row.approvalState === 'pending').length,
      warningCount: visibleRows.filter((row) => row.health === 'warning').length,
      quantity: addExactDecimals(
        visibleRows.map((row) => String(metricsForApprovalVersion(row, primaryVersion).quantity))
      ),
      amount: addExactDecimals(visibleRows.map((row) => String(metricsForApprovalVersion(row, primaryVersion).amount))),
      savedAdjustmentCount: savedAdjustments.length,
      localApprovalResultCount: localApprovalResults.length,
    };
  }, [liveQuery.enabled, liveRows, localApprovalResults.length, primaryVersion, savedAdjustments.length, visibleRows]);

  useEffect(() => {
    writeAssistantSurfaceState('forecast', `${scopedState}:approval-stage`, currentStage);
    writeAssistantSurfaceState<PersistedApprovalWorkbenchState>('forecast', `${scopedState}:regional-approval-state`, {
      currentStage,
      draftFilters,
      appliedFilters,
      primaryVersion,
      compareVersion,
      page,
      pageSize,
      dimension,
      categoryComparison,
      selectedRowIds,
    });
  }, [
    appliedFilters,
    categoryComparison,
    compareVersion,
    currentStage,
    dimension,
    draftFilters,
    page,
    pageSize,
    primaryVersion,
    scopedState,
    selectedRowIds,
  ]);

  useEffect(() => {
    writeAssistantSurfaceState('forecast', `${scopedState}:regional-approval-detail-state`, detailStore);
  }, [detailStore, scopedState]);

  useEffect(() => {
    setLiveDetailPlanId(undefined);
    setLiveActionPlanId(undefined);
    setLiveSubmitPlanId(undefined);
    setLiveAuthorityContext(undefined);
    setPermissionDeniedVersions(new Set());
  }, [
    appliedFilters,
    appliedLiveFilters,
    currentStage,
    liveQuery.selectedPeriod?.periodId,
    liveQueueMode,
    page,
    pageSize,
  ]);

  useEffect(() => {
    if (currentStage === 'category' && liveQueueMode === 'resubmit') {
      setLiveQueueMode('approval');
      setPage(1);
    }
  }, [currentStage, liveQueueMode]);

  useEffect(() => {
    writeAssistantSurfaceState('forecast', `${scopedState}:regional-approval-action-state`, actionStore);
  }, [actionStore, scopedState]);

  useEffect(() => {
    if (!liveQuery.enabled) {
      if (page !== pageData.page) setPage(pageData.page);
      return;
    }
    if (liveQuery.queueState.status !== 'success') return;
    if (liveQuery.queueSettledPage !== clampSalesPlanPageNumber(page)) return;
    const pages = clampSalesPlanPageNumber(liveQuery.queueState.data.pages);
    const serverPage = Math.min(clampSalesPlanPageNumber(liveQuery.queueState.data.current), pages);
    if (page !== serverPage) setPage(serverPage);
  }, [liveQuery.enabled, liveQuery.queueSettledPage, liveQuery.queueState, page, pageData.page]);

  const liveEvidence = useMemo<RegionalApprovalWorkbenchContext['evidence']>(() => {
    if (!liveQuery.enabled) {
      return {
        source: 'fixture',
        permission: 'read-only',
        completeness: 'skeleton',
        queryState: 'fixture',
        dataVersion: 'regional-approval-fixture-v3',
      };
    }

    const queueData = liveQuery.queueState.data;
    const queryError =
      liveQuery.queueState.status === 'error'
        ? liveQuery.queueState.error
        : liveQuery.periodsState.status === 'error'
          ? liveQuery.periodsState.error
          : undefined;
    if (queueData) {
      return {
        source: 'gea-user-session',
        permission: liveActionsEnabled ? 'user-session-action' : 'read-only',
        completeness: 'paged-queue',
        queryState: queryError
          ? 'stale-error'
          : liveQuery.queueState.status === 'loading' || liveQuery.periodsState.status === 'loading'
            ? 'refreshing'
            : queueData.records.length === 0
              ? 'empty'
              : 'success',
        error: queryError,
        dataVersion: 'sales-plan-v1.11',
      };
    }

    if (liveQuery.periodsState.status === 'success') {
      return {
        source: 'gea-user-session',
        permission: liveActionsEnabled ? 'user-session-action' : 'read-only',
        completeness: 'periods-only',
        queryState:
          liveQuery.periods.length === 0
            ? 'empty-periods'
            : liveQuery.queueState.status === 'error'
              ? 'error'
              : 'loading',
        error: queryError,
        dataVersion: 'sales-plan-v1.11',
      };
    }

    return {
      source: 'unverified',
      permission: 'read-only',
      completeness: 'none',
      queryState: queryError ? 'error' : 'loading',
      error: queryError,
      dataVersion: 'unverified',
    };
  }, [liveActionsEnabled, liveQuery.enabled, liveQuery.periods.length, liveQuery.periodsState, liveQuery.queueState]);

  useEffect(() => {
    const usingLiveQueue = liveQuery.enabled;
    const authority = usingLiveQueue
      ? (liveAuthorityContext ??
        (liveQuery.queueState.status === 'success'
          ? projectSalesPlanQueryContext(undefined, contextFilterSummary)
          : undefined))
      : projectFixtureSalesPlanContext(contextFilterSummary);
    onContextChange(
      {
        view: 'regional-approval',
        fixtureState: usingLiveQueue ? 'mixed' : 'ready',
        scope: {
          planType: liveQuery.selectedPeriod?.planTypeCode ?? (usingLiveQueue ? 'unknown' : 'monthly'),
          month: liveQuery.selectedPeriod?.periodMonth ?? (usingLiveQueue ? '' : '2026-09'),
          approvalStage: currentStage,
          authority: 'organization',
          primaryVersion,
          compareVersion,
          appliedFilters: contextAppliedFilters,
        },
        visibleEntities: usingLiveQueue
          ? liveRows.map((row) => ({
              id: row.planId,
              organizationKey: row.baseName ?? row.orgCode ?? row.dealerCode,
              approvalState: row.approvalState,
              health: 'unknown' as const,
            }))
          : visibleRows.map((row) => ({
              id: row.id,
              organizationKey: row.organizationKey,
              approvalState: row.approvalState,
              health: row.health,
            })),
        selectedEntities: usingLiveQueue
          ? selectedLiveRows.map((row) => ({
              id: row.planId,
              organizationKey: row.baseName ?? row.orgCode ?? row.dealerCode,
            }))
          : selectedFixtureRows.map((row) => ({ id: row.id, organizationKey: row.organizationKey })),
        changes: savedAdjustments,
        localApprovalResults,
        metrics,
        pagination: usingLiveQueue
          ? {
              page: liveQuery.queueState.data?.current ?? page,
              pageSize: liveQuery.queueState.data?.size ?? pageSize,
              total: liveQuery.queueState.data?.total ?? 0,
            }
          : { page: pageData.page, pageSize: pageData.pageSize, total: pageData.total },
        evidence: liveEvidence,
        authority,
      },
      conversationId
    );
  }, [
    compareVersion,
    contextAppliedFilters,
    conversationId,
    currentStage,
    metrics,
    localApprovalResults,
    liveQuery.enabled,
    liveQuery.queueState.data,
    liveQuery.selectedPeriod,
    liveEvidence,
    liveAuthorityContext,
    liveRows,
    onContextChange,
    page,
    pageData,
    pageSize,
    primaryVersion,
    savedAdjustments,
    selectedFixtureRows,
    selectedLiveRows,
    contextFilterSummary,
    visibleRows,
  ]);

  const selectLivePlanContext = (row: RegionalApprovalLiveRow) => {
    setLiveAuthorityContext(projectSalesPlanQueryContext(row, contextFilterSummary));
  };

  const changeStage = (stage: ApprovalStageId) => {
    const nextRows = approvalRowsForStage(REGIONAL_APPROVAL_ROWS, stage);
    setCurrentStage(stage);
    setDraftFilters((current) => normalizeApprovalFilters(nextRows, current));
    setAppliedFilters((current) => normalizeApprovalFilters(nextRows, current));
    setDimension(APPROVAL_DIMENSIONS_BY_STAGE[stage][0]);
    setSelectedRowIds([]);
    setPage(1);
    setExportFeedback(undefined);
  };

  const updateDraftFilter = <Field extends ApprovalOrganizationFilterField>(
    field: Field,
    value: ApprovalOrganizationFilters[Field]
  ) => {
    setDraftFilters((current) => updateApprovalFilter(stageRows, current, field, value));
    setExportFeedback(undefined);
  };

  const updateLiveDraftFilter = (field: keyof LiveApprovalFilters, value: string) => {
    setDraftLiveFilters((current) => {
      const next = { ...current, [field]: value };
      if (field === 'areaCode') {
        next.provinceCode = ALL_ORGANIZATIONS;
        next.orgCode = ALL_ORGANIZATIONS;
        next.dealerCode = ALL_ORGANIZATIONS;
      } else if (field === 'provinceCode') {
        next.orgCode = ALL_ORGANIZATIONS;
        next.dealerCode = ALL_ORGANIZATIONS;
      } else if (field === 'orgCode') {
        next.dealerCode = ALL_ORGANIZATIONS;
      }
      return next;
    });
    setExportFeedback(undefined);
  };

  const applyFilters = () => {
    if (liveQuery.enabled) {
      setAppliedLiveFilters(draftLiveFilters);
      setSelectedRowIds([]);
      setPage(1);
      return;
    }
    setAppliedFilters(draftFilters);
    setSelectedRowIds([]);
    setPage(1);
  };

  const resetFilters = () => {
    if (liveQuery.enabled) {
      setDraftLiveFilters(EMPTY_LIVE_APPROVAL_FILTERS);
      setAppliedLiveFilters(EMPTY_LIVE_APPROVAL_FILTERS);
      setSelectedRowIds([]);
      setPage(1);
      setExportFeedback(undefined);
      return;
    }
    setDraftFilters(DEFAULT_APPROVAL_FILTERS);
    setAppliedFilters(DEFAULT_APPROVAL_FILTERS);
    setSelectedRowIds([]);
    setPage(1);
    setExportFeedback(undefined);
  };

  const applyHealthFilter = (health: ApprovalHealth) => {
    const nextFilters = { ...draftFilters, health };
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setSelectedRowIds([]);
    setPage(1);
  };

  const changePrimaryVersion = (version: ApprovalVersion) => {
    setPrimaryVersion(version);
    if (approvalVersionOffset(version) > approvalVersionOffset(compareVersion)) {
      setCompareVersion(version);
    } else if (version === compareVersion && approvalVersionOffset(version) > 0) {
      setCompareVersion(APPROVAL_VERSIONS[approvalVersionOffset(version) - 1]);
    }
    setPage(1);
  };

  const changeCompareVersion = (version: ApprovalVersion) => {
    setCompareVersion(version);
    if (approvalVersionOffset(primaryVersion) > approvalVersionOffset(version)) setPrimaryVersion(version);
    setPage(1);
  };

  const openDetail = (row: RegionalApprovalRow) => {
    if (selectableFixtureRow(row)) setSelectedRowIds([row.id]);
    setDetailRowId(row.id);
  };
  const openAction = (row: RegionalApprovalRow) => setActionRowId(row.id);

  const versionLabel = (version: ApprovalVersion) => t(`common.assistantSurface.regionalApproval.versions.${version}`);

  const exportQueue = () => {
    if (liveQuery.enabled) {
      if (liveRows.length === 0) {
        setExportFeedback({
          type: 'warning',
          message: t('common.assistantSurface.regionalApproval.exportFeedback.empty'),
        });
        return;
      }
      try {
        const csv = [
          csvCells(['planId', 'versionId', 'periodId', 'dealerCode', 'status', 'currentQty', 'currentAmount']),
          ...liveRows.map((row) =>
            csvCells([
              row.planId,
              row.versionId,
              row.periodId,
              row.dealerCode,
              row.status,
              row.currentQty,
              row.currentAmount,
            ])
          ),
        ].join('\n');
        const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `sales-plan-approval-${liveQuery.selectedPeriod?.periodMonth ?? 'period'}-${currentStage}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        setExportFeedback({
          type: 'success',
          message: t('common.assistantSurface.regionalApproval.exportFeedback.successLive', { count: liveRows.length }),
        });
      } catch {
        setExportFeedback({
          type: 'error',
          message: t('common.assistantSurface.regionalApproval.exportFeedback.failed'),
        });
      }
      return;
    }
    if (visibleRows.length === 0) {
      setExportFeedback({
        type: 'warning',
        message: t('common.assistantSurface.regionalApproval.exportFeedback.empty'),
      });
      return;
    }
    const csvLabels: ApprovalCsvLabels = {
      version: t('common.assistantSurface.regionalApproval.csv.version'),
      stage: t('common.assistantSurface.regionalApproval.csv.stage'),
      organization: t('common.assistantSurface.regionalApproval.csv.organization'),
      area: t('common.assistantSurface.regionalApproval.csv.area'),
      branch: t('common.assistantSurface.regionalApproval.csv.branch'),
      department: t('common.assistantSurface.regionalApproval.csv.department'),
      customer: t('common.assistantSurface.regionalApproval.csv.customer'),
      quantity: t('common.assistantSurface.regionalApproval.csv.quantity'),
      amount: t('common.assistantSurface.regionalApproval.csv.amount'),
      versionValues: {
        current: versionLabel('current'),
        previous: versionLabel('previous'),
        initial: versionLabel('initial'),
      },
    };
    try {
      const csv = buildApprovalCsv(visibleRows, primaryVersion, currentStage, csvLabels);
      const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `regional-approval-${primaryVersion}-fixture.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setExportFeedback({
        type: 'success',
        message: t('common.assistantSurface.regionalApproval.exportFeedback.success', {
          count: visibleRows.length,
          version: versionLabel(primaryVersion),
        }),
      });
    } catch {
      setExportFeedback({
        type: 'error',
        message: t('common.assistantSurface.regionalApproval.exportFeedback.failed'),
      });
    }
  };

  const currentStageIndex = APPROVAL_STAGE_FIXTURES.findIndex((stage) => stage.id === displayStage);
  const healthColors: Record<ApprovalHealth, 'green' | 'orange' | 'red'> = {
    healthy: 'green',
    attention: 'orange',
    warning: 'red',
  };
  const approvalColors: Record<ApprovalState, 'arcoblue' | 'green' | 'gray'> = {
    pending: 'arcoblue',
    approved: 'green',
    future: 'gray',
  };
  const localResultFor = (row: RegionalApprovalRow) =>
    localApprovalResults
      .toReversed()
      .find((result) => result.scope.organizationId === row.id && result.scope.version === primaryVersion);
  const liveColumns: TableColumnProps<RegionalApprovalLiveRow>[] = [
    {
      title: t('common.assistantSurface.regionalApproval.columns.organization'),
      width: 180,
      render: (_, row) => (
        <div className={styles.organizationCell}>
          <Button
            type='text'
            size='small'
            className={styles.detailTrigger}
            onClick={() => {
              selectLivePlanContext(row);
              setLiveDetailPlanId(row.planId);
            }}
            aria-label={t('common.assistantSurface.regionalApproval.liveDetail.openFor', {
              plan: row.baseName ?? row.orgCode ?? row.dealerCode,
            })}
          >
            {row.baseName ?? row.orgCode ?? row.dealerCode}
          </Button>
          <span>{t('common.assistantSurface.regionalApproval.query.dealerCode', { code: row.dealerCode })}</span>
        </div>
      ),
    },
    {
      title: t('common.assistantSurface.regionalApproval.columns.scope'),
      width: 205,
      render: (_, row) => (
        <div className={styles.stackCell}>
          <strong>{row.areaCode ?? t('common.assistantSurface.regionalApproval.query.scopeUnset')}</strong>
          <span>
            {row.provinceCode ?? '—'} · {row.orgCode ?? '—'}
          </span>
          <small>{row.baseName ?? '—'}</small>
        </div>
      ),
    },
    {
      title: t('common.assistantSurface.regionalApproval.columns.plan'),
      width: 205,
      render: (_, row) => (
        <div className={styles.stackCell}>
          <strong>
            {formatExactDecimal(row.currentQty)} · {exactMoney(row.currentAmount)}
          </strong>
          <span>
            {t('common.assistantSurface.regionalApproval.query.target')} {formatExactDecimal(row.targetQty)} ·{' '}
            {exactMoney(row.targetAmount)}
          </span>
        </div>
      ),
    },
    {
      title: t('common.assistantSurface.regionalApproval.columns.progress'),
      width: 140,
      render: (_, row) => (
        <div className={styles.stackCell}>
          <strong>{t('common.assistantSurface.regionalApproval.query.version', { seq: row.seq })}</strong>
          <span>{t('common.assistantSurface.regionalApproval.query.skuCount', { count: row.skuCount })}</span>
        </div>
      ),
    },
    {
      title: t('common.assistantSurface.regionalApproval.columns.adjustment'),
      width: 150,
      render: (_, row) => (
        <div className={styles.stackCell}>
          <strong>{row.submitter ?? '—'}</strong>
          <span>{row.returnReason ?? t('common.assistantSurface.regionalApproval.query.noReturnReason')}</span>
        </div>
      ),
    },
    {
      title: t('common.assistantSurface.regionalApproval.columns.status'),
      width: 95,
      render: (_, row) => (
        <Tag
          color={row.approvalState === 'approved' ? 'green' : row.approvalState === 'returned' ? 'orange' : 'arcoblue'}
        >
          {t(`common.assistantSurface.regionalApproval.query.status.${row.status}`)}
        </Tag>
      ),
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveSubmit.column'),
      width: 110,
      fixed: 'right',
      render: (_, row) => {
        const disabledReason = liveSubmitDisabledReason(row);
        const label = liveSubmitReceipts[row.versionId]
          ? t('common.assistantSurface.regionalApproval.liveSubmit.completed')
          : t('common.assistantSurface.regionalApproval.liveSubmit.open');
        return (
          <Tooltip
            content={
              disabledReason
                ? t(`common.assistantSurface.regionalApproval.liveSubmit.disabled.${disabledReason}`)
                : t('common.assistantSurface.regionalApproval.liveSubmit.enabledHint')
            }
          >
            <span>
              <Button
                size='mini'
                status='warning'
                disabled={Boolean(disabledReason)}
                title={
                  disabledReason
                    ? t(`common.assistantSurface.regionalApproval.liveSubmit.disabled.${disabledReason}`)
                    : undefined
                }
                aria-label={t('common.assistantSurface.regionalApproval.liveSubmit.openFor', {
                  plan: row.baseName ?? row.orgCode ?? row.dealerCode,
                })}
                onClick={() => {
                  selectLivePlanContext(row);
                  setLiveSubmitPlanId(row.planId);
                }}
              >
                {label}
              </Button>
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveAction.column'),
      width: 110,
      fixed: 'right',
      render: (_, row) => {
        const disabledReason = liveActionDisabledReason(row);
        const label = liveActionReceipts[row.versionId]
          ? t('common.assistantSurface.regionalApproval.liveAction.completed')
          : t('common.assistantSurface.regionalApproval.liveAction.open');
        return (
          <Tooltip
            content={
              disabledReason
                ? t(`common.assistantSurface.regionalApproval.liveAction.disabled.${disabledReason}`)
                : t('common.assistantSurface.regionalApproval.liveAction.enabledHint')
            }
          >
            <span>
              <Button
                size='mini'
                disabled={Boolean(disabledReason)}
                title={
                  disabledReason
                    ? t(`common.assistantSurface.regionalApproval.liveAction.disabled.${disabledReason}`)
                    : undefined
                }
                aria-label={t('common.assistantSurface.regionalApproval.liveAction.openFor', {
                  plan: row.baseName ?? row.orgCode ?? row.dealerCode,
                })}
                onClick={() => {
                  selectLivePlanContext(row);
                  setLiveActionKind('APPROVE');
                  setLiveActionPlanId(row.planId);
                }}
              >
                {label}
              </Button>
            </span>
          </Tooltip>
        );
      },
    },
  ];
  const columns: TableColumnProps<RegionalApprovalRow>[] = [
    {
      title: t('common.assistantSurface.regionalApproval.columns.organization'),
      width: 220,
      render: (_, row) => (
        <div className={styles.organizationCell}>
          <Button
            type='text'
            size='small'
            className={styles.detailTrigger}
            onClick={() => openDetail(row)}
            aria-label={t('common.assistantSurface.regionalApproval.detail.openFor', {
              organization: t(organizationLabelKey(row.organizationKey)),
            })}
          >
            {t(organizationLabelKey(row.organizationKey))}
          </Button>
          <span>
            {t(areaLabelKey(row.areaKey))} · {t(branchLabelKey(row.branchKey))} ·{' '}
            {t(departmentLabelKey(row.departmentKey))}
          </span>
          <small>
            {row.customerCode} · {t(customerLabelKey(row.customerKey))}
            <Button
              type='text'
              size='mini'
              className={styles.healthFilterAction}
              aria-label={t('common.assistantSurface.regionalApproval.healthFilter', {
                health: t(`common.assistantSurface.regionalApproval.health.${row.health}`),
              })}
              onClick={() => applyHealthFilter(row.health)}
            >
              <Tag size='small' color={healthColors[row.health]}>
                {t(`common.assistantSurface.regionalApproval.health.${row.health}`)}
              </Tag>
            </Button>
          </small>
        </div>
      ),
    },
    ...(categoryComparison
      ? [
          {
            title: t('common.assistantSurface.regionalApproval.columns.category'),
            width: 110,
            render: (_: unknown, row: RegionalApprovalRow) => (
              <Tag>{t(`common.assistantSurface.regionalApproval.categories.${row.category}`)}</Tag>
            ),
          },
        ]
      : []),
    {
      title: t('common.assistantSurface.regionalApproval.columns.aiOpinion'),
      width: 190,
      render: (_, row) => t(`common.assistantSurface.regionalApproval.opinions.${row.aiOpinionKey}`),
    },
    {
      title: t('common.assistantSurface.regionalApproval.columns.quantity'),
      width: 100,
      render: (_, row) => <strong>{number(metricsForApprovalVersion(row, primaryVersion).quantity)}</strong>,
    },
    {
      title: t('common.assistantSurface.regionalApproval.columns.amount'),
      width: 110,
      render: (_, row) => <strong>{money(metricsForApprovalVersion(row, primaryVersion).amount)}</strong>,
    },
    {
      title: t('common.assistantSurface.regionalApproval.columns.progress'),
      width: 125,
      render: (_, row) => (
        <div className={styles.stackCell}>
          <strong>
            {t('common.assistantSurface.regionalApproval.quantityProgress', { progress: row.quantityProgress })}
          </strong>
          <span>{t('common.assistantSurface.regionalApproval.amountProgress', { progress: row.amountProgress })}</span>
        </div>
      ),
    },
    {
      title: t('common.assistantSurface.regionalApproval.columns.adjustment'),
      width: 125,
      render: (_, row) => (
        <div className={styles.stackCell}>
          <strong>
            {row.adjustmentQuantity >= 0 ? '+' : ''}
            {number(row.adjustmentQuantity)}
          </strong>
          <span>
            {row.adjustmentAmount >= 0 ? '+' : ''}
            {money(row.adjustmentAmount)}
          </span>
        </div>
      ),
    },
    ...(primaryVersion !== compareVersion
      ? [
          {
            title: t('common.assistantSurface.regionalApproval.columns.comparison'),
            width: 145,
            render: (_: unknown, row: RegionalApprovalRow) => {
              const primary = metricsForApprovalVersion(row, primaryVersion);
              const compare = metricsForApprovalVersion(row, compareVersion);
              return (
                <div className={styles.stackCell}>
                  <strong>
                    {primary.quantity - compare.quantity >= 0 ? '+' : ''}
                    {number(primary.quantity - compare.quantity)}
                  </strong>
                  <span>
                    {primary.amount - compare.amount >= 0 ? '+' : ''}
                    {money(primary.amount - compare.amount)}
                  </span>
                </div>
              );
            },
          },
          {
            title: t('common.assistantSurface.regionalApproval.columns.returnReason'),
            width: 170,
            render: (_: unknown, row: RegionalApprovalRow) =>
              row.returnReason ?? t('common.assistantSurface.regionalApproval.columns.noReturnReason'),
          },
        ]
      : []),
    {
      title: t('common.assistantSurface.regionalApproval.columns.status'),
      width: 90,
      fixed: 'right',
      render: (_, row) => {
        const localResult = localResultFor(row);
        return localResult ? (
          <Tag color={localResult.kind === 'submit' ? 'green' : 'orange'}>
            {t(`common.assistantSurface.regionalApproval.action.rowStatus.${localResult.kind}`)}
          </Tag>
        ) : (
          <Tag color={approvalColors[row.approvalState]}>
            {t(`common.assistantSurface.regionalApproval.status.${row.approvalState}`)}
          </Tag>
        );
      },
    },
  ];

  return (
    <main
      className={styles.root}
      aria-label={t('common.assistantSurface.regionalApproval.ariaLabel')}
      data-testid='regional-approval-workbench'
    >
      <header className={styles.header}>
        <div className={styles.titleLine}>
          <Typography.Title heading={5}>{t('common.assistantSurface.regionalApproval.title')}</Typography.Title>
          <Tag className={styles.fixtureTag} color={liveQuery.enabled ? 'arcoblue' : 'red'}>
            {t(
              liveQuery.enabled
                ? 'common.assistantSurface.regionalApproval.query.dataTag'
                : 'common.assistantSurface.regionalApproval.fixtureTag'
            )}
          </Tag>
          {!liveQuery.enabled ? (
            <Tag color='orange'>{t('common.assistantSurface.regionalApproval.query.fixtureCapabilitiesTag')}</Tag>
          ) : null}
        </div>
        <div className={styles.scope} aria-label={t('common.assistantSurface.regionalApproval.scopeAria')}>
          {!liveQuery.enabled ? (
            <>
              <span>
                <small>{t('common.assistantSurface.regionalApproval.versions.primary')}</small>
                <Select
                  size='small'
                  value={primaryVersion}
                  aria-label={t('common.assistantSurface.regionalApproval.versions.primary')}
                  onChange={(value) => changePrimaryVersion(value as ApprovalVersion)}
                >
                  {APPROVAL_VERSIONS.map((version) => (
                    <Select.Option key={version} value={version}>
                      {versionLabel(version)}
                    </Select.Option>
                  ))}
                </Select>
              </span>
              <span>
                <small>{t('common.assistantSurface.regionalApproval.versions.compare')}</small>
                <Select
                  size='small'
                  value={compareVersion}
                  aria-label={t('common.assistantSurface.regionalApproval.versions.compare')}
                  onChange={(value) => changeCompareVersion(value as ApprovalVersion)}
                >
                  {APPROVAL_VERSIONS.map((version) => (
                    <Select.Option key={version} value={version}>
                      {versionLabel(version)}
                    </Select.Option>
                  ))}
                </Select>
              </span>
            </>
          ) : null}
          <span>
            <small>{t('common.assistantSurface.regionalApproval.planMonth')}</small>
            {liveQuery.enabled ? (
              <Spin loading={liveQuery.periodsState.status === 'loading' && liveQuery.periods.length === 0} size={14}>
                <Select
                  size='small'
                  value={liveQuery.selectedPeriod?.periodId}
                  aria-label={t('common.assistantSurface.regionalApproval.query.periodSelect')}
                  placeholder={t('common.assistantSurface.regionalApproval.query.noPeriod')}
                  onChange={(periodId) => {
                    setPage(1);
                    liveQuery.selectPeriod(periodId);
                  }}
                  disabled={liveQuery.periods.length === 0}
                >
                  {liveQuery.periods.map((period) => (
                    <Select.Option key={period.periodId} value={period.periodId}>
                      {period.periodMonth}
                    </Select.Option>
                  ))}
                </Select>
              </Spin>
            ) : (
              <Select size='small' value='2026-09' aria-label={t('common.assistantSurface.regionalApproval.planMonth')}>
                <Select.Option value='2026-09'>
                  {t('common.assistantSurface.regionalApproval.planMonthValue')}
                </Select.Option>
              </Select>
            )}
          </span>
          {liveQuery.enabled && liveQuery.selectedPeriod ? (
            <span>
              <small>{t('common.assistantSurface.regionalApproval.query.periodStatus')}</small>
              <Tag color={isOpenSalesPlanPeriod(liveQuery.selectedPeriod) ? 'green' : 'orange'}>
                {liveQuery.selectedPeriod.status}
              </Tag>
            </span>
          ) : null}
          <span>
            <small>{t('common.assistantSurface.regionalApproval.currentNode')}</small>
            <strong data-testid='regional-approval-current-stage'>
              {displayStage
                ? t(stageLabelKey(displayStage))
                : t('common.assistantSurface.regionalApproval.query.pendingStage')}
            </strong>
          </span>
        </div>
      </header>

      <div className={styles.stageViewport}>
        <nav className={styles.stageLane} aria-label={t('common.assistantSurface.regionalApproval.stageLane')}>
          {APPROVAL_STAGE_FIXTURES.map((stage, index) => {
            const state =
              index < currentStageIndex ? 'completed' : index === currentStageIndex ? 'current' : 'available';
            return (
              <React.Fragment key={stage.id}>
                <Button
                  type='text'
                  className={styles.stageButton}
                  data-state={state}
                  data-testid={`regional-approval-stage-${stage.id}`}
                  aria-current={stage.id === displayStage ? 'step' : undefined}
                  disabled={liveQuery.enabled}
                  onClick={() => changeStage(stage.id)}
                >
                  <span className={styles.stageMarker}>
                    {state === 'completed' ? <CheckOne size={14} /> : index + 1}
                  </span>
                  <span className={styles.stageCopy}>
                    <strong>{t(stageLabelKey(stage.id))}</strong>
                    <small>
                      {t('common.assistantSurface.regionalApproval.stageProgress', { progress: stage.progress })}
                    </small>
                  </span>
                </Button>
                {index < APPROVAL_STAGE_FIXTURES.length - 1 ? (
                  <span className={styles.stageConnector} data-state={state} aria-hidden='true' />
                ) : null}
              </React.Fragment>
            );
          })}
        </nav>
      </div>

      <div className={styles.content}>
        {liveQuery.enabled && liveQuery.periodsState.status === 'error' ? (
          <Alert
            className={styles.queryAlert}
            type='error'
            showIcon
            title={t('common.assistantSurface.regionalApproval.query.periodErrorTitle')}
            content={t(queryErrorKey(liveQuery.periodsState.error))}
            action={
              <Button size='small' onClick={liveQuery.retryPeriods}>
                {t('common.assistantSurface.regionalApproval.query.retry')}
              </Button>
            }
          />
        ) : null}
        {liveQuery.enabled && liveQuery.periodsState.status === 'success' && liveQuery.periods.length === 0 ? (
          <Alert
            className={styles.queryAlert}
            type='info'
            showIcon
            title={t('common.assistantSurface.regionalApproval.query.noPeriod')}
            content={t('common.assistantSurface.regionalApproval.query.noPeriodDescription')}
          />
        ) : null}
        <section className={styles.queue} aria-label={t('common.assistantSurface.regionalApproval.queue.ariaLabel')}>
          <header className={styles.queueHeader}>
            <div>
              <h2>{t('common.assistantSurface.regionalApproval.queue.title')}</h2>
              <Typography.Text type='secondary'>
                {t('common.assistantSurface.regionalApproval.queue.counts', {
                  count: metrics.visibleCount,
                  pending: metrics.pendingCount,
                })}
              </Typography.Text>
            </div>
            <div className={styles.queueMetrics}>
              <span>
                <small>{t('common.assistantSurface.regionalApproval.queue.quantity')}</small>
                <strong>{formatExactDecimal(metrics.quantity)}</strong>
              </span>
              <span>
                <small>{t('common.assistantSurface.regionalApproval.queue.amount')}</small>
                <strong>{exactMoney(metrics.amount)}</strong>
              </span>
              <span>
                <small>{t('common.assistantSurface.regionalApproval.queue.authority')}</small>
                <strong>{t('common.assistantSurface.regionalApproval.queue.organization')}</strong>
              </span>
            </div>
          </header>
          <section
            className={styles.controls}
            aria-label={t('common.assistantSurface.regionalApproval.filters.ariaLabel')}
          >
            <div className={styles.controlToolbar}>
              <div
                className={styles.dimensionTabs}
                role='tablist'
                aria-label={t('common.assistantSurface.regionalApproval.dimensions.ariaLabel')}
              >
                {APPROVAL_DIMENSIONS_BY_STAGE[currentStage].map((candidate) => (
                  <Button
                    key={candidate}
                    size='small'
                    type='text'
                    role='tab'
                    aria-selected={candidate === dimension}
                    data-active={candidate === dimension}
                    onClick={() => setDimension(candidate)}
                  >
                    {t(`common.assistantSurface.regionalApproval.dimensions.${candidate}`)}
                  </Button>
                ))}
              </div>
              <div className={styles.toolbarActions}>
                {!liveQuery.enabled ? (
                  <label className={styles.categorySwitch}>
                    <Switch
                      size='small'
                      checked={categoryComparison}
                      aria-label={t('common.assistantSurface.regionalApproval.categoryComparison')}
                      onChange={setCategoryComparison}
                    />
                    <span>{t('common.assistantSurface.regionalApproval.categoryComparison')}</span>
                  </label>
                ) : null}
                {liveQuery.enabled ? (
                  <Tooltip content={t('common.assistantSurface.regionalApproval.liveSubmit.firstSubmitUnavailable')}>
                    <span>
                      <Button size='small' disabled>
                        {t('common.assistantSurface.regionalApproval.liveSubmit.firstSubmit')}
                      </Button>
                    </span>
                  </Tooltip>
                ) : null}
                <Button size='small' onClick={() => setProgressOpen(true)}>
                  {t('common.assistantSurface.regionalApproval.toolbar.progress')}
                </Button>
                {liveQuery.enabled ? (
                  <Button
                    size='small'
                    icon={<Refresh size={14} />}
                    loading={liveQuery.refreshing}
                    loadingFixedWidth
                    disabled={liveQuery.refreshing}
                    onClick={liveQuery.refresh}
                  >
                    {t('common.assistantSurface.regionalApproval.toolbar.refreshData')}
                  </Button>
                ) : null}
                <Button size='small' icon={<Download size={14} />} onClick={exportQueue}>
                  {t('common.assistantSurface.regionalApproval.toolbar.export')}
                </Button>
              </div>
            </div>

            <div className={styles.advancedControls}>
              {lastLiveSubmitReceipt ? (
                <Alert
                  className={styles.queryAlert}
                  type='success'
                  showIcon
                  closable
                  onClose={() => setLastLiveSubmitReceipt(undefined)}
                  content={t('common.assistantSurface.regionalApproval.liveSubmit.receiptBanner', {
                    planId: lastLiveSubmitReceipt.planId,
                    versionId: lastLiveSubmitReceipt.versionId,
                    requestId: lastLiveSubmitReceipt.requestId,
                    auditId: lastLiveSubmitReceipt.auditId,
                  })}
                />
              ) : null}

              <div className={styles.filterHeading}>
                <strong>{t('common.assistantSurface.regionalApproval.filters.title')}</strong>
                {!liveQuery.enabled ? (
                  <Tag color='orange'>{t('common.assistantSurface.regionalApproval.query.fixtureScopeTag')}</Tag>
                ) : null}
                <Tag color={(liveQuery.enabled ? liveFiltersDirty : filtersDirty) ? 'orange' : 'green'}>
                  {t(
                    (liveQuery.enabled ? liveFiltersDirty : filtersDirty)
                      ? 'common.assistantSurface.regionalApproval.filters.dirty'
                      : 'common.assistantSurface.regionalApproval.filters.applied'
                  )}
                </Tag>
              </div>
              <div className={styles.filterRow}>
                <div className={styles.fieldControl}>
                  <span>{t('common.assistantSurface.regionalApproval.filters.area')}</span>
                  <Select
                    size='small'
                    value={liveQuery.enabled ? draftLiveFilters.areaCode : draftFilters.area}
                    aria-label={t('common.assistantSurface.regionalApproval.filters.area')}
                    onChange={(value) =>
                      liveQuery.enabled ? updateLiveDraftFilter('areaCode', value) : updateDraftFilter('area', value)
                    }
                  >
                    <Select.Option value={ALL_ORGANIZATIONS}>
                      {t('common.assistantSurface.regionalApproval.filters.allAreas')}
                    </Select.Option>
                    {(liveQuery.enabled ? liveFilterOptions.areaCodes : filterOptions.area).map((value) => (
                      <Select.Option key={value} value={value}>
                        {liveQuery.enabled ? value : t(areaLabelKey(value as RegionalApprovalRow['areaKey']))}
                      </Select.Option>
                    ))}
                  </Select>
                </div>
                <div className={styles.fieldControl}>
                  <span>{t('common.assistantSurface.regionalApproval.filters.branch')}</span>
                  <Select
                    size='small'
                    value={liveQuery.enabled ? draftLiveFilters.provinceCode : draftFilters.branch}
                    aria-label={t('common.assistantSurface.regionalApproval.filters.branch')}
                    onChange={(value) =>
                      liveQuery.enabled
                        ? updateLiveDraftFilter('provinceCode', value)
                        : updateDraftFilter('branch', value)
                    }
                  >
                    <Select.Option value={ALL_ORGANIZATIONS}>
                      {t('common.assistantSurface.regionalApproval.filters.allBranches')}
                    </Select.Option>
                    {(liveQuery.enabled ? liveFilterOptions.provinceCodes : filterOptions.branch).map((value) => (
                      <Select.Option key={value} value={value}>
                        {liveQuery.enabled ? value : t(branchLabelKey(value as RegionalApprovalRow['branchKey']))}
                      </Select.Option>
                    ))}
                  </Select>
                </div>
                <div className={styles.fieldControl}>
                  <span>{t('common.assistantSurface.regionalApproval.filters.department')}</span>
                  <Select
                    size='small'
                    value={liveQuery.enabled ? draftLiveFilters.orgCode : draftFilters.department}
                    aria-label={t('common.assistantSurface.regionalApproval.filters.department')}
                    onChange={(value) =>
                      liveQuery.enabled
                        ? updateLiveDraftFilter('orgCode', value)
                        : updateDraftFilter('department', value)
                    }
                  >
                    <Select.Option value={ALL_ORGANIZATIONS}>
                      {t('common.assistantSurface.regionalApproval.filters.allDepartments')}
                    </Select.Option>
                    {(liveQuery.enabled ? liveFilterOptions.orgCodes : filterOptions.department).map((value) => (
                      <Select.Option key={value} value={value}>
                        {liveQuery.enabled
                          ? value
                          : t(departmentLabelKey(value as RegionalApprovalRow['departmentKey']))}
                      </Select.Option>
                    ))}
                  </Select>
                </div>
                <div className={styles.fieldControl}>
                  <span>{t('common.assistantSurface.regionalApproval.filters.customer')}</span>
                  <Select
                    size='small'
                    value={liveQuery.enabled ? draftLiveFilters.dealerCode : draftFilters.customer}
                    aria-label={t('common.assistantSurface.regionalApproval.filters.customer')}
                    onChange={(value) =>
                      liveQuery.enabled
                        ? updateLiveDraftFilter('dealerCode', value)
                        : updateDraftFilter('customer', value)
                    }
                    showSearch
                  >
                    <Select.Option value={ALL_ORGANIZATIONS}>
                      {t('common.assistantSurface.regionalApproval.filters.allCustomers')}
                    </Select.Option>
                    {liveQuery.enabled
                      ? liveFilterOptions.customers.map((option) => (
                          <Select.Option key={option.dealerCode} value={option.dealerCode}>
                            {option.dealerCode}
                            {option.baseName ? ` · ${option.baseName}` : ''}
                          </Select.Option>
                        ))
                      : filterOptions.customer.map((value) => (
                          <Select.Option key={value} value={value}>
                            {REGIONAL_APPROVAL_ROWS.find((row) => row.customerKey === value)?.customerCode} ·{' '}
                            {t(customerLabelKey(value as RegionalApprovalRow['customerKey']))}
                          </Select.Option>
                        ))}
                  </Select>
                </div>
                <div className={styles.fieldControl}>
                  <span>{t('common.assistantSurface.regionalApproval.filters.approval')}</span>
                  <Select
                    size='small'
                    value={liveQuery.enabled ? draftLiveFilters.status : draftFilters.approval}
                    aria-label={t('common.assistantSurface.regionalApproval.filters.approval')}
                    onChange={(value) =>
                      liveQuery.enabled ? updateLiveDraftFilter('status', value) : updateDraftFilter('approval', value)
                    }
                  >
                    <Select.Option value={ALL_ORGANIZATIONS}>
                      {t('common.assistantSurface.regionalApproval.filters.allApprovals')}
                    </Select.Option>
                    {liveQuery.enabled
                      ? Array.from({ length: 10 }, (_, index) => String(index + 1)).map((value) => (
                          <Select.Option key={value} value={value}>
                            {t(`common.assistantSurface.regionalApproval.query.status.${value}`)}
                          </Select.Option>
                        ))
                      : filterOptions.approval.map((value) => (
                          <Select.Option key={value} value={value}>
                            {t(`common.assistantSurface.regionalApproval.status.${value}`)}
                          </Select.Option>
                        ))}
                  </Select>
                </div>
                {!liveQuery.enabled ? (
                  <div className={styles.fieldControl}>
                    <span>{t('common.assistantSurface.regionalApproval.filters.health')}</span>
                    <Select
                      size='small'
                      value={draftFilters.health}
                      aria-label={t('common.assistantSurface.regionalApproval.filters.health')}
                      onChange={(value) => updateDraftFilter('health', value)}
                    >
                      <Select.Option value={ALL_ORGANIZATIONS}>
                        {t('common.assistantSurface.regionalApproval.filters.allHealth')}
                      </Select.Option>
                      {filterOptions.health.map((value) => (
                        <Select.Option key={value} value={value}>
                          {t(`common.assistantSurface.regionalApproval.health.${value}`)}
                        </Select.Option>
                      ))}
                    </Select>
                  </div>
                ) : null}
                <div className={styles.filterActions}>
                  <Button
                    size='small'
                    onClick={applyFilters}
                    disabled={liveQuery.enabled ? !liveFiltersDirty : !filtersDirty}
                  >
                    {t('common.assistantSurface.regionalApproval.filters.query')}
                  </Button>
                  <Button size='small' icon={<Refresh size={14} />} onClick={resetFilters}>
                    {t('common.assistantSurface.regionalApproval.filters.reset')}
                  </Button>
                </div>
              </div>
            </div>
            {exportFeedback ? (
              <Alert
                className={styles.exportFeedback}
                type={exportFeedback.type}
                content={exportFeedback.message}
                closable
                onClose={() => setExportFeedback(undefined)}
              />
            ) : null}
          </section>
          <div className={styles.tableViewport}>
            {liveQuery.enabled ? (
              <Spin loading={liveQuery.queueState.status === 'loading'} className={styles.querySpin}>
                {liveQuery.queueState.status === 'error' ? (
                  <Alert
                    className={styles.queryAlert}
                    type='error'
                    showIcon
                    title={t('common.assistantSurface.regionalApproval.query.queueErrorTitle')}
                    content={t(queryErrorKey(liveQuery.queueState.error))}
                    action={
                      <Button size='small' onClick={liveQuery.retryQueue}>
                        {t('common.assistantSurface.regionalApproval.query.retry')}
                      </Button>
                    }
                  />
                ) : null}
                {liveQuery.queueState.status === 'success' && liveRows.length === 0 ? (
                  <Empty
                    description={
                      <div>
                        <strong>{t('common.assistantSurface.regionalApproval.query.emptyQueue')}</strong>
                        <br />
                        <small>{t('common.assistantSurface.regionalApproval.query.emptyQueueHint')}</small>
                      </div>
                    }
                  />
                ) : (
                  <Table
                    rowKey='planId'
                    columns={liveColumns}
                    data={prioritizedLiveRows}
                    rowSelection={{
                      type: 'radio',
                      selectedRowKeys: selectedRowIds,
                      onChange: (keys) => setSelectedRowIds(keys.map(String).slice(-1)),
                      checkboxProps: (row) => ({
                        disabled: Boolean(
                          liveQueueMode === 'resubmit' ? liveSubmitDisabledReason(row) : liveActionDisabledReason(row)
                        ),
                      }),
                    }}
                    pagination={false}
                    size='small'
                    scroll={{ x: 1195 }}
                  />
                )}
              </Spin>
            ) : (
              <Table
                rowKey='id'
                columns={columns}
                data={pageData.rows}
                rowSelection={{
                  selectedRowKeys: selectedRowIds,
                  onChange: (keys) => setSelectedRowIds(keys.map(String)),
                  checkboxProps: (row) => ({ disabled: !selectableFixtureRow(row) }),
                }}
                pagination={false}
                size='small'
                scroll={{ x: 1360 }}
              />
            )}
          </div>
          <footer className={styles.queueFooter} data-testid='regional-approval-queue-footer'>
            <div className={styles.footerControls}>
              <div className={styles.pageSizeControl}>
                <span>{t('common.assistantSurface.regionalApproval.pagination.pageSize')}</span>
                <Select
                  size='small'
                  value={pageSize}
                  aria-label={t('common.assistantSurface.regionalApproval.pagination.pageSize')}
                  onChange={(value) => {
                    setPageSize(Number(value));
                    setPage(1);
                  }}
                >
                  {[10, 20, 50, 100].map((size) => (
                    <Select.Option key={size} value={size}>
                      {t('common.assistantSurface.regionalApproval.pagination.pageSizeValue', { count: size })}
                    </Select.Option>
                  ))}
                </Select>
              </div>
              <span>
                {t('common.assistantSurface.regionalApproval.pagination.total', {
                  count: liveQuery.enabled ? (liveQuery.queueState.data?.total ?? 0) : pageData.total,
                })}
              </span>
              <Pagination
                size='small'
                current={
                  liveQuery.enabled
                    ? liveQuery.queueState.status === 'loading'
                      ? page
                      : (liveQuery.queueState.data?.current ?? page)
                    : pageData.page
                }
                pageSize={liveQuery.enabled ? (liveQuery.queueState.data?.size ?? pageSize) : pageData.pageSize}
                total={liveQuery.enabled ? (liveQuery.queueState.data?.total ?? 0) : pageData.total}
                onChange={setPage}
              />
              {liveQuery.enabled ? (
                <>
                  <Button
                    size='small'
                    status='danger'
                    disabled={
                      selectedLiveRows.length !== 1 ||
                      selectedLiveRows[0]?.status === 5 ||
                      (selectedLiveRows[0] ? Boolean(liveActionDisabledReason(selectedLiveRows[0])) : true)
                    }
                    onClick={() => {
                      const row = selectedLiveRows[0];
                      if (!row) return;
                      selectLivePlanContext(row);
                      setLiveActionKind('REJECT');
                      setLiveActionPlanId(row.planId);
                    }}
                  >
                    {t('common.assistantSurface.regionalApproval.liveAction.reject')}
                  </Button>
                  <Button
                    type='primary'
                    size='small'
                    disabled={
                      selectedLiveRows.length !== 1 ||
                      (selectedLiveRows[0] ? Boolean(liveActionDisabledReason(selectedLiveRows[0])) : true)
                    }
                    onClick={() => {
                      const row = selectedLiveRows[0];
                      if (!row) return;
                      selectLivePlanContext(row);
                      setLiveActionKind('APPROVE');
                      setLiveActionPlanId(row.planId);
                    }}
                  >
                    {t('common.assistantSurface.regionalApproval.liveAction.approve')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size='small'
                    status='danger'
                    disabled={selectedFixtureRows.length === 0}
                    onClick={() => selectedFixtureRows[0] && openAction(selectedFixtureRows[0])}
                  >
                    {t('common.assistantSurface.regionalApproval.footer.return')}
                  </Button>
                  <Button
                    type='primary'
                    size='small'
                    disabled={selectedFixtureRows.length === 0 || currentStage === 'category'}
                    onClick={() => selectedFixtureRows[0] && openAction(selectedFixtureRows[0])}
                  >
                    {t('common.assistantSurface.regionalApproval.footer.submit')}
                  </Button>
                </>
              )}
            </div>
          </footer>
        </section>
      </div>

      <Modal
        visible={progressOpen}
        title={t('common.assistantSurface.regionalApproval.progressDialog.title', {
          stage: t(stageLabelKey(currentStage)),
        })}
        footer={
          <Button onClick={() => setProgressOpen(false)}>
            {t('common.assistantSurface.regionalApproval.progressDialog.close')}
          </Button>
        }
        onCancel={() => setProgressOpen(false)}
        className={styles.progressModal}
      >
        <Typography.Paragraph type='secondary'>
          {t('common.assistantSurface.regionalApproval.progressDialog.description', {
            version: versionLabel(primaryVersion),
            count: metrics.visibleCount,
          })}
        </Typography.Paragraph>
        <div className={styles.progressList} data-testid='regional-approval-progress-results'>
          {(liveQuery.enabled ? liveRows : visibleRows).map((row) => {
            if (isLiveApprovalRow(row)) {
              return (
                <div className={styles.progressRow} key={row.planId}>
                  <span>
                    <strong>{row.baseName ?? row.orgCode ?? row.dealerCode}</strong>
                    <small>
                      {formatExactDecimal(row.currentQty)} · {exactMoney(row.currentAmount)}
                    </small>
                  </span>
                  <Progress percent={row.status >= 1 && row.status <= 5 ? row.status * 20 : 100} size='small' />
                  <Tag color={row.approvalState === 'returned' ? 'orange' : 'arcoblue'}>
                    {t(`common.assistantSurface.regionalApproval.query.status.${row.status}`)}
                  </Tag>
                </div>
              );
            }
            const versionMetrics = metricsForApprovalVersion(row, primaryVersion);
            const progress = Math.round((row.quantityProgress + row.amountProgress) / 2);
            return (
              <div className={styles.progressRow} key={row.id}>
                <span>
                  <strong>{t(organizationLabelKey(row.organizationKey))}</strong>
                  <small>
                    {number(versionMetrics.quantity)} · {money(versionMetrics.amount)}
                  </small>
                </span>
                <Progress percent={progress} size='small' />
                <Tag color={approvalColors[row.approvalState]}>
                  {t(`common.assistantSurface.regionalApproval.status.${row.approvalState}`)}
                </Tag>
              </div>
            );
          })}
        </div>
      </Modal>

      {activeDetailRow ? (
        <RegionalApprovalPlanDetail
          visible
          rows={visibleRows}
          row={activeDetailRow}
          approvalStage={currentStage}
          categoryComparison={categoryComparison}
          version={primaryVersion}
          store={detailStore}
          t={t}
          onStoreChange={setDetailStore}
          onClose={() => setDetailRowId(undefined)}
          onRowChange={setDetailRowId}
          onVersionChange={changePrimaryVersion}
        />
      ) : null}

      {activeLiveDetailRow ? (
        <RegionalApprovalLivePlanDetail
          visible
          rows={liveRows}
          row={activeLiveDetailRow}
          t={t}
          client={detailClient}
          onClose={() => setLiveDetailPlanId(undefined)}
          onRowChange={(planId) => {
            const row = liveRows.find((candidate) => candidate.planId === planId);
            if (row) selectLivePlanContext(row);
            setLiveDetailPlanId(planId);
          }}
        />
      ) : null}

      {activeLiveActionRow && liveActionsEnabled ? (
        <RegionalApprovalLiveActionDialog
          key={activeLiveActionRow.versionId}
          visible
          row={activeLiveActionRow}
          approvalStage={approvalStageForSalesPlanStatus(activeLiveActionRow.status) ?? effectiveStage}
          initialAction={liveActionKind}
          t={t}
          client={liveActionClient}
          onPermissionDenied={(versionId) => setPermissionDeniedVersions((current) => new Set(current).add(versionId))}
          onSucceeded={(receipt) => {
            setLiveActionReceipts((current) => ({ ...current, [receipt.versionId]: receipt }));
            setLiveAuthorityContext(projectSalesPlanActionContext(activeLiveActionRow, receipt, contextFilterSummary));
            setSelectedRowIds([]);
            setLiveActionPlanId(undefined);
            liveQuery.retryQueue();
          }}
          onRefresh={liveQuery.retryQueue}
          onClose={() => setLiveActionPlanId(undefined)}
        />
      ) : null}

      {activeLiveSubmitRow && liveQuery.selectedPeriod && liveSubmissionsEnabled ? (
        <RegionalApprovalLiveSubmitDialog
          key={activeLiveSubmitRow.versionId}
          visible
          row={activeLiveSubmitRow}
          period={liveQuery.selectedPeriod}
          t={t}
          client={liveSubmitClient}
          onSucceeded={(receipt) => {
            setLiveSubmitReceipts((current) => ({ ...current, [activeLiveSubmitRow.versionId]: receipt }));
            setLastLiveSubmitReceipt(receipt);
            setLiveAuthorityContext(projectSalesPlanSubmitContext(activeLiveSubmitRow, receipt, contextFilterSummary));
            liveQuery.retryQueue();
          }}
          onRefresh={liveQuery.retryQueue}
          onClose={() => setLiveSubmitPlanId(undefined)}
        />
      ) : null}

      {activeActionRow ? (
        <RegionalApprovalActionDialog
          visible
          rows={selectedFixtureRows.length > 0 ? selectedFixtureRows : [activeActionRow]}
          version={primaryVersion}
          approvalStage={currentStage}
          savedAdjustments={savedAdjustments}
          store={actionStore}
          t={t}
          executor={actionExecutor}
          onStoreChange={setActionStore}
          onClose={() => setActionRowId(undefined)}
        />
      ) : null}
    </main>
  );
};

export default RegionalApprovalWorkbench;
