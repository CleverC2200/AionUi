import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_REGIONAL_APPROVAL_ACTION_STORE,
  reduceRegionalApprovalActionStore,
  regionalApprovalActionKey,
  regionalApprovalReturnValidationErrors,
  regionalApprovalSubmitValidationErrors,
  type RegionalApprovalActionCommand,
  type RegionalApprovalActionStore,
  type RegionalApprovalFixtureOutcome,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/regionalApprovalActionModel';

const scope = {
  organizationId: 'north-area',
  version: 'current' as const,
  approvalStage: 'area' as const,
  savedAdjustmentCount: 1,
};

const command = (requestId: string, attempt = 1): RegionalApprovalActionCommand => ({
  requestId,
  key: regionalApprovalActionKey('return', scope),
  kind: 'return',
  attempt,
  scope,
  returnTarget: 'previous-stage',
  reason: '补齐高偏差 SKU 证据',
  impactScope: 'current-organization',
});

const outcome: RegionalApprovalFixtureOutcome = {
  source: 'fixture',
  resultId: 'fixture-result-1',
  completedAt: '2026-09-01T00:00:00.000Z',
};

describe('regional approval action model', () => {
  it('preserves store identity for repeated controlled draft values and an already clear operation', () => {
    const populated: RegionalApprovalActionStore = {
      ...EMPTY_REGIONAL_APPROVAL_ACTION_STORE,
      returnDraft: {
        target: 'previous-stage',
        reason: '补齐证据',
        impactScope: 'filtered-scope',
      },
      submitConfirmed: true,
    };

    expect(reduceRegionalApprovalActionStore(populated, { type: 'return-target', target: 'previous-stage' })).toBe(
      populated
    );
    expect(reduceRegionalApprovalActionStore(populated, { type: 'return-reason', reason: '补齐证据' })).toBe(populated);
    expect(reduceRegionalApprovalActionStore(populated, { type: 'return-impact', impactScope: 'filtered-scope' })).toBe(
      populated
    );
    expect(reduceRegionalApprovalActionStore(populated, { type: 'submit-confirmed', confirmed: true })).toBe(populated);
    expect(reduceRegionalApprovalActionStore(populated, { type: 'clear-operation' })).toBe(populated);
  });

  it('requires return fields and an explicit submit confirmation', () => {
    expect(regionalApprovalReturnValidationErrors(EMPTY_REGIONAL_APPROVAL_ACTION_STORE)).toEqual(['target', 'reason']);
    expect(regionalApprovalSubmitValidationErrors(EMPTY_REGIONAL_APPROVAL_ACTION_STORE)).toEqual(['confirmation']);

    let store = reduceRegionalApprovalActionStore(EMPTY_REGIONAL_APPROVAL_ACTION_STORE, {
      type: 'return-target',
      target: 'previous-stage',
    });
    store = reduceRegionalApprovalActionStore(store, { type: 'return-reason', reason: '补齐证据' });
    store = reduceRegionalApprovalActionStore(store, { type: 'submit-confirmed', confirmed: true });
    expect(regionalApprovalReturnValidationErrors(store)).toEqual([]);
    expect(regionalApprovalSubmitValidationErrors(store)).toEqual([]);
  });

  it('blocks duplicate starts and records only an explicit source=fixture success', () => {
    const first = command('request-1');
    let store = reduceRegionalApprovalActionStore(EMPTY_REGIONAL_APPROVAL_ACTION_STORE, {
      type: 'start',
      command: first,
    });
    const duplicateWhileLoading = reduceRegionalApprovalActionStore(store, {
      type: 'start',
      command: command('request-duplicate'),
    });
    expect(duplicateWhileLoading).toBe(store);

    store = reduceRegionalApprovalActionStore(store, { type: 'success', requestId: first.requestId, outcome });
    expect(store.results[first.key]).toMatchObject({
      source: 'fixture',
      kind: 'return',
      scope,
      returnTarget: 'previous-stage',
    });
    expect(reduceRegionalApprovalActionStore(store, { type: 'start', command: command('request-after-success') })).toBe(
      store
    );
  });

  it('keeps drafts through failure and permits a new controlled retry attempt', () => {
    let store: RegionalApprovalActionStore = {
      ...EMPTY_REGIONAL_APPROVAL_ACTION_STORE,
      returnDraft: {
        target: 'submitting-organization',
        reason: '保留此退回原因',
        impactScope: 'filtered-scope',
      },
    };
    store = reduceRegionalApprovalActionStore(store, { type: 'start', command: command('request-1') });
    store = reduceRegionalApprovalActionStore(store, {
      type: 'failure',
      requestId: 'request-1',
      errorCode: 'fixture_fail_once',
    });
    expect(store.returnDraft).toEqual({
      target: 'submitting-organization',
      reason: '保留此退回原因',
      impactScope: 'filtered-scope',
    });

    store = reduceRegionalApprovalActionStore(store, { type: 'start', command: command('request-2', 2) });
    expect(store.operation).toMatchObject({ status: 'loading', command: { requestId: 'request-2', attempt: 2 } });
  });

  it('ignores a late controlled async success after cancellation', async () => {
    let resolveOutcome: (value: RegionalApprovalFixtureOutcome) => void = vi.fn();
    const executor = vi.fn(
      () =>
        new Promise<RegionalApprovalFixtureOutcome>((resolve) => {
          resolveOutcome = resolve;
        })
    );
    const activeCommand = command('request-cancelled');
    let store = reduceRegionalApprovalActionStore(EMPTY_REGIONAL_APPROVAL_ACTION_STORE, {
      type: 'start',
      command: activeCommand,
    });
    const pending = executor(activeCommand);
    store = reduceRegionalApprovalActionStore(store, { type: 'cancel', requestId: activeCommand.requestId });
    resolveOutcome(outcome);
    const lateOutcome = await pending;
    store = reduceRegionalApprovalActionStore(store, {
      type: 'success',
      requestId: activeCommand.requestId,
      outcome: lateOutcome,
    });

    expect(store.operation?.status).toBe('cancelled');
    expect(store.results).toEqual({});
    expect(executor).toHaveBeenCalledTimes(1);
  });
});
