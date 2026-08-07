/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  SIDEBAR_PREFERENCES_STORAGE_KEY,
  useSidebarPreferences,
} from '@/renderer/pages/conversation/GroupedHistory/hooks/useSidebarPreferences';

describe('useSidebarPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to project grouping and priority sorting', () => {
    const { result } = renderHook(() => useSidebarPreferences());

    expect(result.current.layoutMode).toBe('projects');
    expect(result.current.sortMode).toBe('priority');
  });

  it('restores and persists the selected layout and sorting modes', () => {
    localStorage.setItem(SIDEBAR_PREFERENCES_STORAGE_KEY, JSON.stringify({ layoutMode: 'list', sortMode: 'recent' }));
    const { result } = renderHook(() => useSidebarPreferences());

    expect(result.current.layoutMode).toBe('list');
    expect(result.current.sortMode).toBe('recent');

    act(() => {
      result.current.setLayoutMode('projects');
      result.current.setSortMode('manual');
    });

    expect(JSON.parse(localStorage.getItem(SIDEBAR_PREFERENCES_STORAGE_KEY) ?? '{}')).toEqual({
      layoutMode: 'projects',
      sortMode: 'manual',
    });
  });

  it('falls back safely when stored preferences are malformed', () => {
    localStorage.setItem(SIDEBAR_PREFERENCES_STORAGE_KEY, '{invalid-json');

    const { result } = renderHook(() => useSidebarPreferences());

    expect(result.current.layoutMode).toBe('projects');
    expect(result.current.sortMode).toBe('priority');
  });
});
