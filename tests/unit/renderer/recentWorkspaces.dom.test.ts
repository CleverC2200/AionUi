/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  addRecentWorkspace,
  addSidebarProject,
  DEFAULT_RECENT_WS_KEY,
  getSidebarProjects,
  getRecentWorkspaces,
  removeSidebarProject,
  SIDEBAR_PROJECTS_STORAGE_KEY,
} from '@/renderer/components/workspace';
import { beforeEach, describe, expect, it } from 'vitest';

describe('recent workspaces', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps a newly added empty project until it is explicitly removed', () => {
    addRecentWorkspace('/projects/aionui');

    expect(getRecentWorkspaces()).toEqual(['/projects/aionui']);
    expect(getSidebarProjects()).toEqual(['/projects/aionui']);

    removeSidebarProject('/projects/aionui');

    expect(getSidebarProjects()).toEqual([]);
    expect(getRecentWorkspaces()).toEqual(['/projects/aionui']);
    expect(localStorage.getItem(SIDEBAR_PROJECTS_STORAGE_KEY)).toBe('[]');
  });

  it('removes only the selected project', () => {
    addSidebarProject('/projects/first');
    addSidebarProject('/projects/second');

    removeSidebarProject('/projects/first');

    expect(getSidebarProjects()).toEqual(['/projects/second']);
  });

  it('keeps every explicit project when recent workspace history reaches its limit', () => {
    for (let index = 1; index <= 6; index += 1) {
      addRecentWorkspace(`/projects/project-${index}`);
    }

    expect(getRecentWorkspaces()).toHaveLength(5);
    expect(getSidebarProjects()).toEqual([
      '/projects/project-6',
      '/projects/project-5',
      '/projects/project-4',
      '/projects/project-3',
      '/projects/project-2',
      '/projects/project-1',
    ]);
  });

  it('uses existing recent workspaces as the initial project migration source', () => {
    localStorage.setItem(DEFAULT_RECENT_WS_KEY, JSON.stringify(['/projects/legacy']));

    expect(getSidebarProjects()).toEqual(['/projects/legacy']);
  });
});
