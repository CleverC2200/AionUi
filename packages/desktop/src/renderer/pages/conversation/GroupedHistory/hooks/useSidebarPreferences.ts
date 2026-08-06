/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';

import type { SidebarLayoutMode, SidebarSortMode } from '../utils/sidebarSorting';

export const SIDEBAR_PREFERENCES_STORAGE_KEY = 'grouped-history-sidebar-preferences';

type SidebarPreferences = {
  layoutMode: SidebarLayoutMode;
  sortMode: SidebarSortMode;
};

const DEFAULT_PREFERENCES: SidebarPreferences = {
  layoutMode: 'projects',
  sortMode: 'priority',
};

const readSidebarPreferences = (): SidebarPreferences => {
  try {
    const stored = JSON.parse(
      localStorage.getItem(SIDEBAR_PREFERENCES_STORAGE_KEY) ?? '{}'
    ) as Partial<SidebarPreferences>;
    return {
      layoutMode: stored.layoutMode === 'list' ? 'list' : 'projects',
      sortMode: stored.sortMode === 'recent' || stored.sortMode === 'manual' ? stored.sortMode : 'priority',
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
};

export const useSidebarPreferences = () => {
  const [preferences, setPreferences] = useState<SidebarPreferences>(readSidebarPreferences);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Ignore storage failures; the in-memory preference still works for this session.
    }
  }, [preferences]);

  const setLayoutMode = useCallback((layoutMode: SidebarLayoutMode) => {
    setPreferences((current) => ({ ...current, layoutMode }));
  }, []);

  const setSortMode = useCallback((sortMode: SidebarSortMode) => {
    setPreferences((current) => ({ ...current, sortMode }));
  }, []);

  return {
    ...preferences,
    setLayoutMode,
    setSortMode,
  };
};
