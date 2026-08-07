/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { addRecentWorkspace, DEFAULT_RECENT_WS_KEY, getRecentWorkspaces } from '@/renderer/components/workspace';
import { beforeEach, describe, expect, it } from 'vitest';

describe('recent workspaces', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each(['{invalid-json', '{}', 'null'])('treats invalid storage %s as an empty list', (storedValue) => {
    localStorage.setItem(DEFAULT_RECENT_WS_KEY, storedValue);

    expect(getRecentWorkspaces()).toEqual([]);
  });

  it('keeps only string paths from stored arrays', () => {
    localStorage.setItem(DEFAULT_RECENT_WS_KEY, JSON.stringify(['/projects/aionui', null, 42, '/projects/other']));

    expect(getRecentWorkspaces()).toEqual(['/projects/aionui', '/projects/other']);
  });

  it('adds a workspace safely after non-array storage', () => {
    localStorage.setItem(DEFAULT_RECENT_WS_KEY, '{}');

    addRecentWorkspace('/projects/aionui');

    expect(getRecentWorkspaces()).toEqual(['/projects/aionui']);
  });

  it('moves a repeated workspace to the front and keeps at most five entries', () => {
    for (let index = 1; index <= 6; index += 1) {
      addRecentWorkspace(`/projects/project-${index}`);
    }
    addRecentWorkspace('/projects/project-3');

    expect(getRecentWorkspaces()).toEqual([
      '/projects/project-3',
      '/projects/project-6',
      '/projects/project-5',
      '/projects/project-4',
      '/projects/project-2',
    ]);
  });
});
