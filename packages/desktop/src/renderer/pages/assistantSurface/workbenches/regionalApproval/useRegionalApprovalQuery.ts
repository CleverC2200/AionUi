import { isBackendHttpError } from '@/common/adapter/httpBridge';
import {
  salesPlan,
  type GeaSalesPlanListItem,
  type GeaSalesPlanPage,
  type GeaSalesPlanPageQuery,
  type GeaSalesPlanPeriod,
  type GeaSalesPlanPeriodQuery,
} from '@/common/adapter/ipcBridge';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  approvalStageProgressForSalesPlanStatusTotals,
  chooseInitialSalesPlanPeriod,
  clampSalesPlanPageNumber,
  VISIBLE_SALES_PLAN_STATUSES_BY_STAGE,
  type RegionalApprovalQueryScope,
} from './regionalApprovalQueryModel';
import type { ApprovalStageId } from './regionalApprovalFixture';

const QUERY_TIMEOUT_MS = 15_000;

export type SalesPlanQueryClient = {
  periods: { invoke: (query?: GeaSalesPlanPeriodQuery) => Promise<GeaSalesPlanPage<GeaSalesPlanPeriod>> };
  list: { invoke: (query?: GeaSalesPlanPageQuery) => Promise<GeaSalesPlanPage<GeaSalesPlanListItem>> };
};

export type RegionalApprovalQueryError = 'permission' | 'expired' | 'timeout' | 'unavailable' | 'cancelled' | 'failed';

type QueryState<T> =
  | { status: 'idle'; data?: undefined; error?: undefined }
  | { status: 'loading'; data?: T; error?: undefined }
  | { status: 'success'; data: T; error?: undefined }
  | { status: 'error'; data?: T; error: RegionalApprovalQueryError };

const idle = { status: 'idle' } as const;

export const classifyRegionalApprovalQueryError = (error: unknown, timedOut = false): RegionalApprovalQueryError => {
  if (timedOut) return 'timeout';
  if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
  if (isBackendHttpError(error)) {
    if (error.status === 401) return 'expired';
    if (error.status === 403) return 'permission';
    if (error.status === 408 || error.status === 504) return 'timeout';
    if (error.status >= 500) return 'unavailable';
  }
  if (error instanceof TypeError) return 'unavailable';
  return 'failed';
};

const beginTimedRequest = () => {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, QUERY_TIMEOUT_MS);
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    finish: () => window.clearTimeout(timeout),
    cancel: () => {
      window.clearTimeout(timeout);
      controller.abort();
    },
  };
};

