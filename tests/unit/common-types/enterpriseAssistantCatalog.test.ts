import { describe, expect, it } from 'vitest';
import {
  EnterpriseAssistantContractError,
  findEnterpriseAssistantSensitiveFields,
  parseEnterpriseAssistantCatalogResponse,
  parseEnterpriseAssistantExtensionRequest,
  parseEnterpriseAssistantExtensionResult,
  validateEnterpriseAssistantCatalogTransition,
} from '@/common/types/agent/enterpriseAssistantCatalog';
import {
  enterpriseAssistantCatalogV1,
  enterpriseAssistantFixtureScenarios,
} from '../../fixtures/enterpriseAssistantCatalog';

describe('enterprise assistant catalog contract', () => {
  it('parses every executable catalog and extension fixture', () => {
    for (const scenario of enterpriseAssistantFixtureScenarios) {
      if (scenario.catalog_response) {
        expect(() => parseEnterpriseAssistantCatalogResponse(scenario.catalog_response), scenario.id).not.toThrow();
      }
      if (scenario.extension_result) {
        expect(() => parseEnterpriseAssistantExtensionResult(scenario.extension_result), scenario.id).not.toThrow();
      }
    }
  });

  it('covers the complete client acceptance state set', () => {
    expect(enterpriseAssistantFixtureScenarios.map((scenario) => scenario.id).toSorted()).toEqual(
      [
        'client-too-old',
        'empty-directory',
        'extension-allowed',
        'extension-conflict',
        'extension-needs-attention-after-upgrade',
        'extension-rejected',
        'extension-survives-template-upgrade',
        'first-load',
        'identity-policy-change',
        'mcp-auth-required',
        'missing-dependency',
        'offline-last-good',
        'optional-and-required',
        'suspended',
        'unknown-external-write',
        'update-failure',
        'update-success',
        'withdrawn',
      ].toSorted()
    );
  });

  it('rejects secret material before unknown fields can be stripped', () => {
    const unsafe = {
      status: 'ok',
      access_token: 'must-not-cross-the-catalog-seam',
      snapshot: enterpriseAssistantCatalogV1,
    };
    expect(findEnterpriseAssistantSensitiveFields(unsafe)).toEqual(['access_token']);
    expect(() => parseEnterpriseAssistantCatalogResponse(unsafe)).toThrowError(EnterpriseAssistantContractError);
    expect(() =>
      parseEnterpriseAssistantExtensionRequest({
        assignment_id: 'assignment-1',
        template_version: '1.0.0',
        expected_revision: 'catalog-r1',
        idempotency_key: 'request-1',
        skills: [],
        mcps: [],
        api_token: 'must-not-sync',
      })
    ).toThrowError(EnterpriseAssistantContractError);
  });

  it('ignores harmless unknown fields for forward compatibility', () => {
    const parsed = parseEnterpriseAssistantCatalogResponse({
      status: 'ok',
      future_envelope_field: true,
      snapshot: { ...enterpriseAssistantCatalogV1, future_snapshot_field: true },
    });
    expect(parsed.status).toBe('ok');
    if (parsed.status === 'ok') {
      expect(parsed.snapshot).not.toHaveProperty('future_snapshot_field');
    }
    expect(parsed).not.toHaveProperty('future_envelope_field');
  });

  it('allows automatic retry only for read failures', () => {
    expect(() =>
      parseEnterpriseAssistantCatalogResponse({
        status: 'error',
        error: { code: 'BAD_POLICY', category: 'admin_action', retryable: true },
      })
    ).toThrowError(/only retryable_read/);
  });

  it('detects reused revisions, retargeted assignments, and mutated template versions', () => {
    const original = enterpriseAssistantCatalogV1;
    const assignment = original.assignments[0];
    expect(assignment).toBeDefined();
    if (!assignment) return;

    const reusedRevision = {
      ...original,
      generated_at: '2026-08-12T00:00:00.000Z',
    };
    const retargeted = {
      ...original,
      revision: 'catalog-r2',
      assignments: [{ ...assignment, manifest: { ...assignment.manifest, template_id: 'another-template' } }],
    };
    const mutatedVersion = {
      ...original,
      revision: 'catalog-r3',
      assignments: [
        {
          ...assignment,
          manifest: {
            ...assignment.manifest,
            defaults: { ...assignment.manifest.defaults, permission: 'changed-without-version' },
          },
        },
      ],
    };

    expect(validateEnterpriseAssistantCatalogTransition(original, reusedRevision)).toContainEqual({
      code: 'REVISION_REUSED',
    });
    expect(validateEnterpriseAssistantCatalogTransition(original, retargeted)).toContainEqual({
      code: 'ASSIGNMENT_RETARGETED',
      assignment_id: assignment.assignment_id,
    });
    expect(validateEnterpriseAssistantCatalogTransition(original, mutatedVersion)).toContainEqual({
      code: 'TEMPLATE_VERSION_REUSED',
      assignment_id: assignment.assignment_id,
    });
  });
});
