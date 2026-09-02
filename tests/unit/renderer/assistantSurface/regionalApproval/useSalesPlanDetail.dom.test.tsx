import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type {
  GeaSalesPlanApprovalLog,
  GeaSalesPlanDetail,
  GeaSalesPlanSku,
  GeaSalesPlanSkuDiff,
  GeaSalesPlanVersion,
} from '@/common/adapter/ipcBridge';
import {
  classifySalesPlanDetailError,
  useSalesPlanDetail,
  type SalesPlanDetailClient,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/hooks/useSalesPlanDetail';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const version = (id: string, planId: string): GeaSalesPlanVersion => ({
  id,
  planId,
  seq: id.endsWith('2') ? 2 : 1,
  periodId: 'period-1',
  planTypeCode: 'MONTHLY',
  dealerCode: 'dealer-1',
  status: 4,
  effective: id.endsWith('2'),
  targetAmount: '200.00',
  targetQty: '20',
});

const detail = (planId: string, versionId: string): GeaSalesPlanDetail => ({
  currentVersion: version(versionId, planId),
  skus: [],
  versions: [],
  logs: [],
});

const sku = (versionId: string): GeaSalesPlanSku => ({
  id: `${versionId}-sku`,
  versionId,
  skuCode: `${versionId}-SKU`,
  productCategName: '饮品',
  baseQty: '10',
  qty: '12',
  price: '8.50',
  amt: '102.00',
  amtBase: '85.00',
});

const comparison = (fromVersionId: string, toVersionId: string, qtyDelta: string): GeaSalesPlanSkuDiff[] => [
  {
    skuCode: 'COMPARE-SKU',
    changeType: 'UPDATED',
    before: { ...sku(fromVersionId), skuCode: 'COMPARE-SKU' },
    after: { ...sku(toVersionId), skuCode: 'COMPARE-SKU' },
    qtyDelta,
    amountDelta: '17.00',
  },
];

const overview = (planId: string, currentVersionId: string) => ({
  detail: detail(planId, currentVersionId),
  versions: [version(currentVersionId, planId), version(`${planId}-v1`, planId)],
  logs: [] as GeaSalesPlanApprovalLog[],
});

const clientFrom = (
  resolveOverview: (planId: string) => ReturnType<typeof overview> | Promise<ReturnType<typeof overview>>,
  versionSkus: SalesPlanDetailClient['versionSkus']['invoke'] = async ({ versionId }) => [sku(versionId)],
  compare: SalesPlanDetailClient['compare']['invoke'] = async () => [] as GeaSalesPlanSkuDiff[]
): SalesPlanDetailClient => ({
  detail: { invoke: vi.fn(async ({ planId }) => (await resolveOverview(planId)).detail) },
  versions: { invoke: vi.fn(async ({ planId }) => (await resolveOverview(planId)).versions) },
  logs: { invoke: vi.fn(async ({ planId }) => (await resolveOverview(planId)).logs) },
  versionSkus: { invoke: vi.fn(versionSkus) },
  compare: { invoke: vi.fn(compare) },
});

const Probe: React.FC<{ client: SalesPlanDetailClient; planId?: string; versionId?: string }> = ({
  client,
  planId,
  versionId,
}) => {
  const state = useSalesPlanDetail({ client, planId, initialVersionId: versionId });
  return (
    <div>
      <span data-testid='overview'>{state.overviewState.status}</span>
      <span data-testid='selected'>{state.selectedVersionId ?? 'none'}</span>
      <span data-testid='sku'>
        {state.skuState.status === 'success'
          ? state.skuState.data.map((item) => item.skuCode).join(',')
          : state.skuState.status}
      </span>
      <span data-testid='compare'>
        {state.compareState.status === 'success'
          ? state.compareState.data.map((item) => item.qtyDelta).join(',')
          : state.compareState.status}
      </span>
      <button onClick={() => state.selectVersion(`${planId}-v1`)}>previous</button>
      <button
        onClick={() => {
          if (!state.fromVersionId || !state.toVersionId) return;
          const previousFrom = state.fromVersionId;
          state.selectFromVersion(state.toVersionId);
          state.selectToVersion(previousFrom);
        }}
      >
        reverse-compare
      </button>
    </div>
  );
};

