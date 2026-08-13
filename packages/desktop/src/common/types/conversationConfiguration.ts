import { findEnterpriseAssistantSensitiveFields } from './agent/enterpriseAssistantCatalog';
import { z } from 'zod';

const identifier = z.string().trim().min(1).max(240);
const uniqueIdentifiers = z.array(identifier).refine((items) => new Set(items).size === items.length, {
  message: 'identifiers must be unique',
});

export const ConversationConfigurationSnapshotSchema = z.object({
  schema_version: z.literal(1),
  snapshot_id: identifier,
  revision: identifier,
  prepared_at: z.string().datetime({ offset: true }),
  identity_revision: identifier,
  assistant: z.object({
    id: identifier,
    source: z.string(),
    assignment_id: identifier.optional(),
    template_id: identifier.optional(),
    template_version: z.string().optional(),
    catalog_revision: identifier.optional(),
    extension_revision: identifier.optional(),
  }),
  agent: z.object({
    id: identifier,
    type: identifier,
    backend: z.string().optional(),
  }),
  skills: z.array(
    z.object({
      id: identifier,
      version: z.string().optional(),
      source: z.enum(['assistant', 'enterprise_required', 'user_extension', 'user_override']),
    })
  ),
  mcps: z.array(
    z.object({
      id: identifier,
      version: z.string().optional(),
      source: z.enum(['assistant', 'enterprise_required', 'user_extension', 'user_override']),
      auth_status: z.enum(['ready', 'user_action', 'admin_action']),
    })
  ),
  policy: z.object({
    model: z.string().optional(),
    permission: z.string().optional(),
    thought_level: z.string().optional(),
  }),
});

export const ConversationPreparationRequestSchema = z.object({
  assistant: z.object({
    id: identifier,
    source: z.string(),
    assignment_id: identifier.optional(),
    template_version: z.string().optional(),
    catalog_revision: identifier.optional(),
    extension_revision: identifier.optional(),
  }),
  locale: z.string().optional(),
  idempotency_key: identifier,
  workspace: z.string().optional(),
  overrides: z.object({
    model: z.string().optional(),
    permission: z.string().optional(),
    thought_level: z.string().optional(),
    skill_ids: uniqueIdentifiers.optional(),
    disabled_builtin_skill_ids: uniqueIdentifiers.optional(),
    mcp_ids: uniqueIdentifiers.optional(),
  }),
});

export const ConversationPreparationIssueSchema = z.object({
  code: z.enum([
    'ASSIGNMENT_INACTIVE',
    'CLIENT_TOO_OLD',
    'EXTENSION_REJECTED',
    'IDENTITY_CHANGED',
    'MCP_AUTH_REQUIRED',
    'MISSING_SKILL',
    'OFFLINE_CACHE_EXPIRED',
    'POLICY_CHANGED',
    'STALE_REVISION',
  ]),
  capability_id: z.string().optional(),
  message: z.string().optional(),
  action: z
    .enum(['authenticate_mcp', 'contact_admin', 'reload', 'retry', 'sign_in', 'update_client', 'view_skills'])
    .optional(),
});

export const ConversationPreparationResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    preparation_id: identifier,
    revision: identifier,
    expires_at: z.string().datetime({ offset: true }),
    snapshot: ConversationConfigurationSnapshotSchema,
  }),
  z.object({
    status: z.literal('blocked'),
    revision: identifier.optional(),
    issues: z.array(ConversationPreparationIssueSchema).min(1),
  }),
]);

export type ConversationConfigurationSnapshot = z.infer<typeof ConversationConfigurationSnapshotSchema>;
export type ConversationPreparationRequest = z.infer<typeof ConversationPreparationRequestSchema>;
export type ConversationPreparationIssue = z.infer<typeof ConversationPreparationIssueSchema>;
export type ConversationPreparationResponse = z.infer<typeof ConversationPreparationResponseSchema>;

const parseGuarded = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const sensitiveFields = findEnterpriseAssistantSensitiveFields(value);
  if (sensitiveFields.length > 0)
    throw new Error(`CONVERSATION_CONFIGURATION_SENSITIVE_FIELD:${sensitiveFields.join(',')}`);
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error(`CONVERSATION_CONFIGURATION_INVALID:${result.error.issues[0]?.message ?? 'invalid'}`);
  return result.data;
};

export const parseConversationPreparationRequest = (value: unknown): ConversationPreparationRequest =>
  parseGuarded(ConversationPreparationRequestSchema, value);

export const parseConversationPreparationResponse = (value: unknown): ConversationPreparationResponse =>
  parseGuarded(ConversationPreparationResponseSchema, value);

export const parseConversationConfigurationSnapshot = (value: unknown): ConversationConfigurationSnapshot =>
  parseGuarded(ConversationConfigurationSnapshotSchema, value);
