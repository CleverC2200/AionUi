/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { addRecentWorkspace } from '@/renderer/components/workspace';
import { useSidebarProjects } from '@/renderer/pages/conversation/GroupedHistory/hooks/useSidebarProjects';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

describe('useSidebarProjects', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reacts when another workspace selector adds a project', () => {
    const { result } = renderHook(() => useSidebarProjects());

    act(() => {
      addRecentWorkspace('/projects/from-guid');
    });

    expect(result.current).toEqual(['/projects/from-guid']);
  });
});
