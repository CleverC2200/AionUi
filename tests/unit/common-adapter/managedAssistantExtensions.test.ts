import {
  ManagedAssistantExtensions,
  projectEnterpriseAssistantAssignment,
  validateManagedAssistantExtensionDraft,
} from '@/common/adapter/assistant';
import {
  enterpriseAssistantCatalogV1,
  enterpriseAssistantFixtureScenarios,
} from '../../fixtures/enterpriseAssistantCatalog';
import { describe, expect, it, vi } from 'vitest';

const managedMetadata = () => {
  const assignment = enterpriseAssistantCatalogV1.assignments[0];
  if (!assignment) throw new Error('fixture assignment missing');
  const metadata = projectEnterpriseAssistantAssignment(
    assignment,
    enterpriseAssistantCatalogV1.revision,
    'en-US',
    0
  ).managed;
  if (!metadata) throw new Error('managed metadata missing');
  return metadata;
};

describe('ManagedAssistantExtensions', () => {
  it('sends only stable capability ids and concurrency fields', async () => {
    const accepted = enterpriseAssistantFixtureScenarios.find((item) => item.id === 'extension-allowed');
    const save = vi.fn().mockResolvedValue(accepted!.extension_result);
    const extensions = new ManagedAssistantExtensions({ save });

    await expect(
      extensions.save(
        'enterprise-finance-close',
        managedMetadata(),
        { skills: ['spreadsheet-helper'], mcps: ['local-files-readonly'] },
        'idempotency-1'
      )
    ).resolves.toMatchObject({ status: 'accepted', revision: 'extension-r1' });

    expect(save).toHaveBeenCalledWith({
      assistant_id: 'enterprise-finance-close',
      assignment_id: 'assignment-finance-optional',
      template_version: '1.0.0',
      expected_revision: 'catalog-r1',
      idempotency_key: 'idempotency-1',
      skills: ['spreadsheet-helper'],
      mcps: ['local-files-readonly'],
    });
    expect(JSON.stringify(save.mock.calls[0])).not.toMatch(/credential|password|secret|token/i);
  });

  it('rejects core capability overlap locally without a write', async () => {
    const save = vi.fn();
    const extensions = new ManagedAssistantExtensions({ save });
    const result = await extensions.save(
      'enterprise-finance-close',
      managedMetadata(),
      { skills: ['finance-close'], mcps: ['finance-production'] },
      'idempotency-2'
    );

    expect(result).toMatchObject({ status: 'rejected' });
    if (result.status === 'rejected') {
      expect(result.violations).toEqual(
        expect.arrayContaining([
          { code: 'CAPABILITY_CONFLICT', capability_id: 'finance-close' },
          { code: 'CAPABILITY_CONFLICT', capability_id: 'finance-production' },
        ])
      );
    }
    expect(save).not.toHaveBeenCalled();
  });

  it('enforces per-capability extension policy before calling the server', () => {
    const metadata = managedMetadata();
    metadata.user_extensions = { mode: 'additive', allow_skills: false, allow_mcps: false };
    expect(
      validateManagedAssistantExtensionDraft(metadata, {
        skills: ['spreadsheet-helper'],
        mcps: ['local-files-readonly'],
      })
    ).toEqual(expect.arrayContaining([{ code: 'SKILL_NOT_ALLOWED' }, { code: 'MCP_NOT_ALLOWED' }]));
  });

  it('preserves server rejection details for field-level feedback', async () => {
    const rejected = enterpriseAssistantFixtureScenarios.find((item) => item.id === 'extension-conflict');
    const extensions = new ManagedAssistantExtensions({ save: vi.fn().mockResolvedValue(rejected!.extension_result) });

    await expect(
      extensions.save(
        'enterprise-finance-close',
        managedMetadata(),
        { skills: ['spreadsheet-helper'], mcps: ['local-files-readonly'] },
        'idempotency-3'
      )
    ).resolves.toMatchObject({
      status: 'rejected',
      violations: [{ code: 'CAPABILITY_CONFLICT', capability_id: 'local-files-readonly' }],
    });
  });

  it('returns an unknown-write result without retrying automatically', async () => {
    const unknown = enterpriseAssistantFixtureScenarios.find((item) => item.id === 'unknown-external-write');
    const save = vi.fn().mockResolvedValue(unknown!.extension_result);
    const extensions = new ManagedAssistantExtensions({ save });

    await expect(
      extensions.save(
        'enterprise-finance-close',
        managedMetadata(),
        { skills: ['spreadsheet-helper'], mcps: [] },
        'idempotency-unknown'
      )
    ).resolves.toMatchObject({
      status: 'error',
      error: { category: 'unknown_external_write', retryable: false },
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('projects retained and attention extension states after template upgrades', () => {
    for (const scenarioId of ['extension-survives-template-upgrade', 'extension-needs-attention-after-upgrade']) {
      const scenario = enterpriseAssistantFixtureScenarios.find((item) => item.id === scenarioId);
      const response = scenario?.catalog_response;
      if (!response || response.status !== 'ok') throw new Error(`fixture missing: ${scenarioId}`);
      const assignment = response.snapshot.assignments[0];
      if (!assignment) throw new Error(`assignment missing: ${scenarioId}`);
      const projected = projectEnterpriseAssistantAssignment(assignment, response.snapshot.revision, 'en-US', 0);
      expect(projected.managed?.extensions.skill_ids).toEqual(['spreadsheet-helper']);
      expect(projected.managed?.extensions.mcp_ids).toEqual(['local-files-readonly']);
    }

    const attentionScenario = enterpriseAssistantFixtureScenarios.find(
      (item) => item.id === 'extension-needs-attention-after-upgrade'
    );
    const response = attentionScenario?.catalog_response;
    if (!response || response.status !== 'ok') throw new Error('attention fixture missing');
    expect(
      projectEnterpriseAssistantAssignment(response.snapshot.assignments[0]!, response.snapshot.revision, 'en-US', 0)
        .managed?.extensions
    ).toMatchObject({ status: 'attention', violations: [{ code: 'CAPABILITY_CONFLICT' }] });
  });
});
