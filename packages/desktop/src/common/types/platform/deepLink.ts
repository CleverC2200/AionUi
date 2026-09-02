/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

export const OPEN_CONVERSATION_ACTION = 'open-conversation';
export const OPEN_CONVERSATION_SCHEMA_VERSION = 1 as const;

const identifier = z.string().trim().min(1).max(240);
export const DeepLinkConversationTargetSchema = z
  .object({
    type: z.literal('conversation'),
    conversation_id: identifier,
  })
  .strict();

export const DeepLinkTargetSchema = DeepLinkConversationTargetSchema;

export const DeepLinkResolveResponseSchema = z
  .object({
    navigation_intent_id: identifier,
    schema_version: z.literal(OPEN_CONVERSATION_SCHEMA_VERSION),
    target: DeepLinkConversationTargetSchema,
    expires_at: z.string().datetime({ offset: true }),
    trace_id: identifier,
  })
  .strict();

export type DeepLinkPayload = {
  action: string;
  params: Record<string, string>;
};

export type OpenConversationDeepLinkPayload = DeepLinkPayload & {
  action: typeof OPEN_CONVERSATION_ACTION;
  params: {
    ref: string;
    v: `${typeof OPEN_CONVERSATION_SCHEMA_VERSION}`;
    profile?: string;
  };
};

export type DeepLinkResolveRequest = {
  navigation_reference: string;
  schema_version: typeof OPEN_CONVERSATION_SCHEMA_VERSION;
};

export type DeepLinkAcknowledgeRequest = {
  navigation_intent_id: string;
  idempotency_key: string;
};

export type DeepLinkFailureReport = {
  navigation_reference: string;
  result_code: string;
};

export type DeepLinkResolveResponse = z.infer<typeof DeepLinkResolveResponseSchema>;
export type DeepLinkTarget = z.infer<typeof DeepLinkTargetSchema>;

export const isOpenConversationDeepLinkPayload = (
  payload: DeepLinkPayload
): payload is OpenConversationDeepLinkPayload => {
  const keys = Object.keys(payload.params);
  const profile = payload.params.profile;
  return (
    payload.action === OPEN_CONVERSATION_ACTION &&
    keys.every((key) => key === 'ref' || key === 'v' || key === 'profile') &&
    /^[A-Za-z0-9._-]{1,512}$/.test(payload.params.ref ?? '') &&
    payload.params.v === String(OPEN_CONVERSATION_SCHEMA_VERSION) &&
    (profile === undefined || /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile))
  );
};

export const parseDeepLinkResolveResponse = (value: unknown): DeepLinkResolveResponse => {
  const result = DeepLinkResolveResponseSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`DEEP_LINK_RESOLVE_INVALID:${result.error.issues[0]?.message ?? 'invalid'}`);
  }
  return result.data;
};
