/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_RECENT_WS_KEY = 'aionui:recent-workspaces';
export const SIDEBAR_PROJECTS_STORAGE_KEY = 'aionui:sidebar-projects';
const MAX_RECENT_WORKSPACES = 5;
const SIDEBAR_PROJECTS_CHANGED_EVENT = 'aionui:sidebar-projects-changed';

const readPathList = (storageKey: string): string[] | null => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

export const getRecentWorkspaces = (storageKey: string = DEFAULT_RECENT_WS_KEY): string[] => {
  return readPathList(storageKey) ?? [];
};

export const getSidebarProjects = (): string[] => {
  return readPathList(SIDEBAR_PROJECTS_STORAGE_KEY) ?? getRecentWorkspaces();
};

const writeSidebarProjects = (projects: string[]): void => {
  try {
    localStorage.setItem(SIDEBAR_PROJECTS_STORAGE_KEY, JSON.stringify(projects));
    window.dispatchEvent(new Event(SIDEBAR_PROJECTS_CHANGED_EVENT));
  } catch {}
};

export const addSidebarProject = (path: string): void => {
  const previous = getSidebarProjects();
  writeSidebarProjects([path, ...previous.filter((item) => item !== path)]);
};

export const removeSidebarProject = (path: string): void => {
  writeSidebarProjects(getSidebarProjects().filter((item) => item !== path));
};

export const subscribeSidebarProjects = (listener: () => void): (() => void) => {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === SIDEBAR_PROJECTS_STORAGE_KEY) listener();
  };
  window.addEventListener(SIDEBAR_PROJECTS_CHANGED_EVENT, listener);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(SIDEBAR_PROJECTS_CHANGED_EVENT, listener);
    window.removeEventListener('storage', handleStorage);
  };
};

export const addRecentWorkspace = (path: string, storageKey: string = DEFAULT_RECENT_WS_KEY): void => {
  try {
    const prev = getRecentWorkspaces(storageKey);
    const next = [path, ...prev.filter((item) => item !== path)].slice(0, MAX_RECENT_WORKSPACES);
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {}

  if (storageKey === DEFAULT_RECENT_WS_KEY) {
    addSidebarProject(path);
  }
};
