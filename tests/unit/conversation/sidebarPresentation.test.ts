/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  resolveSidebarRevealSection,
  shouldShowSidebarEmptyState,
} from '@/renderer/pages/conversation/GroupedHistory/utils/sidebarPresentation';
import { describe, expect, it } from 'vitest';

describe('resolveSidebarRevealSection', () => {
  it('reveals the projects section for standalone conversations in list mode', () => {
    expect(resolveSidebarRevealSection('conversations', 'list')).toBe('projects');
    expect(resolveSidebarRevealSection('conversations', 'projects')).toBe('conversations');
    expect(resolveSidebarRevealSection('pinned', 'list')).toBe('pinned');
  });
});

describe('shouldShowSidebarEmptyState', () => {
  it('does not show the global empty state beside a visible empty project', () => {
    expect(
      shouldShowSidebarEmptyState({
        layoutMode: 'projects',
        pinnedCount: 0,
        projectCount: 1,
        projectConversationCount: 0,
        standaloneCount: 0,
      })
    ).toBe(false);
  });

  it('shows the global empty state when list mode has no visible chats', () => {
    expect(
      shouldShowSidebarEmptyState({
        layoutMode: 'list',
        pinnedCount: 0,
        projectCount: 1,
        projectConversationCount: 0,
        standaloneCount: 0,
      })
    ).toBe(true);
  });
});