export const useRegionalApprovalQuery = ({
  client = salesPlan,
  page,
  pageSize,
  scope,
  loadStageProgress = false,
  stageStatuses,
}: {
  client?: SalesPlanQueryClient | null;
  page: number;
  pageSize: number;
  scope?: RegionalApprovalQueryScope;
  loadStageProgress?: boolean;
  stageStatuses?: readonly number[];
}) => {
  const [periodsState, setPeriodsState] = useState<QueryState<GeaSalesPlanPeriod[]>>(idle);
  const [queueState, setQueueState] = useState<QueryState<GeaSalesPlanPage<GeaSalesPlanListItem>>>(idle);
  const [progressState, setProgressState] = useState<QueryState<Record<ApprovalStageId, number>>>(idle);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>();
  const [queueSettledPage, setQueueSettledPage] = useState<number>();
  const [periodRevision, setPeriodRevision] = useState(0);
  const [queueRevision, setQueueRevision] = useState(0);
  const periodsRequest = useRef(0);
  const queueRequest = useRef(0);
  const progressRequest = useRef(0);
  const stableScope = useMemo(
    () => ({
      dealerCode: scope?.dealerCode,
      areaCode: scope?.areaCode,
      provinceCode: scope?.provinceCode,
      orgCode: scope?.orgCode,
      baseName: scope?.baseName,
      status: scope?.status,
    }),
    [scope?.areaCode, scope?.baseName, scope?.dealerCode, scope?.orgCode, scope?.provinceCode, scope?.status]
  );
  const stableStageStatuses = useMemo(
    () =>
      stageStatuses
        ? [...new Set(stageStatuses.filter((status) => Number.isSafeInteger(status)))].toSorted((a, b) => a - b)
        : undefined,
    [stageStatuses]
  );
  useEffect(() => {
    if (!client) {
      setPeriodsState(idle);
      setQueueState(idle);
      setProgressState(idle);
      setSelectedPeriodId(undefined);
      setQueueSettledPage(undefined);
      return;
    }
    const requestId = ++periodsRequest.current;
    const request = beginTimedRequest();
    setPeriodsState((current) => ({ status: 'loading', data: current.data }));
    void client.periods
      .invoke({ pageNo: 1, pageSize: 100, signal: request.signal })
      .then((response) => {
        if (periodsRequest.current !== requestId || request.signal.aborted) return;
        const records = Array.isArray(response.records) ? response.records : [];
        setPeriodsState({ status: 'success', data: records });
        setSelectedPeriodId((current) => {
          if (current && records.some((period) => period.periodId === current)) return current;
          return chooseInitialSalesPlanPeriod(records)?.periodId;
        });
      })
      .catch((error: unknown) => {
        if (periodsRequest.current !== requestId) return;
        const classified = classifyRegionalApprovalQueryError(error, request.didTimeOut());
        if (classified !== 'cancelled' || request.didTimeOut()) {
          setPeriodsState((current) => ({ status: 'error', data: current.data, error: classified }));
        }
      })
      .finally(request.finish);
    return request.cancel;
  }, [client, periodRevision]);

  const periods = periodsState.data ?? [];
  const selectedPeriod = periods.find((period) => period.periodId === selectedPeriodId);
  const selectedPeriodPlanTypeCode = selectedPeriod?.planTypeCode;

  useEffect(() => {
    if (!client || !selectedPeriodId || !selectedPeriodPlanTypeCode) {
      setQueueState(idle);
      setQueueSettledPage(undefined);
      return;
    }
    const requestId = ++queueRequest.current;
    const request = beginTimedRequest();
    setQueueState((current) => ({ status: 'loading', data: current.data }));
    const requestedPage = clampSalesPlanPageNumber(page);
    const baseQuery = {
      periodId: selectedPeriodId,
      planTypeCode: selectedPeriodPlanTypeCode,
      pageNo: requestedPage,
      pageSize: clampSalesPlanPageNumber(pageSize, 20),
      ...stableScope,
      signal: request.signal,
    };
    const queuePromise =
      stableStageStatuses && stableStageStatuses.length > 1
        ? Promise.all(
            stableStageStatuses.map(async (status) => {
              const requestedSize = clampSalesPlanPageNumber(pageSize, 20);
              const requiredPrefix = requestedPage * requestedSize;
              const serverPageSize = Math.min(200, requiredPrefix);
              const first = await client.list.invoke({
                ...baseQuery,
                status,
                pageNo: 1,
                pageSize: serverPageSize,
              });
              const pageCount = Math.min(
                Math.ceil(first.total / serverPageSize),
                Math.ceil(requiredPrefix / serverPageSize)
              );
              const rest = await Promise.all(
                Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
                  client.list.invoke({
                    ...baseQuery,
                    status,
                    pageNo: index + 2,
                    pageSize: serverPageSize,
                  })
                )
              );
              return {
                records: [first, ...rest].flatMap((statusPage) => statusPage.records),
                total: first.total,
              };
            })
          ).then((pages) => {
            const requestedSize = clampSalesPlanPageNumber(pageSize, 20);
            const start = (requestedPage - 1) * requestedSize;
            const records = pages
              .flatMap((statusPage) => statusPage.records)
              .toSorted((left, right) =>
                String(right.updatedAt ?? right.submitTime ?? right.planId).localeCompare(
                  String(left.updatedAt ?? left.submitTime ?? left.planId)
                )
              );
            const total = pages.reduce((sum, statusPage) => sum + statusPage.total, 0);
            return {
              records: records.slice(start, start + requestedSize),
              total,
              size: requestedSize,
              current: requestedPage,
              pages: Math.max(1, Math.ceil(total / requestedSize)),
            } satisfies GeaSalesPlanPage<GeaSalesPlanListItem>;
          })
        : client.list.invoke({
            ...baseQuery,
            ...(stableStageStatuses?.length === 1 ? { status: stableStageStatuses[0] } : {}),
          });
    void queuePromise
      .then((response) => {
        if (queueRequest.current !== requestId || request.signal.aborted) return;
        setQueueState({ status: 'success', data: response });
        setQueueSettledPage(requestedPage);
      })
      .catch((error: unknown) => {
        if (queueRequest.current !== requestId) return;
        const classified = classifyRegionalApprovalQueryError(error, request.didTimeOut());
        if (classified !== 'cancelled' || request.didTimeOut()) {
          setQueueState((current) => ({ status: 'error', data: current.data, error: classified }));
        }
      })
      .finally(request.finish);
    return request.cancel;
  }, [
    client,
    page,
    pageSize,
    queueRevision,
    selectedPeriodId,
    selectedPeriodPlanTypeCode,
    stableScope,
    stableStageStatuses,
  ]);

  useEffect(() => {
    if (!client || !loadStageProgress || !selectedPeriodId || !selectedPeriodPlanTypeCode) {
      setProgressState(idle);
      return;
    }
    const requestId = ++progressRequest.current;
    const request = beginTimedRequest();
    setProgressState((current) => ({ status: 'loading', data: current.data }));
    const statuses = [...new Set(Object.values(VISIBLE_SALES_PLAN_STATUSES_BY_STAGE).flat())];
    const baseQuery = {
      periodId: selectedPeriodId,
      planTypeCode: selectedPeriodPlanTypeCode,
      pageNo: 1,
      pageSize: 1,
      signal: request.signal,
    };

    void Promise.all([
      client.list.invoke(baseQuery),
      ...statuses.map((status) => client.list.invoke({ ...baseQuery, status })),
    ])
      .then(([allRows, ...statusPages]) => {
        if (progressRequest.current !== requestId || request.signal.aborted) return;
        const statusTotals = Object.fromEntries(
          statuses.map((status, index) => [status, statusPages[index]?.total ?? 0])
        );
        setProgressState({
          status: 'success',
          data: approvalStageProgressForSalesPlanStatusTotals(allRows.total, statusTotals),
        });
      })
      .catch((error: unknown) => {
        if (progressRequest.current !== requestId) return;
        const classified = classifyRegionalApprovalQueryError(error, request.didTimeOut());
        if (classified !== 'cancelled' || request.didTimeOut()) {
          setProgressState((current) => ({ status: 'error', data: current.data, error: classified }));
        }
      })
      .finally(request.finish);
    return request.cancel;
  }, [client, loadStageProgress, queueRevision, selectedPeriodId, selectedPeriodPlanTypeCode]);

  const refreshing =
    periodsState.status === 'loading' ||
    queueState.status === 'loading' ||
    (loadStageProgress && progressState.status === 'loading');

  return {
    enabled: client !== null,
    periodsState,
    queueState,
    progressState,
    queueSettledPage,
    periods,
    selectedPeriod,
    refreshing,
    selectPeriod: (periodId: string) => setSelectedPeriodId(periodId),
    refresh: () => {
      if (refreshing) return;
      setPeriodRevision((current) => current + 1);
      setQueueRevision((current) => current + 1);
    },
    retryPeriods: () => setPeriodRevision((current) => current + 1),
    retryQueue: () => setQueueRevision((current) => current + 1),
  };
};
