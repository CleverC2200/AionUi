import {
  AssistantCatalog,
  createAionCoreAssistantCatalogAdapter,
  createEnterpriseAssistantFixtureAdapter,
} from '@/common/adapter/assistant';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import {
  enterpriseAssistantCatalogV1,
  enterpriseAssistantFixtureScenarios,
} from '../../fixtures/enterpriseAssistantCatalog';
import { describe, expect, it, vi } from 'vitest';

const standardAssistant = (id = 'builtin-writer'): Assistant => ({
  id,
  source: 'builtin',
  name: 'Writer',
  name_i18n: {},
  description_i18n: {},
  enabled: true,
  sort_order: 0,
  agent_id: 'writer-agent',
  enabled_skills: [],
  custom_skill_names: [],
  disabled_builtin_skills: [],
  context_i18n: {},
  prompts: [],
  prompts_i18n: {},
  models: [],
  agent_status: 'online',
  team_selectable: true,
  deletable: false,
});

describe('AssistantCatalog', () => {
  it('keeps the existing AionCore assistant list as standard mode', async () => {
    const load = vi.fn().mockResolvedValue([standardAssistant()]);
    const catalog = new AssistantCatalog(createAionCoreAssistantCatalogAdapter(load));

    await expect(catalog.load('en-US')).resolves.toMatchObject({
      mode: 'standard',
      sync_status: 'fresh',
      assistants: [{ id: 'builtin-writer', source: 'builtin' }],
    });
  });

  it('projects managed assignments and protects a required assistant', async () => {
    const catalog = new AssistantCatalog(
      createEnterpriseAssistantFixtureAdapter({ status: 'ok', snapshot: enterpriseAssistantCatalogV1 })
    );

    const view = await catalog.load('zh-CN');
    const required = view.assistants.find((assistant) => assistant.managed?.activation === 'required');

    expect(view.mode).toBe('managed');
    expect(view.revision).toBe('catalog-r1');
    expect(required).toMatchObject({
      source: 'managed',
      name: '财务关账助手',
      enabled: true,
      team_selectable: true,
      deletable: false,
    });
    expect(required?.managed?.required_mcp_ids).toEqual(['finance-production']);
  });

  it('keeps a stale last-good snapshot when a later refresh fails', async () => {
    const adapter: ConstructorParameters<typeof AssistantCatalog>[0] = {
      load: vi
        .fn()
        .mockResolvedValueOnce({ assistants: [standardAssistant()], mode: 'standard', sync_status: 'fresh' })
        .mockRejectedValueOnce(new Error('GEA_OFFLINE')),
    };
    const catalog = new AssistantCatalog(adapter);

    await catalog.load('en-US');
    await expect(catalog.load('en-US')).resolves.toMatchObject({
      sync_status: 'stale',
      error_code: 'GEA_OFFLINE',
      assistants: [{ id: 'builtin-writer' }],
    });
  });

  it('marks an offline managed last-good projection as stale', async () => {
    const scenario = enterpriseAssistantFixtureScenarios.find((item) => item.id === 'offline-last-good');
    const catalog = new AssistantCatalog(
      createEnterpriseAssistantFixtureAdapter(scenario!.catalog_response!, { lastGood: enterpriseAssistantCatalogV1 })
    );

    const view = await catalog.load('en-US');
    expect(view.sync_status).toBe('stale');
    expect(view.assistants.every((assistant) => assistant.managed?.sync_status === 'stale')).toBe(true);
  });

  it('rejects duplicate assistant ids before exposing the catalog', async () => {
    const catalog = new AssistantCatalog({
      load: async () => ({
        assistants: [standardAssistant('duplicate'), standardAssistant('duplicate')],
        mode: 'standard',
        sync_status: 'fresh',
      }),
    });

    await expect(catalog.load('en-US')).rejects.toThrow('ASSISTANT_CATALOG_DUPLICATE_ID:duplicate');
  });
});