describe('useSalesPlanDetail', () => {
  it.each([
    [401, 'expired'],
    [403, 'permission'],
    [404, 'missing'],
    [408, 'timeout'],
    [504, 'timeout'],
    [500, 'unavailable'],
  ] as const)('classifies HTTP %s into a stable recoverable state', (status, expected) => {
    expect(
      classifySalesPlanDetailError(
        new BackendHttpError({ method: 'GET', path: '/api/gea/sales-plan/plans/plan-1', status, body: {} })
      )
    ).toBe(expected);
  });

  it('distinguishes a request timeout from an intentional cancellation', () => {
    const abort = new DOMException('aborted', 'AbortError');
    expect(classifySalesPlanDetailError(abort)).toBe('cancelled');
    expect(classifySalesPlanDetailError(abort, true)).toBe('timeout');
  });

  it('ignores a late plan response and aborts the previous plan request', async () => {
    const planA = deferred<ReturnType<typeof overview>>();
    const planB = deferred<ReturnType<typeof overview>>();
    const resolveOverview = vi.fn((planId: string) => (planId === 'plan-a' ? planA.promise : planB.promise));
    const client = clientFrom(resolveOverview);
    const view = render(<Probe client={client} planId='plan-a' versionId='plan-a-v2' />);

    await waitFor(() => expect(client.detail.invoke).toHaveBeenCalledTimes(1));
    const planASignal = vi.mocked(client.detail.invoke).mock.calls[0][0].signal!;
    view.rerender(<Probe client={client} planId='plan-b' versionId='plan-b-v2' />);
    expect(planASignal.aborted).toBe(true);

    await act(async () => planB.resolve(overview('plan-b', 'plan-b-v2')));
    await screen.findByText('plan-b-v2-SKU');
    await act(async () => planA.resolve(overview('plan-a', 'plan-a-v2')));
    expect(screen.getByTestId('selected')).toHaveTextContent('plan-b-v2');
    expect(screen.getByTestId('sku')).toHaveTextContent('plan-b-v2-SKU');
    expect(screen.getByTestId('sku')).not.toHaveTextContent('plan-a-v2-SKU');
  });

  it('aborts a superseded SKU version and keeps the latest version result', async () => {
    const current = deferred<GeaSalesPlanSku[]>();
    const previous = deferred<GeaSalesPlanSku[]>();
    const versionSkus = vi.fn(({ versionId, signal }: { versionId: string; signal?: AbortSignal }) => {
      if (versionId === 'plan-a-v2') {
        expect(signal).toBeInstanceOf(AbortSignal);
        return current.promise;
      }
      return previous.promise;
    });
    const client = clientFrom((planId) => overview(planId, `${planId}-v2`), versionSkus);
    render(<Probe client={client} planId='plan-a' versionId='plan-a-v2' />);

    await waitFor(() => expect(versionSkus).toHaveBeenCalledTimes(1));
    const currentSignal = versionSkus.mock.calls[0][0].signal!;
    fireEvent.click(screen.getByRole('button', { name: 'previous' }));
    await waitFor(() => expect(versionSkus).toHaveBeenCalledTimes(2));
    expect(currentSignal.aborted).toBe(true);

    await act(async () => previous.resolve([sku('plan-a-v1')]));
    await screen.findByText('plan-a-v1-SKU');
    await act(async () => current.resolve([sku('plan-a-v2')]));
    expect(screen.getByTestId('sku')).toHaveTextContent('plan-a-v1-SKU');
    expect(screen.getByTestId('sku')).not.toHaveTextContent('plan-a-v2-SKU');
  });

  it('aborts a superseded comparison and ignores its late result', async () => {
    const compareA = deferred<GeaSalesPlanSkuDiff[]>();
    const compareB = deferred<GeaSalesPlanSkuDiff[]>();
    const compare = vi.fn(({ fromVersionId }: { fromVersionId: string }) =>
      fromVersionId === 'plan-a-v1' ? compareA.promise : compareB.promise
    );
    const client = clientFrom((planId) => overview(planId, `${planId}-v2`), undefined, compare);
    render(<Probe client={client} planId='plan-a' versionId='plan-a-v2' />);

    await waitFor(() => expect(compare).toHaveBeenCalledTimes(1));
    const compareASignal = compare.mock.calls[0][0].signal!;
    fireEvent.click(screen.getByRole('button', { name: 'reverse-compare' }));
    await waitFor(() => expect(compare).toHaveBeenCalledTimes(2));
    expect(compareASignal.aborted).toBe(true);

    await act(async () => compareB.resolve(comparison('plan-a-v2', 'plan-a-v1', '2')));
    await waitFor(() => expect(screen.getByTestId('compare')).toHaveTextContent('2'));
    await act(async () => compareA.resolve(comparison('plan-a-v1', 'plan-a-v2', '1')));
    expect(screen.getByTestId('compare')).toHaveTextContent('2');
    expect(screen.getByTestId('compare')).not.toHaveTextContent('1');
  });

  it('aborts all in-flight resources when the detail is closed', async () => {
    const pending = deferred<ReturnType<typeof overview>>();
    const client = clientFrom(() => pending.promise);
    const view = render(<Probe client={client} planId='plan-a' versionId='plan-a-v2' />);
    await waitFor(() => expect(client.detail.invoke).toHaveBeenCalledTimes(1));
    const signals = [client.detail.invoke, client.versions.invoke, client.logs.invoke].map(
      (invoke) => vi.mocked(invoke).mock.calls[0][0].signal!
    );
    view.unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('aborts SKU and comparison requests when closing after overview succeeds', async () => {
    const pendingSkus = deferred<GeaSalesPlanSku[]>();
    const pendingComparison = deferred<GeaSalesPlanSkuDiff[]>();
    const versionSkus = vi.fn(() => pendingSkus.promise);
    const compare = vi.fn(() => pendingComparison.promise);
    const client = clientFrom((planId) => overview(planId, `${planId}-v2`), versionSkus, compare);
    const view = render(<Probe client={client} planId='plan-a' versionId='plan-a-v2' />);

    await waitFor(() => {
      expect(versionSkus).toHaveBeenCalledTimes(1);
      expect(compare).toHaveBeenCalledTimes(1);
    });
    const skuSignal = versionSkus.mock.calls[0][0].signal!;
    const compareSignal = compare.mock.calls[0][0].signal!;
    view.unmount();
    expect(skuSignal.aborted).toBe(true);
    expect(compareSignal.aborted).toBe(true);
  });
});
