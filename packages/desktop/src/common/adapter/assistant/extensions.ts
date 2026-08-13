import type { ManagedAssistantMetadata } from '../../types/agent/assistantTypes';
import type {
  EnterpriseAssistantExtensionRequest,
  EnterpriseAssistantExtensionResult,
  EnterpriseAssistantExtensionViolation,
} from '../../types/agent/enterpriseAssistantCatalog';
import {
  parseEnterpriseAssistantExtensionRequest,
  parseEnterpriseAssistantExtensionResult,
} from '../../types/agent/enterpriseAssistantCatalog';

export type ManagedAssistantExtensionDraft = {
  skills: string[];
  mcps: string[];
};

export type ManagedAssistantExtensionSaveParams = EnterpriseAssistantExtensionRequest & {
  assistant_id: string;
};

export type ManagedAssistantExtensionAdapter = {
  save: (request: ManagedAssistantExtensionSaveParams) => Promise<unknown>;
};

export const managedAssistantExtensionDraft = (metadata: ManagedAssistantMetadata): ManagedAssistantExtensionDraft => ({
  skills: [...metadata.extensions.skill_ids],
  mcps: [...metadata.extensions.mcp_ids],
});

export function validateManagedAssistantExtensionDraft(
  metadata: ManagedAssistantMetadata,
  draft: ManagedAssistantExtensionDraft
): EnterpriseAssistantExtensionViolation[] {
  const violations: EnterpriseAssistantExtensionViolation[] = [];
  if (metadata.state !== 'active') violations.push({ code: 'ASSIGNMENT_INACTIVE' });
  if (metadata.user_extensions.mode !== 'additive') violations.push({ code: 'EXTENSIONS_DISABLED' });
  if (!metadata.user_extensions.allow_skills && draft.skills.length > 0) {
    violations.push({ code: 'SKILL_NOT_ALLOWED' });
  }
  if (!metadata.user_extensions.allow_mcps && draft.mcps.length > 0) {
    violations.push({ code: 'MCP_NOT_ALLOWED' });
  }

  const requiredCapabilities = new Set([...metadata.required_skill_ids, ...metadata.required_mcp_ids]);
  for (const capabilityId of [...draft.skills, ...draft.mcps]) {
    if (requiredCapabilities.has(capabilityId)) {
      violations.push({ code: 'CAPABILITY_CONFLICT', capability_id: capabilityId });
    }
  }
  return violations;
}

/**
 * Owns the complete managed-extension save protocol: local policy checks,
 * request shaping, response validation, and identity consistency. Callers
 * never send profile fields, prompts, credentials, or enterprise defaults.
 */
export class ManagedAssistantExtensions {
  constructor(private readonly adapter: ManagedAssistantExtensionAdapter) {}

  async save(
    assistantId: string,
    metadata: ManagedAssistantMetadata,
    draft: ManagedAssistantExtensionDraft,
    idempotencyKey: string
  ): Promise<EnterpriseAssistantExtensionResult> {
    const violations = validateManagedAssistantExtensionDraft(metadata, draft);
    if (violations.length > 0) {
      return {
        status: 'rejected',
        assignment_id: metadata.assignment_id,
        revision: metadata.catalog_revision,
        violations,
      };
    }

    const request = parseEnterpriseAssistantExtensionRequest({
      assignment_id: metadata.assignment_id,
      template_version: metadata.template_version,
      expected_revision: metadata.catalog_revision,
      idempotency_key: idempotencyKey,
      skills: [...new Set(draft.skills)],
      mcps: [...new Set(draft.mcps)],
    });
    const result = parseEnterpriseAssistantExtensionResult(
      await this.adapter.save({ assistant_id: assistantId, ...request })
    );
    if ('assignment_id' in result && result.assignment_id !== metadata.assignment_id) {
      throw new Error('ASSISTANT_EXTENSION_ASSIGNMENT_MISMATCH');
    }
    return result;
  }
}

export function createAionCoreManagedAssistantExtensionAdapter(
  save: (request: ManagedAssistantExtensionSaveParams) => Promise<unknown>
): ManagedAssistantExtensionAdapter {
  return { save };
}
