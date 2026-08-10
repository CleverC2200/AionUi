import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import type { ITeamWorkEvent, ITeamWorkSnapshot, ITeamWorkTask } from '@/common/types/team/teamTypes';
import { useTeamWorkSnapshot } from '@/renderer/pages/team/control-board/useTeamWorkSnapshot';

const mocks = vi.hoisted(() => ({
  workHandlers: [] as Array<(event: unknown) => void>,
  reconnectHandlers: [] as Array<() => void>,
  unsubscribeWork: vi.fn(),
  unsubscribeReconnect: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      getWorkSnapshot: { invoke: vi.fn() },
      listWorkEvents: { invoke: vi.fn() },
      reconcileStaleWork: { invoke: vi.fn() },
      workEvent: {
        on: vi.fn((handler: (event: unknown) => void) => {
          mocks.workHandlers.push(handler);
          return mocks.unsubscribeWork;
        }),
      },
    },
    realtime: {
      reconnected: {
        on: vi.fn((handler: () => void) => {
          mocks.reconnectHandlers.push(handler);
          return mocks.unsubscribeReconnect;
        }),
      },
    },
  },
}));

const getWorkSnapshot = vi.mocked(ipcBridge.team.getWorkSnapshot.invoke);
const listWorkEvents = vi.mocked(ipcBridge.team.listWorkEvents.invoke);
const reconcileStaleWork = vi.mocked(ipcBridge.team.reconcileStaleWork.invoke);

const task = (version: number, status: ITeamWorkTask['status'] = 'ready'): ITeamWorkTask => ({
  id: 'task-1',
  team_id: 'team-1',
  subject: 'Task',
  acceptance_criteria: [],
  status,
  priority: 'normal',
  next_action_owner: 'agent',
  blocked_by: [],
  blocks: [],
  artifact_refs: [],
  approval_state: 'none',
  exclusive_workspace: false,
  version,
  created_at: 1,
  updated_at: version,
});

const snapshot = (sequence: number, version = sequence, status: ITeamWorkTask['status'] = 'ready') =>
  ({
    team_id: 'team-1',
    sequence,
    generated_at: sequence,
    tasks: [task(version, status)],
    runs: [],
    attention: [],
  }) satisfies ITeamWorkSnapshot;

const event = (sequence: number): ITeamWorkEvent => ({
  sequence,
  event_id: `event-${sequence}`,
  team_id: 'team-1',
  task_id: 'task-1',
  name: 'team.workTaskChanged',
  task_version: sequence,
  payload: { task: task(sequence, 'running'), run: null, attention: null },
  created_at: sequence,
});

const createSwrWrapper = () => {
  const cache = new Map();
  return function SwrTestWrapper({ children }: PropsWithChildren) {
    return createElement(
      SWRConfig,
      {
        value: {
          provider: () => cache,
          dedupingInterval: 0,
          revalidateOnFocus: false,
          revalidateOnReconnect: false,
        },
      },
      children
    );
  };
};

describe('useTeamWorkSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workHandlers.length = 0;
    mocks.reconnectHandlers.length = 0;
    getWorkSnapshot.mockReset().mockResolvedValue(snapshot(1));
    listWorkEvents.mockReset();
    reconcileStaleWork.mockReset().mockResolvedValue([]);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('applies the next realtime event without refetching the authoritative snapshot', async () => {
    const { result } = renderHook(() => useTeamWorkSnapshot('team-1'), { wrapper: createSwrWrapper() });

    await waitFor(() => expect(result.current.snapshot?.sequence).toBe(1));
    await waitFor(() => expect(mocks.workHandlers).toHaveLength(1));

    act(() => mocks.workHandlers[0](event(2)));

    await waitFor(() => expect(result.current.snapshot?.sequence).toBe(2));
    expect(result.current.snapshot?.tasks[0].status).toBe('running');
    expect(getWorkSnapshot).toHaveBeenCalledTimes(1);
    expect(listWorkEvents).not.toHaveBeenCalled();
  });

  it('fills a sequence gap from the ordered event endpoint', async () => {
    listWorkEvents.mockResolvedValue({
      team_id: 'team-1',
      after_sequence: 1,
      latest_sequence: 3,
      gap: false,
      events: [event(2), event(3)],
    });
    const { result } = renderHook(() => useTeamWorkSnapshot('team-1'), { wrapper: createSwrWrapper() });

    await waitFor(() => expect(result.current.snapshot?.sequence).toBe(1));
    await waitFor(() => expect(mocks.workHandlers).toHaveLength(1));
    act(() => mocks.workHandlers[0](event(3)));

    await waitFor(() => expect(result.current.snapshot?.sequence).toBe(3));
    expect(listWorkEvents).toHaveBeenCalledWith({ team_id: 'team-1', after_sequence: 1 });
    expect(getWorkSnapshot).toHaveBeenCalledTimes(1);
  });

  it('replaces local state when the event endpoint reports a retained-history gap', async () => {
    getWorkSnapshot.mockResolvedValueOnce(snapshot(1)).mockResolvedValueOnce(snapshot(4, 4, 'done'));
    listWorkEvents.mockResolvedValue({
      team_id: 'team-1',
      after_sequence: 1,
      latest_sequence: 4,
      gap: true,
      events: [],
    });
    const { result } = renderHook(() => useTeamWorkSnapshot('team-1'), { wrapper: createSwrWrapper() });

    await waitFor(() => expect(result.current.snapshot?.sequence).toBe(1));
    await waitFor(() => expect(mocks.workHandlers).toHaveLength(1));
    act(() => mocks.workHandlers[0](event(3)));

    await waitFor(() => expect(result.current.snapshot?.sequence).toBe(4));
    expect(result.current.snapshot?.tasks[0].status).toBe('done');
    expect(getWorkSnapshot).toHaveBeenCalledTimes(2);
  });

  it('reconciles stale work and reloads the snapshot after reconnect', async () => {
    getWorkSnapshot.mockResolvedValueOnce(snapshot(1)).mockResolvedValueOnce(snapshot(5, 5, 'failed'));
    const { result, unmount } = renderHook(() => useTeamWorkSnapshot('team-1'), { wrapper: createSwrWrapper() });

    await waitFor(() => expect(result.current.snapshot?.sequence).toBe(1));
    await waitFor(() => expect(mocks.reconnectHandlers).toHaveLength(1));
    act(() => mocks.reconnectHandlers[0]());

    await waitFor(() => expect(result.current.snapshot?.sequence).toBe(5));
    expect(reconcileStaleWork).toHaveBeenCalledWith({ team_id: 'team-1' });

    unmount();
    expect(mocks.unsubscribeWork).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribeReconnect).toHaveBeenCalledTimes(1);
  });
});
