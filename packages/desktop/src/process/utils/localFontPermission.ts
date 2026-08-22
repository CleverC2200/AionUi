/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebContents } from 'electron';

type PermissionRequestDetails = {
  isMainFrame: boolean;
  requestingUrl: string;
};

type PermissionWebContents = Pick<WebContents, 'getURL'>;

/**
 * Electron 37 reports Local Font Access as `unknown`. Keep Electron's existing
 * default-grant behaviour for named permissions while limiting that unknown
 * request to the current top-level app renderer.
 */
export const shouldGrantPermissionRequest = (
  webContents: PermissionWebContents,
  mainWebContents: PermissionWebContents | undefined,
  permission: string,
  details: PermissionRequestDetails
): boolean => {
  if (permission !== 'unknown') return true;
  return webContents === mainWebContents && details.isMainFrame && details.requestingUrl === webContents.getURL();
};
