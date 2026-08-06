/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SidebarLayoutMode } from './sidebarSorting';

export type SidebarSection = 'pinned' | 'projects' | 'conversations';

export const resolveSidebarRevealSection = (section: SidebarSection, layoutMode: SidebarLayoutMode): SidebarSection => {
  return layoutMode === 'list' && section === 'conversations' ? 'projects' : section;
};

type SidebarEmptyStateInput = {
  layoutMode: SidebarLayoutMode;
  pinnedCount: number;
  projectCount: number;
  projectConversationCount: number;
  standaloneCount: number;
};

export const shouldShowSidebarEmptyState = ({
  layoutMode,
  pinnedCount,
  projectCount,
  projectConversationCount,
  standaloneCount,
}: SidebarEmptyStateInput): boolean => {
  if (pinnedCount + projectConversationCount + standaloneCount > 0) return false;
  return layoutMode === 'list' || projectCount === 0;
};
