import { findEnterpriseAssistantSensitiveFields } from './agent/enterpriseAssistantCatalog';
import { z } from 'zod';

const identifier = z.string().trim().min(1).max(240);
const timestamp = z.string().datetime({ offset: true });

export const NotificationTargetSchema = z
  .object({
    type: z.enum(['notification', 'conversation', 'message', 'team', 'slot', 'interaction_request']),
    conversationId: identifier.optional(),
    messageId: identifier.optional(),
    teamId: identifier.optional(),
    slotId: identifier.optional(),
    requestId: identifier.optional(),
  })
  .superRefine((target, context) => {
    const require = (field: keyof typeof target) => {
      if (!target[field]) context.addIssue({ code: 'custom', path: [field], message: `${String(field)} is required` });
    };
    if (target.type === 'conversation') require('conversationId');
    if (target.type === 'message') {
      require('conversationId');
      require('messageId');
    }
    if (target.type === 'team') require('teamId');
    if (target.type === 'slot') {
      require('teamId');
      require('slotId');
    }
    if (target.type === 'interaction_request') require('requestId');
  });

export const NotificationSchema = z.object({
  id: identifier,
  version: identifier,
  status: z.enum(['unread', 'read', 'dismissed']),
  kind: z.enum(['message', 'event', 'reminder', 'action_required', 'system']),
  severity: z.enum(['info', 'success', 'warning', 'critical']),
  title: z.string().trim().min(1).max(4000),
  summary: z.string().max(10_000).optional(),
  body: z.string().max(100_000).optional(),
  dismissible: z.boolean(),
  source: identifier,
  target: NotificationTargetSchema,
  interaction_request_id: identifier.optional(),
  created_at: timestamp,
  expires_at: timestamp.optional(),
});

export const NotificationListSchema = z.object({
  revision: z.string().max(240),
  items: z.array(NotificationSchema),
  sync_state: z.enum(['idle', 'syncing', 'fresh', 'stale', 'partial', 'failed']),
  last_synced_at: timestamp.optional(),
  failure_codes: z.array(identifier).default([]),
});

export const NotificationActionCommandSchema = z.object({
  expected_version: identifier,
  idempotency_key: identifier,
});

export const NotificationReceiptSchema = z.object({
  receipt_id: identifier,
  notification_id: identifier,
  version: identifier,
  status: z.enum(['unread', 'read', 'dismissed']),
  notification: NotificationSchema.optional(),
});

export const NotificationChangedPayloadSchema = z.object({
  revision: identifier,
  reason: z.enum(['snapshot', 'created', 'updated', 'read', 'dismissed', 'expired', 'recovered']),
  notification_id: identifier.optional(),
  trace_id: identifier.optional(),
});

export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;
export type NotificationItem = z.infer<typeof NotificationSchema>;
export type NotificationList = z.infer<typeof NotificationListSchema>;
export type NotificationActionCommand = z.infer<typeof NotificationActionCommandSchema>;
export type NotificationReceipt = z.infer<typeof NotificationReceiptSchema>;
export type NotificationChangedPayload = z.infer<typeof NotificationChangedPayloadSchema>;

const parseGuarded = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const sensitiveFields = findEnterpriseAssistantSensitiveFields(value);
  if (sensitiveFields.length > 0) throw new Error(`NOTIFICATION_SENSITIVE_FIELD:${sensitiveFields.join(',')}`);
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`NOTIFICATION_INVALID:${result.error.issues[0]?.message ?? 'invalid'}`);
  return result.data;
};

export const parseNotification = (value: unknown): NotificationItem => parseGuarded(NotificationSchema, value);

export const parseNotificationList = (value: unknown): NotificationList => {
  const parsed = parseGuarded(NotificationListSchema, value);
  if (new Set(parsed.items.map((item) => item.id)).size !== parsed.items.length) {
    throw new Error('NOTIFICATION_INVALID:duplicate notification id');
  }
  return parsed;
};

export const parseNotificationReceipt = (value: unknown): NotificationReceipt =>
  parseGuarded(NotificationReceiptSchema, value);
