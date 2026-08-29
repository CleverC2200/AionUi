/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { app, type BrowserWindow } from 'electron';
import { ipcBridge } from '@/common';
import { getGeaEnvironment } from '@/process/services/gea/GeaEnvironmentService';
import {
  OPEN_CONVERSATION_ACTION,
  OPEN_CONVERSATION_SCHEMA_VERSION,
  isOpenConversationDeepLinkPayload,
  type DeepLinkPayload,
  type OpenConversationDeepLinkPayload,
} from '@/common/types/platform/deepLink';

export const PROTOCOL_SCHEME = 'aionui';
const MAX_DEEP_LINK_LENGTH = 2048;
const MAX_NAVIGATION_REFERENCE_LENGTH = 1024;
const PROFILE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const NAVIGATION_REFERENCE_PATTERN = /^[A-Za-z0-9._~-]{16,1024}$/;
const RESULT_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,80}$/;
const LEGACY_ACTIONS = new Set(['add-provider', 'provider/add', 'navigate']);

const hasInvalidPercentEncoding = (value: string): boolean => /%(?![0-9A-Fa-f]{2})/.test(value);

const parseOpenConversationDeepLink = (parsed: URL, rawUrl: string): OpenConversationDeepLinkPayload | null => {
  if (
    rawUrl.length > MAX_DEEP_LINK_LENGTH ||
    hasInvalidPercentEncoding(rawUrl) ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash ||
    parsed.pathname !== ''
  ) {
    return null;
  }

  const params = new Map<string, string>();
  for (const [key, value] of parsed.searchParams) {
    if (params.has(key) || !['ref', 'v', 'profile'].includes(key)) return null;
    params.set(key, value);
  }

  const navigationReference = params.get('ref');
  const version = params.get('v');
  const profile = params.get('profile');
  if (
    !navigationReference ||
    navigationReference.length > MAX_NAVIGATION_REFERENCE_LENGTH ||
    !NAVIGATION_REFERENCE_PATTERN.test(navigationReference) ||
    version !== String(OPEN_CONVERSATION_SCHEMA_VERSION) ||
    (profile !== undefined && !PROFILE_KEY_PATTERN.test(profile))
  ) {
    return null;
  }

  return {
    action: OPEN_CONVERSATION_ACTION,
    params: {
      ref: navigationReference,
      v: `${OPEN_CONVERSATION_SCHEMA_VERSION}`,
      ...(profile ? { profile } : {}),
    },
  };
};

/**
 * Parse an aionui:// URL into action and params.
 * Supports two formats:
 *   1. aionui://add-provider?base_url=xxx&api_key=xxx
 *   2. aionui://provider/add?v=1&data=<base64 JSON>  (one-api / new-api style)
 */
export const parseDeepLinkUrl = (url: string): DeepLinkPayload | null => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${PROTOCOL_SCHEME}:`) return null;

    const hostname = parsed.hostname || '';
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const action = pathname ? `${hostname}/${pathname}` : hostname;

    if (hostname === OPEN_CONVERSATION_ACTION) {
      if (pathname) return null;
      return parseOpenConversationDeepLink(parsed, url);
    }

    if (!LEGACY_ACTIONS.has(action)) return null;

    const params: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    // If data param exists, decode base64 JSON and merge into params
    if (params.data) {
      try {
        const json = JSON.parse(Buffer.from(params.data, 'base64').toString('utf-8'));
        if (json && typeof json === 'object') {
          Object.assign(params, json);
        }
      } catch {
        // Ignore decode errors
      }
      delete params.data;
    }

    return { action, params };
  } catch {
    return null;
  }
};

export const findInitialDeepLink = (
  argv: readonly string[]
): { payload: OpenConversationDeepLinkPayload | null; url: string | null } => {
  const url = argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`)) ?? null;
  if (!url) return { payload: null, url: null };
  const parsed = parseDeepLinkUrl(url);
  return { payload: parsed && isOpenConversationDeepLinkPayload(parsed) ? parsed : null, url };
};

