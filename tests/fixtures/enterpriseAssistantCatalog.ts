import type {
  EnterpriseAssistantCatalogResponse,
  EnterpriseAssistantCatalogSnapshot,
  EnterpriseAssistantExtensionRequest,
  EnterpriseAssistantExtensionResult,
} from '@/common/types/agent/enterpriseAssistantCatalog';

const createdAt = '2026-08-11T00:00:00.000Z';

const baseManifest = {
  template_id: 'finance-close-assistant',
  template_version: '1.0.0',
  identity: {
    name: { default: 'Finance Close', translations: { 'zh-CN': '财务关账助手' } },
    description: { default: 'Complete governed finance close work', translations: { 'zh-CN': '完成受控财务关账工作' } },
    avatar: 'https://assets.example.test/finance-close.png',
  },
  agent: { id: 'finance-close-agent', type: 'aionrs' },
  instructions: {
    context: 'Follow the governed finance close procedure.',
    recommended_prompts: ['Start monthly close'],
  },
  defaults: { model: 'enterprise/default', permission: 'controlled', thought_level: 'high' },
  required_capabilities: {
    skills: [{ id: 'finance-close', name: 'Finance Close', version: '1' }],
    mcps: [
      {
        id: 'finance-production',
        name: 'Finance Production',
        version: '1',
        auth_mode: 'enterprise_delegation' as const,
        production_write: true,
      },
    ],
  },
  user_extensions: { mode: 'additive' as const, allow_skills: true, allow_mcps: true },
};

const optionalAssignment = {
  assignment_id: 'assignment-finance-optional',
  assistant_id: 'enterprise-finance-close',
  activation: 'optional' as const,
  state: 'active' as const,
  minimum_client_version: '2.1.53',
  updated_at: createdAt,
  manifest: baseManifest,
};

const requiredAssignment = {
  ...optionalAssignment,
  assignment_id: 'assignment-finance-required',
  assistant_id: 'enterprise-finance-close-required',
  activation: 'required' as const,
};

export const enterpriseAssistantCatalogV1: EnterpriseAssistantCatalogSnapshot = {
  schema_version: 1,
  revision: 'catalog-r1',
  generated_at: createdAt,
  tenant_id: 'tenant-1',
  assignments: [optionalAssignment, requiredAssignment],
};

const catalogWith = (revision: string, assignment: typeof optionalAssignment): EnterpriseAssistantCatalogSnapshot => ({
  ...enterpriseAssistantCatalogV1,
  revision,
  assignments: [assignment],
});

const extensionRequest: EnterpriseAssistantExtensionRequest = {
  assignment_id: optionalAssignment.assignment_id,
  template_version: baseManifest.template_version,
  expected_revision: enterpriseAssistantCatalogV1.revision,
  idempotency_key: 'extension-request-1',
  skills: ['spreadsheet-helper'],
  mcps: ['local-files-readonly'],
};

export type EnterpriseAssistantFixtureScenario = {
  id: string;
  catalog_response?: EnterpriseAssistantCatalogResponse;
  extension_request?: EnterpriseAssistantExtensionRequest;
  extension_result?: EnterpriseAssistantExtensionResult;
  expected_state: string;
};

