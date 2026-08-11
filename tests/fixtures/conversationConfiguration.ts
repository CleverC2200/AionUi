import type {
  ConversationConfigurationSnapshot,
  ConversationPreparationResponse,
} from '@/common/types/conversationConfiguration';

export const managedConversationSnapshot: ConversationConfigurationSnapshot = {
  schema_version: 1,
  snapshot_id: 'snapshot-1',
  revision: 'configuration-r1',
  prepared_at: '2026-08-11T00:00:00.000Z',
  identity_revision: 'identity-r1',
  assistant: {
    id: 'enterprise-finance',
    source: 'managed',
    assignment_id: 'assignment-finance',
    template_id: 'finance-close',
    template_version: '1.0.0',
    catalog_revision: 'catalog-r1',
    extension_revision: 'extension-r1',
  },
  agent: { id: 'finance-agent', type: 'aionrs' },
  skills: [
    { id: 'finance-close', version: '1', source: 'enterprise_required' },
    { id: 'spreadsheet-helper', source: 'user_extension' },
  ],
  mcps: [
    {
      id: 'finance-production',
      version: '1',
      source: 'enterprise_required',
      auth_status: 'ready',
    },
  ],
  policy: { model: 'enterprise/default', permission: 'controlled', thought_level: 'high' },
};

export const managedConversationReady: ConversationPreparationResponse = {
  status: 'ready',
  preparation_id: 'preparation-1',
  revision: 'preparation-r1',
  expires_at: '2026-08-11T00:05:00.000Z',
  snapshot: managedConversationSnapshot,
};

export const managedConversationBlocked: ConversationPreparationResponse = {
  status: 'blocked',
  revision: 'catalog-r2',
  issues: [{ code: 'MCP_AUTH_REQUIRED', capability_id: 'finance-production', action: 'authenticate_mcp' }],
};
