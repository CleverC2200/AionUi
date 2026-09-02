/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
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
const MAX_NAVIGATION_REFERENCE_LENGTH = 512;
const MAX_OPEN_CONVERSATION_QUEUE_SIZE = 16;
const OPEN_CONVERSATION_QUEUE_TTL_MS = 10 * 60 * 1000;
const PROFILE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const NAVIGATION_REFERENCE_PATTERN = /^[A-Za-z0-9._-]{1,512}$/;
const RESULT_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,80}$/;
const LEGACY_ACTIONS = new Set(['add-provider', 'provider/add', 'navigate']);
const TERMINAL_RESOLVE_RESULTS = new Set([
  'NAVIGATION_REFERENCE_DISABLED',
  'NAVIGATION_CONFIGURATION_INVALID',
  'NAVIGATION_REFERENCE_EXPIRED',
  'NAVIGATION_REFERENCE_REVOKED',
  'NAVIGATION_REFERENCE_FORBIDDEN',
  'NAVIGATION_REFERENCE_NOT_FOUND',
  'NAVIGATION_SCHEMA_UNSUPPORTED',
  'NAVIGATION_SOURCE_MISMATCH',
  'NAVIGATION_TARGET_UNAVAILABLE',
  'NAVIGATION_REQUEST_INVALID',
  'NAVIGATION_REQUEST_UNKNOWN_FIELD',
  'DEEP_LINK_AUTH_SESSION_CHANGED',
  'DEEP_LINK_ASSISTANT_MISMATCH',
  'DEEP_LINK_RESOLVE_INVALID',
  'DEEP_LINK_TARGET_NOT_FOUND',
  'DEEP_LINK_PROFILE_MISMATCH',
]);

type PendingOpenConversation = {
  claimed: boolean;
  dispatched: boolean;
  payload: OpenConversationDeepLinkPayload;
  receivedAt: number;
};

const hasInvalidPercentEncoding = (value: string): boolean => /%(?![0-9A-Fa-f]{2})/.test(value);

export const registerDefaultProtocolClient = (
  isDefaultApp = Boolean(process.defaultApp),
  platform = process.platform,
  execPath = process.execPath,
  appEntryPath = process.argv[1]
): boolean => {
  if (isDefaultApp) {
    // macOS registers the Electron bundle without retaining the development app entry argument.
    if (platform === 'darwin') return false;
    return app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, execPath, [path.resolve(appEntryPath)]);
  }
  return app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
};

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
let pendingOpenConversation: PendingOpenConversation | null = initialDeepLink.payload
  ? { claimed: false, dispatched: false, payload: initialDeepLink.payload, receivedAt: Date.now() }
  : null;
let queuedOpenConversations: PendingOpenConversation[] = [];

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

const clearPendingUrlForReference = (navigationReference: string): void => {
  if (!pendingDeepLinkUrl) return;
  const payload = parseDeepLinkUrl(pendingDeepLinkUrl);
  if (payload && isOpenConversationDeepLinkPayload(payload) && payload.params.ref === navigationReference) {
    pendingDeepLinkUrl = null;
  }
};

const canBroadcastToRenderer = (): boolean =>
  Boolean(
    mainWindowRef &&
    !mainWindowRef.isDestroyed() &&
    !mainWindowRef.webContents.isDestroyed() &&
    !mainWindowRef.webContents.isLoadingMainFrame()
  );

const isExpired = (pending: PendingOpenConversation): boolean =>
  Date.now() - pending.receivedAt >= OPEN_CONVERSATION_QUEUE_TTL_MS;

const pruneQueuedOpenConversations = (): void => {
  queuedOpenConversations = queuedOpenConversations.filter((pending) => {
    if (!isExpired(pending)) return true;
    logOpenConversation(pending.payload, 'ingress', 'expired');
    return false;
  });
};

const broadcastPendingOpenConversation = (): boolean => {
  if (pendingOpenConversation && isExpired(pendingOpenConversation)) {
    logOpenConversation(pendingOpenConversation.payload, 'ingress', 'expired');
    clearPendingUrlForReference(pendingOpenConversation.payload.params.ref);
    promoteQueuedOpenConversation();
  }
  if (
    !pendingOpenConversation ||
    pendingOpenConversation.dispatched ||
    isConfiguredProfile(pendingOpenConversation.payload) !== true ||
    !canBroadcastToRenderer()
  ) {
    return false;
  }
  pendingOpenConversation.dispatched = true;
  ipcBridge.deepLink.received.emit(pendingOpenConversation.payload);
  logOpenConversation(pendingOpenConversation.payload, 'ingress', 'accepted');
  return true;
};

