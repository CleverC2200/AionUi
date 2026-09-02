import { auth, salesPlan, type GeaSalesPlanPeriod, type GeaSalesPlanSubmitReceipt } from '@/common/adapter/ipcBridge';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SalesPlanSubmitAttempt,
  SalesPlanSubmitError,
  classifySalesPlanSubmitError,
  prepareSalesPlanResubmit,
  type SalesPlanSubmitClient,
  type SalesPlanSubmitInput,
} from '../models/salesPlanSubmitModel';

const defaultClient: SalesPlanSubmitClient = {
  detail: salesPlan.detail,
  versionSkus: salesPlan.versionSkus,
  currentUser: auth.currentUser,
  submit: salesPlan.submit,
};

export type SalesPlanSubmitSourceState =
  | { status: 'loading' }
  | { status: 'success'; input: SalesPlanSubmitInput }
  | { status: 'error'; error: SalesPlanSubmitError };

export type SalesPlanSubmitState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; receipt: GeaSalesPlanSubmitReceipt }
  | { status: 'error'; error: SalesPlanSubmitError };

export const useSalesPlanSubmit = ({
  client = defaultClient,
  period,
  planId,
  versionId,
  channelCode,
}: {
  client?: SalesPlanSubmitClient;
  period: GeaSalesPlanPeriod;
  planId: string;
  versionId: string;
  channelCode?: string;
}) => {
  const attempt = useRef(new SalesPlanSubmitAttempt(client));
  const sourceRequest = useRef(0);
  const operation = useRef(0);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [sourceState, setSourceState] = useState<SalesPlanSubmitSourceState>({ status: 'loading' });
  const [state, setState] = useState<SalesPlanSubmitState>({ status: 'idle' });

  useEffect(() => {
    const requestId = ++sourceRequest.current;
    const controller = new AbortController();
    setSourceState({ status: 'loading' });
    void Promise.all([
      client.detail.invoke({ planId, signal: controller.signal }),
      client.versionSkus.invoke({ versionId, signal: controller.signal }),
      client.currentUser.invoke(),
    ])
      .then(([detail, skus, currentUser]) => {
        if (sourceRequest.current !== requestId || controller.signal.aborted) return;
        try {
          setSourceState({
            status: 'success',
            input: prepareSalesPlanResubmit({ period, planId, versionId, detail, skus, currentUser, channelCode }),
          });
        } catch (error) {
          setSourceState({ status: 'error', error: classifySalesPlanSubmitError(error) });
        }
      })
      .catch((error: unknown) => {
        if (sourceRequest.current !== requestId || controller.signal.aborted) return;
        setSourceState({ status: 'error', error: classifySalesPlanSubmitError(error) });
      });
    return () => controller.abort();
  }, [channelCode, client, period, planId, sourceRevision, versionId]);

  const settle = useCallback(async (promise: Promise<GeaSalesPlanSubmitReceipt>) => {
    const current = ++operation.current;
    setState({ status: 'loading' });
    try {
      const receipt = await promise;
      if (operation.current === current) setState({ status: 'success', receipt });
      return receipt;
    } catch (error) {
      const classified = classifySalesPlanSubmitError(error);
      if (operation.current === current) setState({ status: 'error', error: classified });
      throw classified;
    }
  }, []);

  return {
    sourceState,
    state,
    execute: () => {
      if (sourceState.status !== 'success') {
        return settle(Promise.reject(new SalesPlanSubmitError('sourceMismatch', false)));
      }
      return settle(attempt.current.submit(sourceState.input));
    },
    retry: () => settle(attempt.current.retry()),
    retrySource: () => setSourceRevision((revision) => revision + 1),
  };
};
