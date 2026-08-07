/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_RECENT_WS_KEY = 'aionui:recent-workspaces';
const MAX_RECENT_WORKSPACES = 5;

const readPathList = (storageKey: string): string[] => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

export const getRecentWorkspaces = (storageKey: string = DEFAULT_RECENT_WS_KEY): string[] => {
  return readPathList(storageKey);
};

export const addRecentWorkspace = (path: string, storageKey: string = DEFAULT_RECENT_WS_KEY): void => {
  try {
    const prev = getRecentWorkspaces(storageKey);
    const next = [path, ...prev.filter((item) => item !== path)].slice(0, MAX_RECENT_WORKSPACES);
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {}
};
