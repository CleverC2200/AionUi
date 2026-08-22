/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * System Notification Module
 *
 * Provides showNotification() for direct use in main process,
 * and registers an IPC provider so renderer can invoke it cross-process.
 */

import { getPlatformServices } from '@/common/platform';
import { ipcBridge } from '@/common';
import { electronNotification } from '@/common/electronSafe';
import { ProcessConfig } from '@process/utils/initStorage';
import type { BrowserWindow } from 'electron';
import type { NotificationTarget } from '@/common/types/notification';
import path from 'path';
import fs from 'fs';

// Main window reference, used to gate on focus and to focus + navigate on click.
let mainWindowRef: BrowserWindow | null = null;

export const setNotificationMainWindow = (win: BrowserWindow): void => {
  mainWindowRef = win;
};

/**
 * Get app icon path for notifications
 */
const getNotificationIcon = (): string | undefined => {
  try {
    const resourcesPath = getPlatformServices().paths.isPackaged()
      ? process.resourcesPath
      : path.join(process.cwd(), 'resources');
    const iconPath = path.join(resourcesPath, 'app.png');
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  } catch {
    // Ignore icon error, notification will still show
  }
  return undefined;
};

/**
 * Show a system notification.
 * Can be called directly from main process or via IPC from renderer.
 *
 * Skips when `system.notificationEnabled` is off, or when the main window is
 * already focused (no nagging). When a real Electron notification is available,
 * clicking it focuses the main window and emits `notification.clicked` so the
 * renderer can navigate to the originating conversation.
 *
 * In non-Electron mode this falls back to the platform service, which is a no-op.
 */
export async function showNotification({
  title,
  body,
  conversation_id,
  notification_id,
  notification_version,
  scope_id,
  target,
}: {
  title: string;
  body: string;
  conversation_id?: string;
  notification_id?: string;
  notification_version?: string;
  scope_id?: string;
  target?: NotificationTarget;
}): Promise<void> {
  const diagnostic = {
    notification_id: notification_id ?? '',
    notification_version: notification_version ?? '',
    target_type: target?.type ?? (conversation_id ? 'conversation' : 'notification'),
  };
  // Check if notification is enabled
  const notificationEnabled = await ProcessConfig.get('system.notificationEnabled');
  if (notificationEnabled === false) {
    console.log('[Notification] Skipped: notifications are disabled in settings');
    console.info('[Notification] native suppressed', { ...diagnostic, reason: 'settings_disabled' });
    return;
  }

  // Do not notify while the user is already looking at the app.
  if (mainWindowRef && !mainWindowRef.isDestroyed() && mainWindowRef.isFocused()) {
    console.log('[Notification] Skipped: main window is focused');
    console.info('[Notification] native suppressed', { ...diagnostic, reason: 'window_focused' });
    return;
  }

  const iconPath = getNotificationIcon();

  // Prefer a real Electron notification so the click can focus + navigate.
  if (electronNotification) {
    try {
      const notification = new electronNotification({ title, body, ...(iconPath ? { icon: iconPath } : {}) });
      notification.on('click', () => {
        console.info('[Notification] native clicked', diagnostic);
        const win = mainWindowRef;
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
        ipcBridge.notification.clicked.emit({
          ...(conversation_id ? { conversation_id } : {}),
          ...(notification_id ? { notification_id } : {}),
          ...(notification_version ? { notification_version } : {}),
          ...(scope_id ? { scope_id } : {}),
          ...(target ? { target } : {}),
        });
      });
      notification.show();
      console.info('[Notification] native displayed', diagnostic);
      console.log(`[Notification] show() called (isSupported=${electronNotification.isSupported()})`);
    } catch (error) {
      console.error('[Notification] Error creating notification:', error);
    }
    return;
  }

  // Non-Electron fallback (no-op in node mode).
  try {
    getPlatformServices().notification.send({ title, body, icon: iconPath });
  } catch (error) {
    console.error('[Notification] Error creating notification:', error);
  }
}

/**
 * Register IPC provider so renderer can trigger notifications cross-process.
 */
export function initNotificationBridge(): void {
  ipcBridge.notification.show.provider(async (options) => {
    await showNotification(options);
  });
}