export const enterpriseAssistantFixtureScenarios: EnterpriseAssistantFixtureScenario[] = [
  {
    id: 'first-load',
    catalog_response: { status: 'ok', snapshot: enterpriseAssistantCatalogV1 },
    expected_state: 'fresh',
  },
  {
    id: 'empty-directory',
    catalog_response: {
      status: 'ok',
      snapshot: { ...enterpriseAssistantCatalogV1, revision: 'catalog-empty', assignments: [] },
    },
    expected_state: 'empty',
  },
  {
    id: 'optional-and-required',
    catalog_response: { status: 'ok', snapshot: enterpriseAssistantCatalogV1 },
    expected_state: 'mixed-activation',
  },
  {
    id: 'update-success',
    catalog_response: {
      status: 'ok',
      snapshot: catalogWith('catalog-r2', {
        ...optionalAssignment,
        updated_at: '2026-08-12T00:00:00.000Z',
        manifest: { ...baseManifest, template_version: '1.1.0' },
      }),
    },
    expected_state: 'updated',
  },
  {
    id: 'update-failure',
    catalog_response: {
      status: 'error',
      error: { code: 'GEA_CATALOG_UNAVAILABLE', category: 'retryable_read', retryable: true },
      last_good_revision: 'catalog-r1',
    },
    expected_state: 'last-good',
  },
  {
    id: 'missing-dependency',
    catalog_response: {
      status: 'ok',
      snapshot: catalogWith('catalog-missing-skill', {
        ...optionalAssignment,
        manifest: {
          ...baseManifest,
          required_capabilities: {
            ...baseManifest.required_capabilities,
            skills: [{ id: 'missing-skill' }],
          },
        },
      }),
    },
    expected_state: 'blocked-missing-dependency',
  },
  {
    id: 'mcp-auth-required',
    catalog_response: {
      status: 'ok',
      snapshot: catalogWith('catalog-mcp-auth', {
        ...optionalAssignment,
        manifest: {
          ...baseManifest,
          required_capabilities: {
            ...baseManifest.required_capabilities,
            mcps: [{ id: 'oauth-helper', auth_mode: 'user_oauth', production_write: false }],
          },
        },
      }),
    },
    expected_state: 'blocked-mcp-auth',
  },
  {
    id: 'extension-allowed',
    extension_request: extensionRequest,
    extension_result: {
      status: 'accepted',
      assignment_id: optionalAssignment.assignment_id,
      template_version: baseManifest.template_version,
      revision: 'extension-r1',
      skills: extensionRequest.skills,
      mcps: extensionRequest.mcps,
    },
    expected_state: 'extension-saved',
  },
  {
    id: 'extension-conflict',
    extension_request: extensionRequest,
    extension_result: {
      status: 'rejected',
      assignment_id: optionalAssignment.assignment_id,
      revision: 'catalog-r1',
      violations: [{ code: 'CAPABILITY_CONFLICT', capability_id: 'local-files-readonly' }],
    },
    expected_state: 'extension-conflict',
  },
  {
    id: 'extension-rejected',
    extension_request: extensionRequest,
    extension_result: {
      status: 'rejected',
      assignment_id: optionalAssignment.assignment_id,
      revision: 'catalog-r1',
      violations: [{ code: 'PERMISSION_EXPANSION', capability_id: 'admin-shell' }],
    },
    expected_state: 'extension-rejected',
  },
  {
    id: 'extension-survives-template-upgrade',
    catalog_response: {
      status: 'ok',
      snapshot: catalogWith('catalog-extension-r2', {
        ...optionalAssignment,
        manifest: { ...baseManifest, template_version: '1.1.0' },
        extensions: {
          revision: 'extension-r1',
          skills: ['spreadsheet-helper'],
          mcps: ['local-files-readonly'],
          status: 'active',
          violations: [],
        },
      }),
    },
    expected_state: 'extension-preserved',
  },
  {
    id: 'extension-needs-attention-after-upgrade',
    catalog_response: {
      status: 'ok',
      snapshot: catalogWith('catalog-extension-conflict-r2', {
        ...optionalAssignment,
        manifest: { ...baseManifest, template_version: '1.1.0' },
        extensions: {
          revision: 'extension-r1',
          skills: ['spreadsheet-helper'],
          mcps: ['local-files-readonly'],
          status: 'attention',
          violations: [{ code: 'CAPABILITY_CONFLICT', capability_id: 'local-files-readonly' }],
        },
      }),
    },
    expected_state: 'extension-attention',
  },
  {
    id: 'suspended',
    catalog_response: {
      status: 'ok',
      snapshot: catalogWith('catalog-suspended', {
        ...optionalAssignment,
        state: 'suspended',
        state_reason: 'Temporarily paused by enterprise administrator',
      }),
    },
    expected_state: 'suspended',
  },
  {
    id: 'withdrawn',
    catalog_response: {
      status: 'ok',
      snapshot: catalogWith('catalog-withdrawn', {
        ...optionalAssignment,
        state: 'withdrawn',
        state_reason: 'No longer assigned',
      }),
    },
    expected_state: 'withdrawn',
  },
  {
    id: 'offline-last-good',
    catalog_response: {
      status: 'error',
      error: { code: 'GEA_OFFLINE', category: 'retryable_read', retryable: true },
      last_good_revision: 'catalog-r1',
    },
    expected_state: 'offline-last-good',
  },
  {
    id: 'identity-policy-change',
    catalog_response: {
      status: 'ok',
      snapshot: catalogWith('catalog-policy-r2', {
        ...optionalAssignment,
        manifest: {
          ...baseManifest,
          template_version: '2.0.0',
          defaults: { ...baseManifest.defaults, permission: 'strict-controlled' },
        },
      }),
    },
    expected_state: 'policy-updated',
  },
  {
    id: 'client-too-old',
    catalog_response: {
      status: 'ok',
      snapshot: catalogWith('catalog-client-too-old', { ...optionalAssignment, minimum_client_version: '99.0.0' }),
    },
    expected_state: 'client-too-old',
  },
  {
    id: 'unknown-external-write',
    extension_request: extensionRequest,
    extension_result: {
      status: 'error',
      error: {
        code: 'GEA_EXTENSION_WRITE_UNKNOWN',
        category: 'unknown_external_write',
        retryable: false,
      },
    },
    expected_state: 'verification-required',
  },
];
