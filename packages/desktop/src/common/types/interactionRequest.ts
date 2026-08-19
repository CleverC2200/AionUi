import { findEnterpriseAssistantSensitiveFields } from './agent/enterpriseAssistantCatalog';
import { z } from 'zod';

const identifier = z.string().trim().min(1).max(240);

export const InteractionRequestSchema = z.object({
  id: identifier,
  version: identifier,
  kind: z.enum(['question', 'permission', 'approval']),
  status: z.enum(['pending', 'resolved', 'expired', 'cancelled', 'verification_required']),
  title: z.string().trim().min(1),
  summary: z.string().optional(),
  source: z.object({
    type: z.enum(['agent', 'team_agent', 'aioncore', 'business_system']),
    label: z.string().optional(),
  }),
  conversation_id: identifier,
  team_id: identifier.optional(),
  slot_id: identifier.optional(),
  turn_id: identifier.optional(),
  message_id: identifier.optional(),
  expires_at: z.string().datetime({ offset: true }).optional(),
  allowed_actions: z.array(identifier),
  updated_at: z.string().datetime({ offset: true }),
});

export const InteractionRequestListSchema = z.object({
  revision: identifier,
  items: z.array(InteractionRequestSchema),
});

export const InteractionRequestActionCommandSchema = z.object({
  request_id: identifier,
  expected_version: identifier,
  idempotency_key: identifier,
  action_id: identifier,
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const InteractionRequestReceiptSchema = z.object({
  receipt_id: identifier,
  request_id: identifier,
  version: identifier,
  status: z.enum(['accepted', 'already_resolved', 'conflict', 'expired', 'forbidden', 'cancelled', 'unknown_external_write']),
  resolved_at: z.string().datetime({ offset: true }).optional(),
  resolved_by: z.string().optional(),
  request: InteractionRequestSchema.optional(),
});

export type InteractionRequest = z.infer<typeof InteractionRequestSchema>;
export type InteractionRequestList = z.infer<typeof InteractionRequestListSchema>;
export type InteractionRequestActionCommand = z.infer<typeof InteractionRequestActionCommandSchema>;
export type InteractionRequestReceipt = z.infer<typeof InteractionRequestReceiptSchema>;

const parseGuarded = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const sensitiveFields = findEnterpriseAssistantSensitiveFields(value);
  if (sensitiveFields.length > 0) throw new Error(`INTERACTION_REQUEST_SENSITIVE_FIELD:${sensitiveFields.join(',')}`);
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`INTERACTION_REQUEST_INVALID:${result.error.issues[0]?.message ?? 'invalid'}`);
  return result.data;
};

export const parseInteractionRequestList = (value: unknown): InteractionRequestList => {
  const parsed = parseGuarded(InteractionRequestListSchema, value);
  if (new Set(parsed.items.map((item) => item.id)).size !== parsed.items.length) {
    throw new Error('INTERACTION_REQUEST_INVALID:duplicate request id');
  }
  return parsed;
};

export const parseInteractionRequestActionCommand = (value: unknown): InteractionRequestActionCommand =>
  parseGuarded(InteractionRequestActionCommandSchema, value);

export const parseInteractionRequestReceipt = (value: unknown): InteractionRequestReceipt =>
  parseGuarded(InteractionRequestReceiptSchema, value);