const initialDeepLink = findInitialDeepLink(process.argv);
let mainWindowRef: BrowserWindow | null = null;
let pendingDeepLinkUrl: string | null = initialDeepLink.url;
let pendingOpenConversation: OpenConversationDeepLinkPayload | null = initialDeepLink.payload;

const getConfiguredProfileKey = (): string | null => {
  try {
    return getGeaEnvironment().environmentId;
  } catch {
    return null;
  }
};

const isConfiguredProfile = (payload: OpenConversationDeepLinkPayload): boolean | null => {
  if (!payload.params.profile) return true;
  const configuredProfileKey = getConfiguredProfileKey();
  return configuredProfileKey === null ? null : payload.params.profile === configuredProfileKey;
};

const logOpenConversation = (
  payload: OpenConversationDeepLinkPayload,
  stage: 'ingress' | 'resolve' | 'navigation',
  result: string
): void => {
  console.info('[DeepLink]', {
    reference_hash: createHash('sha256').update(payload.params.ref).digest('hex'),
    stage,
    platform: process.platform,
    client_version: app.getVersion(),
    schema_version: OPEN_CONVERSATION_SCHEMA_VERSION,
    result,
  });
};

export const setDeepLinkMainWindow = (win: BrowserWindow): void => {
  mainWindowRef = win;
};

export const getPendingDeepLinkUrl = (): string | null => pendingDeepLinkUrl;

export const clearPendingDeepLinkUrl = (): void => {
  pendingDeepLinkUrl = null;
};

export const claimPendingOpenConversation = (): OpenConversationDeepLinkPayload | null => {
  if (pendingOpenConversation && isConfiguredProfile(pendingOpenConversation) === false) {
    logOpenConversation(pendingOpenConversation, 'ingress', 'profile_mismatch');
    pendingOpenConversation = null;
  }
  return pendingOpenConversation;
};

export const acknowledgeOpenConversation = (navigationReference: string): boolean => {
  if (pendingOpenConversation?.params.ref !== navigationReference) return false;
  logOpenConversation(pendingOpenConversation, 'navigation', 'completed');
  pendingOpenConversation = null;
  return true;
};

export const reportOpenConversationFailure = (navigationReference: string, resultCode: string): boolean => {
  if (pendingOpenConversation?.params.ref !== navigationReference) return false;
  const result = RESULT_CODE_PATTERN.test(resultCode) ? resultCode : 'DEEP_LINK_RESOLVE_FAILED';
  logOpenConversation(pendingOpenConversation, 'resolve', result);
  return true;
};

/**
 * Send the deep-link payload to the renderer via IPC bridge.
 * If the window isn't ready yet, queue it.
 */
export const handleDeepLinkUrl = (url: string): void => {
  const parsed = parseDeepLinkUrl(url);
  if (!parsed) return;

  if (isOpenConversationDeepLinkPayload(parsed)) {
    if (isConfiguredProfile(parsed) === false) {
      if (pendingOpenConversation?.params.ref === parsed.params.ref) pendingOpenConversation = null;
      logOpenConversation(parsed, 'ingress', 'profile_mismatch');
      return;
    }
    pendingOpenConversation = parsed;
  }

  if (
    !mainWindowRef ||
    mainWindowRef.isDestroyed() ||
    mainWindowRef.webContents.isDestroyed() ||
    mainWindowRef.webContents.isLoadingMainFrame()
  ) {
    pendingDeepLinkUrl = url;
    if (isOpenConversationDeepLinkPayload(parsed)) logOpenConversation(parsed, 'ingress', 'queued');
    return;
  }

  ipcBridge.deepLink.received.emit(parsed);
  if (isOpenConversationDeepLinkPayload(parsed)) logOpenConversation(parsed, 'ingress', 'accepted');
};
