/**
 * Versioned wire contract for the GEA managed-assistant catalog.
 *
 * This file is the executable source of truth shared by the client, fixtures,
 * and the future GEA implementation. Unknown fields are ignored for forward
 * compatibility; destructive changes require a new schema_version.
 */
import { z } from 'zod';

const identifier = z.string().trim().min(1).max(200);
const semanticVersion = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const uniqueIdentifiers = z.array(identifier).refine((items) => new Set(items).size === items.length, {
  message: 'identifiers must be unique',
});

export const EnterpriseAssistantLocalizedTextSchema = z.object({
  default: z.string(),
  translations: z.record(z.string()),
});

export const EnterpriseAssistantSkillRefSchema = z.object({
  id: identifier,
  name: z.string().optional(),
  version: z.string().optional(),
});

export const EnterpriseAssistantMcpRefSchema = z.object({
  id: identifier,
  name: z.string().optional(),
  version: z.string().optional(),
  auth_mode: z.enum(['none', 'local_secret', 'user_oauth', 'enterprise_delegation']),
  production_write: z.boolean(),
});

export const EnterpriseAssistantExtensionViolationSchema = z.object({
  code: z.enum([
    'EXTENSIONS_DISABLED',
    'SKILL_NOT_ALLOWED',
    'MCP_NOT_ALLOWED',
    'CAPABILITY_CONFLICT',
    'PERMISSION_EXPANSION',
    'BUSINESS_MCP_REPLACEMENT',
    'ASSIGNMENT_INACTIVE',
    'STALE_REVISION',
  ]),
  capability_id: z.string().optional(),
  message: z.string().optional(),
});

export const EnterpriseAssistantExtensionStateSchema = z.object({
  revision: identifier,
  skills: uniqueIdentifiers,
  mcps: uniqueIdentifiers,
  status: z.enum(['active', 'attention']),
  violations: z.array(EnterpriseAssistantExtensionViolationSchema),
});

export const EnterpriseAssistantManifestSchema = z.object({
  template_id: identifier,
  template_version: semanticVersion,
  identity: z.object({
    name: EnterpriseAssistantLocalizedTextSchema,
    description: EnterpriseAssistantLocalizedTextSchema,
    avatar: z.string().optional(),
  }),
  agent: z.object({
    id: identifier,
    type: identifier,
    acp_backend: z.string().optional(),
  }),
  instructions: z.object({
    context: z.string(),
    recommended_prompts: z.array(z.string()),
  }),
  defaults: z.object({
    model: z.string().optional(),
    permission: z.string().optional(),
    thought_level: z.string().optional(),
  }),
  required_capabilities: z.object({
    skills: z.array(EnterpriseAssistantSkillRefSchema),
    mcps: z.array(EnterpriseAssistantMcpRefSchema),
  }),
  user_extensions: z.object({
    mode: z.enum(['none', 'additive']),
    allow_skills: z.boolean(),
    allow_mcps: z.boolean(),
  }),
});

export const EnterpriseAssistantAssignmentSchema = z.object({
  assignment_id: identifier,
  assistant_id: identifier,
  activation: z.enum(['optional', 'required']),
  state: z.enum(['active', 'suspended', 'withdrawn']),
  state_reason: z.string().optional(),
  minimum_client_version: semanticVersion,
  updated_at: z.string().datetime({ offset: true }),
  manifest: EnterpriseAssistantManifestSchema,
  extensions: EnterpriseAssistantExtensionStateSchema.optional(),
});

export const EnterpriseAssistantCatalogSnapshotSchema = z.object({
  schema_version: z.literal(1),
  revision: identifier,
  generated_at: z.string().datetime({ offset: true }),
  tenant_id: identifier,
  assignments: z.array(EnterpriseAssistantAssignmentSchema),
});

export const EnterpriseAssistantErrorSchema = z
  .object({
    code: identifier,
    category: z.enum(['retryable_read', 'user_action', 'admin_action', 'unknown_external_write']),
    retryable: z.boolean(),
    message: z.string().optional(),
    details: z.record(z.unknown()).optional(),
  })
  .superRefine((error, context) => {
    if ((error.category === 'retryable_read') !== error.retryable) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'only retryable_read errors may be retried automatically',
        path: ['retryable'],
      });
    }
  });

export const EnterpriseAssistantCatalogResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), snapshot: EnterpriseAssistantCatalogSnapshotSchema }),
  z.object({ status: z.literal('not_modified'), revision: identifier }),
  z.object({
    status: z.literal('error'),
    error: EnterpriseAssistantErrorSchema,
    last_good_revision: identifier.optional(),
  }),
]);

export const EnterpriseAssistantExtensionRequestSchema = z.object({
  assignment_id: identifier,
  template_version: semanticVersion,
  expected_revision: identifier,
  idempotency_key: identifier,
  skills: uniqueIdentifiers,
  mcps: uniqueIdentifiers,
});

export const EnterpriseAssistantExtensionResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('accepted'),
    assignment_id: identifier,
    template_version: semanticVersion,
    revision: identifier,
    skills: uniqueIdentifiers,
    mcps: uniqueIdentifiers,
  }),
  z.object({
    status: z.literal('rejected'),
    assignment_id: identifier,
    revision: identifier,
    violations: z.array(EnterpriseAssistantExtensionViolationSchema).min(1),
  }),
  z.object({ status: z.literal('error'), error: EnterpriseAssistantErrorSchema }),
]);

export type EnterpriseAssistantManifest = z.infer<typeof EnterpriseAssistantManifestSchema>;
export type EnterpriseAssistantAssignment = z.infer<typeof EnterpriseAssistantAssignmentSchema>;
export type EnterpriseAssistantCatalogSnapshot = z.infer<typeof EnterpriseAssistantCatalogSnapshotSchema>;
export type EnterpriseAssistantCatalogResponse = z.infer<typeof EnterpriseAssistantCatalogResponseSchema>;
export type EnterpriseAssistantError = z.infer<typeof EnterpriseAssistantErrorSchema>;
export type EnterpriseAssistantExtensionState = z.infer<typeof EnterpriseAssistantExtensionStateSchema>;
export type EnterpriseAssistantExtensionViolation = z.infer<typeof EnterpriseAssistantExtensionViolationSchema>;
export type EnterpriseAssistantExtensionRequest = z.infer<typeof EnterpriseAssistantExtensionRequestSchema>;
export type EnterpriseAssistantExtensionResult = z.infer<typeof EnterpriseAssistantExtensionResultSchema>;

const SENSITIVE_FIELD = /(^|_)(access_key|api_key|authorization|cookie|password|secret|token)(_|$)/i;

export class EnterpriseAssistantContractError extends Error {
  constructor(
    readonly code: 'SENSITIVE_FIELD' | 'INVALID_RESPONSE',
    readonly details: string
  ) {
    super(`${code}: ${details}`);
    this.name = 'EnterpriseAssistantContractError';
  }
}

export function findEnterpriseAssistantSensitiveFields(value: unknown): string[] {
  const paths: string[] = [];
  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!current || typeof current !== 'object') return;
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      if (SENSITIVE_FIELD.test(key)) paths.push(childPath);
      visit(child, childPath);
    }
  };
  visit(value, '');
  return paths;
}

function parseWithSensitiveFieldGuard<T>(schema: z.ZodType<T>, value: unknown): T {
  const sensitiveFields = findEnterpriseAssistantSensitiveFields(value);
  if (sensitiveFields.length > 0) {
    throw new EnterpriseAssistantContractError('SENSITIVE_FIELD', sensitiveFields.join(', '));
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new EnterpriseAssistantContractError('INVALID_RESPONSE', result.error.issues[0]?.message ?? 'invalid');
  }
  return result.data;
}

export function parseEnterpriseAssistantCatalogResponse(value: unknown): EnterpriseAssistantCatalogResponse {
  return parseWithSensitiveFieldGuard(EnterpriseAssistantCatalogResponseSchema, value);
}

export function parseEnterpriseAssistantExtensionResult(value: unknown): EnterpriseAssistantExtensionResult {
  return parseWithSensitiveFieldGuard(EnterpriseAssistantExtensionResultSchema, value);
}

export function parseEnterpriseAssistantExtensionRequest(value: unknown): EnterpriseAssistantExtensionRequest {
  return parseWithSensitiveFieldGuard(EnterpriseAssistantExtensionRequestSchema, value);
}

export type EnterpriseAssistantTransitionIssue = {
  assignment_id?: string;
  code: 'ASSIGNMENT_RETARGETED' | 'REVISION_REUSED' | 'TEMPLATE_VERSION_REUSED';
};

/**
 * Validates immutable-template and monotonic-revision invariants between two
 * complete snapshots. The transport remains replace-by-snapshot; callers never
 * have to merge partial catalogs.
 */
export function validateEnterpriseAssistantCatalogTransition(
  previous: EnterpriseAssistantCatalogSnapshot,
  next: EnterpriseAssistantCatalogSnapshot
): EnterpriseAssistantTransitionIssue[] {
  const issues: EnterpriseAssistantTransitionIssue[] = [];
  if (previous.revision === next.revision && JSON.stringify(previous) !== JSON.stringify(next)) {
    issues.push({ code: 'REVISION_REUSED' });
  }

  const previousAssignments = new Map(previous.assignments.map((assignment) => [assignment.assignment_id, assignment]));
  for (const assignment of next.assignments) {
    const prior = previousAssignments.get(assignment.assignment_id);
    if (!prior) continue;
    if (prior.manifest.template_id !== assignment.manifest.template_id) {
      issues.push({ code: 'ASSIGNMENT_RETARGETED', assignment_id: assignment.assignment_id });
      continue;
    }
    if (
      prior.manifest.template_version === assignment.manifest.template_version &&
      JSON.stringify(prior.manifest) !== JSON.stringify(assignment.manifest)
    ) {
      issues.push({ code: 'TEMPLATE_VERSION_REUSED', assignment_id: assignment.assignment_id });
    }
  }
  return issues;
}
