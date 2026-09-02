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
  chooseInitialSalesPlanPeriod,
  clampSalesPlanPageNumber,
  type RegionalApprovalQueryScope,
} from './regionalApprovalQueryModel';

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
}: {
  client?: SalesPlanQueryClient | null;
  page: number;
  pageSize: number;
  scope?: RegionalApprovalQueryScope;
}) => {
  const [periodsState, setPeriodsState] = useState<QueryState<GeaSalesPlanPeriod[]>>(idle);
  const [queueState, setQueueState] = useState<QueryState<GeaSalesPlanPage<GeaSalesPlanListItem>>>(idle);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>();
  const [queueSettledPage, setQueueSettledPage] = useState<number>();
  const [periodRevision, setPeriodRevision] = useState(0);
  const [queueRevision, setQueueRevision] = useState(0);
  const periodsRequest = useRef(0);
  const queueRequest = useRef(0);
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

  useEffect(() => {
    if (!client) {
      setPeriodsState(idle);
      setQueueState(idle);
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
    void client.list
      .invoke({
        periodId: selectedPeriodId,
        planTypeCode: selectedPeriodPlanTypeCode,
        pageNo: requestedPage,
        pageSize: clampSalesPlanPageNumber(pageSize, 20),
        ...stableScope,
        signal: request.signal,
      })
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
  }, [client, page, pageSize, queueRevision, selectedPeriodId, selectedPeriodPlanTypeCode, stableScope]);

  const refreshing = periodsState.status === 'loading' || queueState.status === 'loading';

  return {
    enabled: client !== null,
    periodsState,
    queueState,
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
