import { findEnterpriseAssistantSensitiveFields } from './agent/enterpriseAssistantCatalog';
import { z } from 'zod';

const identifier = z.string().trim().min(1).max(240);
const resource = z.object({
  kind: z.enum(['file', 'url', 'image', 'table']),
  uri: z.string().trim().min(1),
  name: z.string().trim().min(1),
  mime_type: z.string().optional(),
});
const base = z.object({
  id: identifier,
  revision: z.number().int().positive(),
  conversation_id: identifier,
  turn_id: identifier.optional(),
  task_id: identifier.optional(),
  producer: z.object({ type: z.enum(['agent', 'team_agent', 'aioncore', 'business_system', 'user']), id: identifier }),
  created_at: z.string().datetime({ offset: true }),
});

export const ConversationRecordSchema = z.discriminatedUnion('record_type', [
  base.extend({ record_type: z.literal('context_evidence'), resource }),
  base.extend({ record_type: z.literal('output'), resource }),
  base.extend({
    record_type: z.literal('deliverable_revision'),
    deliverable_id: identifier,
    replaces_record_id: identifier.optional(),
    status: z.enum(['draft', 'ready', 'superseded', 'withdrawn']),
    resource,
  }),
  base.extend({
    record_type: z.literal('external_result'),
    system: identifier,
    outcome: z.enum(['success', 'failure', 'unknown']),
    reference: z.string().optional(),
    verification_record_id: identifier.optional(),
  }),
  base.extend({
    record_type: z.literal('verification_evidence'),
    outcome: z.enum(['pass', 'fail', 'inconclusive']),
    summary: z.string(),
    evidence_record_ids: z.array(identifier),
  }),
  base.extend({
    record_type: z.literal('completion_receipt'),
    definition: z.string().trim().min(1),
    owner: identifier,
    status: z.enum(['verified', 'failed']),
    evidence_record_ids: z.array(identifier).min(1),
  }),
]);

export const ConversationRecordSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  records: z.array(ConversationRecordSchema),
});

export const ConversationRecordEventSchema = z.discriminatedUnion('type', [
  z.object({
    sequence: z.number().int().positive(),
    conversation_id: identifier,
    type: z.literal('upsert'),
    record: ConversationRecordSchema,
  }),
  z.object({
    sequence: z.number().int().positive(),
    conversation_id: identifier,
    type: z.literal('remove'),
    record_id: identifier,
  }),
]);

export type ConversationRecord = z.infer<typeof ConversationRecordSchema>;
export type ConversationRecordSnapshot = z.infer<typeof ConversationRecordSnapshotSchema>;
export type ConversationRecordEvent = z.infer<typeof ConversationRecordEventSchema>;

const parseGuarded = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const sensitiveFields = findEnterpriseAssistantSensitiveFields(value);
  if (sensitiveFields.length > 0) throw new Error(`CONVERSATION_RECORD_SENSITIVE_FIELD:${sensitiveFields.join(',')}`);
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`CONVERSATION_RECORD_INVALID:${result.error.issues[0]?.message ?? 'invalid'}`);
  return result.data;
};

export const parseConversationRecordSnapshot = (value: unknown): ConversationRecordSnapshot =>
  parseGuarded(ConversationRecordSnapshotSchema, value);
export const parseConversationRecordEvent = (value: unknown): ConversationRecordEvent =>
  parseGuarded(ConversationRecordEventSchema, value);
