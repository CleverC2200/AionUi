/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import i18n from '@process/services/i18n';
import type { MenuItemConstructorOptions } from 'electron';
import { Menu, app } from 'electron';

export function setupApplicationMenu(): void {
  const isMac = process.platform === 'darwin';
  const productName = i18n.t('common.appName');
  app.setAboutPanelOptions({ applicationName: productName });

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: productName,
      submenu: [
        { role: 'about', label: i18n.t('common.appMenu.about', { appName: productName }) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: i18n.t('common.appMenu.hide', { appName: productName }) },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: i18n.t('common.appMenu.quit', { appName: productName }) },
      ],
    });
  }

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? ([{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }] as MenuItemConstructorOptions[])
        : ([{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }] as MenuItemConstructorOptions[])),
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });

  template.push({
    label: 'Help',
    submenu: [
      {
        label: 'Check for Updates...',
        click: () => {
          ipcBridge.update.open.emit({ source: 'menu' });
        },
      },
    ],
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
