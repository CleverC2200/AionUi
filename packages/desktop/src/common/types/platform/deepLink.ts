/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

export const OPEN_CONVERSATION_ACTION = 'open-conversation';
export const OPEN_CONVERSATION_SCHEMA_VERSION = 1 as const;

const identifier = z.string().trim().min(1).max(240);
const localConversationIdentity = {
  conversation_id: identifier,
  assistant_id: identifier,
};

export const DeepLinkConversationTargetSchema = z
  .object({
    type: z.literal('conversation'),
    ...localConversationIdentity,
  })
  .strict();

export const DeepLinkMessageTargetSchema = z
  .object({
    type: z.literal('message'),
    ...localConversationIdentity,
    message_id: identifier,
  })
  .strict();

export const DeepLinkInteractionRequestTargetSchema = z
  .object({
    type: z.literal('interaction_request'),
    ...localConversationIdentity,
    interaction_request_id: identifier,
    message_id: identifier,
    team_id: identifier.optional(),
    slot_id: identifier.optional(),
  })
  .strict();

export const DeepLinkTeamTargetSchema = z.object({ type: z.literal('team'), team_id: identifier }).strict();

export const DeepLinkSlotTargetSchema = z
  .object({
    type: z.literal('slot'),
    team_id: identifier,
    slot_id: identifier,
    ...localConversationIdentity,
  })
  .strict();

export const DeepLinkTargetSchema = z
  .discriminatedUnion('type', [
    DeepLinkConversationTargetSchema,
    DeepLinkMessageTargetSchema,
    DeepLinkInteractionRequestTargetSchema,
    DeepLinkTeamTargetSchema,
    DeepLinkSlotTargetSchema,
  ])
  .superRefine((target, context) => {
    if (target.type === 'interaction_request' && Boolean(target.team_id) !== Boolean(target.slot_id)) {
      context.addIssue({ code: 'custom', message: 'team_id and slot_id must be provided together' });
    }
  });

export const DeepLinkResolveResponseSchema = z
  .object({
    schema_version: z.literal(OPEN_CONVERSATION_SCHEMA_VERSION),
    target: DeepLinkTargetSchema,
    trace_id: identifier.optional(),
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
    /^[A-Za-z0-9._~-]{16,1024}$/.test(payload.params.ref ?? '') &&
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
