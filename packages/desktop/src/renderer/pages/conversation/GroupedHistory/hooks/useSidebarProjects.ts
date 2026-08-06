/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getSidebarProjects, subscribeSidebarProjects } from '@/renderer/components/workspace';
import { useEffect, useState } from 'react';

export const useSidebarProjects = (): string[] => {
  const [projects, setProjects] = useState<string[]>(getSidebarProjects);

  useEffect(() => {
    const refresh = () => setProjects(getSidebarProjects());
    const unsubscribe = subscribeSidebarProjects(refresh);
    refresh();
    return unsubscribe;
  }, []);

  return projects;
};
