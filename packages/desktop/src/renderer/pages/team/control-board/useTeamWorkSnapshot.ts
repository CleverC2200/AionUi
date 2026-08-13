import { useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import type { ITeamWorkSnapshot } from '@/common/types/team/teamTypes';
import { applyTeamWorkEvent } from './teamWorkProjection';

export function useTeamWorkSnapshot(teamId: string) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<ITeamWorkSnapshot>(
    teamId ? ['team-work-snapshot', teamId] : null,
    () => ipcBridge.team.getWorkSnapshot.invoke({ team_id: teamId }),
    { revalidateOnFocus: false }
  );
  const snapshotRef = useRef(data);
  const reconcileRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    snapshotRef.current = data;
  }, [data]);

  const replaceSnapshot = useCallback(async () => {
    const next = await mutate();
    snapshotRef.current = next;
  }, [mutate]);

  const reconcileEvents = useCallback(() => {
    if (reconcileRef.current) return reconcileRef.current;
    const reconciliation = (async () => {
      const current = snapshotRef.current;
      if (!current) return replaceSnapshot();
      try {
        const batch = await ipcBridge.team.listWorkEvents.invoke({
          team_id: teamId,
          after_sequence: current.sequence,
        });
        if (batch.gap) return replaceSnapshot();
        let projected = current;
        for (const event of batch.events) {
          const result = applyTeamWorkEvent(projected, event);
          if (result.kind === 'reconcile') return replaceSnapshot();
          projected = result.snapshot;
        }
        snapshotRef.current = projected;
        await mutate(projected, false);
      } catch {
        await replaceSnapshot();
      }
    })().finally(() => {
      reconcileRef.current = null;
    });
    reconcileRef.current = reconciliation;
    return reconciliation;
  }, [mutate, replaceSnapshot, teamId]);

  useEffect(() => {
    const unsubscribeWork =
      ipcBridge.team.workEvent?.on((event) => {
        if (event.team_id !== teamId) return;
        const current = snapshotRef.current;
        if (!current) {
          void replaceSnapshot();
          return;
        }
        const result = applyTeamWorkEvent(current, event);
        if (result.kind === 'reconcile') {
          void reconcileEvents();
        } else if (result.kind === 'applied') {
          snapshotRef.current = result.snapshot;
          void mutate(result.snapshot, false);
        }
      }) ?? (() => {});
    const unsubscribeReconnect =
      ipcBridge.realtime?.reconnected?.on(() => {
        void (async () => {
          try {
            await ipcBridge.team.reconcileStaleWork.invoke({ team_id: teamId });
          } catch {
            // The authoritative snapshot below is the reconnect fallback.
          }
          await replaceSnapshot();
        })();
      }) ?? (() => {});
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void replaceSnapshot();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      unsubscribeWork();
      unsubscribeReconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [mutate, reconcileEvents, replaceSnapshot, teamId]);

  return {
    snapshot: data,
    error,
    isLoading,
    isRefreshing: isValidating && Boolean(data),
    refresh: replaceSnapshot,
  };
}
