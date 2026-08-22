/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { useAuthSessionEpoch } from '@/renderer/hooks/context/AuthContext';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * The cross-session messaging master switch, read from `system_settings`.
 *
 * Backed by a MODULE-LEVEL store rather than per-hook `useState`, because four
 * unrelated components read it — the settings switch, the disabled banner, each
 * send box, and the rate-limit notice — and they must agree. With a local copy
 * each, flipping the switch in one place left the others stale: pressing
 * "resume" on the banner hid the banner while the send box still refused to
 * offer `@@`, and turning the feature off from the loop warning left both the
 * banner and `@@` unchanged until the conversation remounted.
 *
 * Defaults to `true` and stays `true` on a read failure: the switch is an
 * opt-out panic button (spec §5.7 / §6.9.2), so a transient error must not make
 * the feature look broken. The backend enforces the real gate — this value only
 * decides whether the `@@` entry point is offered.
 */

type Listener = () => void;

let enabledState = true;
let loadPromise: Promise<void> | null = null;
let storeEpoch: number | undefined;
const listeners = new Set<Listener>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

const setEnabledState = (next: boolean): void => {
  if (enabledState === next) return;
  enabledState = next;
  emit();
};

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): boolean => enabledState;

/**
 * Fetch once per app session and share the result. Concurrent mounts await the
 * same promise instead of each issuing its own `GET /api/settings`.
 */
const activateEpoch = (authSessionEpoch: number): void => {
  if (storeEpoch === authSessionEpoch) return;
  storeEpoch = authSessionEpoch;
  loadPromise = null;
  setEnabledState(true);
};

const load = (authSessionEpoch: number): Promise<void> => {
  activateEpoch(authSessionEpoch);
  if (loadPromise) return loadPromise;
  let loaded = false;
  const request = (async () => {
    try {
      // Optional-chained: a preload/bridge build without this entry must degrade
      // to the default rather than throwing inside a render effect.
      const settings = await ipcBridge.systemSettings?.getCrossSessionMessageEnabled?.invoke?.();
      if (storeEpoch === authSessionEpoch && settings?.cross_session_message_enabled !== undefined) {
        setEnabledState(settings.cross_session_message_enabled);
        loaded = true;
      }
    } catch {
      // Leave the default (on) in place.
    } finally {
      // A failed/unsupported first read must not poison the module cache. The
      // next mount or explicit refresh gets a real retry.
      if (!loaded && storeEpoch === authSessionEpoch && loadPromise === request) {
        loadPromise = null;
      }
    }
  })();
  loadPromise = request;
  return request;
};

/** Drop the cached fetch so the next mount re-reads. Exported for tests. */
export const resetCrossSessionMessageEnabledCache = (): void => {
  loadPromise = null;
  storeEpoch = undefined;
  enabledState = true;
  emit();
};

export function useCrossSessionMessageEnabled(): {
  enabled: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  refresh: () => void;
} {
  const authSessionEpoch = useAuthSessionEpoch();
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    void load(authSessionEpoch);
  }, [authSessionEpoch, reloadToken]);

  const setEnabled = useCallback(async (next: boolean) => {
    const previous = enabledState;
    const requestEpoch = storeEpoch;
    // Optimistic, and shared: every consumer sees the new value immediately, so
    // the banner and the `@@` entry point can never disagree.
    setEnabledState(next);
    try {
      const setter = ipcBridge.systemSettings?.setCrossSessionMessageEnabled;
      if (!setter?.invoke) {
        throw new Error('cross-session message setting bridge unavailable');
      }
      await setter.invoke({ enabled: next });
    } catch (error) {
      // Roll back so the UI never claims a state the backend rejected.
      if (storeEpoch === requestEpoch) setEnabledState(previous);
      throw error;
    }
  }, []);

  const refresh = useCallback(() => {
    loadPromise = null;
    setReloadToken((token) => token + 1);
  }, []);

  return { enabled, setEnabled, refresh };
}