const promoteQueuedOpenConversation = (): void => {
  pruneQueuedOpenConversations();
  pendingOpenConversation = queuedOpenConversations.shift() ?? null;
  broadcastPendingOpenConversation();
};

export const claimPendingOpenConversation = (): OpenConversationDeepLinkPayload | null => {
  if (pendingOpenConversation && isExpired(pendingOpenConversation)) {
    logOpenConversation(pendingOpenConversation.payload, 'ingress', 'expired');
    clearPendingUrlForReference(pendingOpenConversation.payload.params.ref);
    promoteQueuedOpenConversation();
  }
  const profileStatus = pendingOpenConversation ? isConfiguredProfile(pendingOpenConversation.payload) : true;
  if (pendingOpenConversation && profileStatus === false) {
    clearPendingUrlForReference(pendingOpenConversation.payload.params.ref);
    logOpenConversation(pendingOpenConversation.payload, 'ingress', 'profile_mismatch');
    promoteQueuedOpenConversation();
    return claimPendingOpenConversation();
  }
  if (profileStatus === null) return null;
  if (!pendingOpenConversation || pendingOpenConversation.claimed) return null;
  pendingOpenConversation.claimed = true;
  clearPendingUrlForReference(pendingOpenConversation.payload.params.ref);
  return pendingOpenConversation.payload;
};

export const acknowledgeOpenConversation = (navigationReference: string): boolean => {
  if (pendingOpenConversation?.payload.params.ref !== navigationReference) return false;
  logOpenConversation(pendingOpenConversation.payload, 'navigation', 'completed');
  promoteQueuedOpenConversation();
  return true;
};

export const reportOpenConversationFailure = (navigationReference: string, resultCode: string): boolean => {
  if (pendingOpenConversation?.payload.params.ref !== navigationReference) return false;
  const result = RESULT_CODE_PATTERN.test(resultCode) ? resultCode : 'DEEP_LINK_RESOLVE_FAILED';
  logOpenConversation(pendingOpenConversation.payload, 'resolve', result);
  if (TERMINAL_RESOLVE_RESULTS.has(result)) {
    promoteQueuedOpenConversation();
  } else {
    pendingOpenConversation.claimed = false;
    pendingOpenConversation.dispatched = false;
  }
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
    pruneQueuedOpenConversations();
    const profileStatus = isConfiguredProfile(parsed);
    if (profileStatus === false) {
      clearPendingUrlForReference(parsed.params.ref);
      if (pendingOpenConversation?.payload.params.ref === parsed.params.ref) promoteQueuedOpenConversation();
      logOpenConversation(parsed, 'ingress', 'profile_mismatch');
      return;
    }
    if (pendingOpenConversation?.payload.params.ref === parsed.params.ref) {
      broadcastPendingOpenConversation();
      return;
    }
    if (queuedOpenConversations.some((pending) => pending.payload.params.ref === parsed.params.ref)) {
      return;
    }
    if (pendingOpenConversation) {
      if (queuedOpenConversations.length + 1 >= MAX_OPEN_CONVERSATION_QUEUE_SIZE) {
        logOpenConversation(parsed, 'ingress', 'queue_full');
        return;
      }
      queuedOpenConversations.push({ claimed: false, dispatched: false, payload: parsed, receivedAt: Date.now() });
      logOpenConversation(parsed, 'ingress', 'queued');
      return;
    }
    pendingOpenConversation = { claimed: false, dispatched: false, payload: parsed, receivedAt: Date.now() };
    if (profileStatus === null) {
      pendingDeepLinkUrl = url;
      logOpenConversation(parsed, 'ingress', 'queued');
      return;
    }
  }

  if (!canBroadcastToRenderer()) {
    pendingDeepLinkUrl = url;
    if (isOpenConversationDeepLinkPayload(parsed)) logOpenConversation(parsed, 'ingress', 'queued');
    return;
  }

  if (isOpenConversationDeepLinkPayload(parsed)) {
    broadcastPendingOpenConversation();
  } else {
    ipcBridge.deepLink.received.emit(parsed);
  }
};
