import type { Assistant } from '../../types/agent/assistantTypes';
import type {
  EnterpriseAssistantAssignment,
  EnterpriseAssistantCatalogResponse,
  EnterpriseAssistantCatalogSnapshot,
} from '../../types/agent/enterpriseAssistantCatalog';
import { parseEnterpriseAssistantCatalogResponse } from '../../types/agent/enterpriseAssistantCatalog';

export type AssistantCatalogSyncStatus = 'error' | 'fresh' | 'stale';

export type AssistantCatalogView = {
  assistants: Assistant[];
  mode: 'managed' | 'standard';
  sync_status: AssistantCatalogSyncStatus;
  revision?: string;
  error_code?: string;
};

export type AssistantCatalogAdapter = {
  load: (locale: string) => Promise<AssistantCatalogView>;
};

const catalogMode = (assistants: readonly Assistant[]): AssistantCatalogView['mode'] =>
  assistants.some((assistant) => assistant.source === 'managed') ? 'managed' : 'standard';

const normalizeAssistant = (assistant: Assistant): Assistant => {
  if (assistant.source !== 'managed' || !assistant.managed) return assistant;
  const available = assistant.managed.state === 'active' && assistant.managed.sync_status !== 'blocked';
  return {
    ...assistant,
    deletable: false,
    enabled: available && (assistant.managed.activation === 'required' ? true : assistant.enabled),
    team_selectable: available && assistant.team_selectable,
  };
};

function normalizeAssistantList(assistants: Assistant[]): Assistant[] {
  const ids = new Set<string>();
  return assistants.map((assistant) => {
    if (ids.has(assistant.id)) throw new Error(`ASSISTANT_CATALOG_DUPLICATE_ID:${assistant.id}`);
    ids.add(assistant.id);
    return normalizeAssistant(assistant);
  });
}

/**
 * Deep catalog module. Callers learn one load interface; adapter errors,
 * normalization, managed/standard mode, and in-memory last-good behavior stay
 * behind it. AionCore remains the production authority.
 */
export class AssistantCatalog {
  private lastGood: AssistantCatalogView | null = null;

  constructor(private readonly adapter: AssistantCatalogAdapter) {}

  async load(locale: string): Promise<AssistantCatalogView> {
    try {
      const loaded = await this.adapter.load(locale);
      const assistants = normalizeAssistantList(loaded.assistants);
      const view = { ...loaded, assistants, mode: catalogMode(assistants) };
      if (view.sync_status === 'fresh') this.lastGood = view;
      return view;
    } catch (error) {
      if (!this.lastGood) throw error;
      return {
        ...this.lastGood,
        assistants: this.lastGood.assistants.map((assistant) =>
          assistant.source === 'managed' && assistant.managed
            ? { ...assistant, managed: { ...assistant.managed, sync_status: 'stale' } }
            : assistant
        ),
        sync_status: 'stale',
        error_code: error instanceof Error ? error.message : 'ASSISTANT_CATALOG_LOAD_FAILED',
      };
    }
  }
}

export function createAionCoreAssistantCatalogAdapter(
  loadAssistants: () => Promise<Assistant[]>
): AssistantCatalogAdapter {
  return {
    load: async () => {
      const assistants = await loadAssistants();
      const revisions = new Set(
        assistants.flatMap((assistant) =>
          assistant.managed?.catalog_revision ? [assistant.managed.catalog_revision] : []
        )
      );
      if (revisions.size > 1) throw new Error('ASSISTANT_CATALOG_MIXED_REVISIONS');
      return {
        assistants,
        mode: catalogMode(assistants),
        sync_status: 'fresh',
        ...(revisions.size === 1 ? { revision: [...revisions][0] } : {}),
      };
    },
  };
}

const localized = (value: { default?: string; translations?: Record<string, string> }, locale: string): string =>
  value.translations?.[locale] || value.default || '';

export function projectEnterpriseAssistantAssignment(
  assignment: EnterpriseAssistantAssignment,
  catalogRevision: string,
  locale: string,
  sortOrder: number
): Assistant {
  const manifest = assignment.manifest;
  const active = assignment.state === 'active';
  const name = localized(manifest.identity.name, locale);
  const description = localized(manifest.identity.description, locale);
  return {
    id: assignment.assistant_id,
    source: 'managed',
    name,
    name_i18n: manifest.identity.name.translations ?? {},
    description,
    description_i18n: manifest.identity.description.translations ?? {},
    avatar: manifest.identity.avatar,
    enabled: active,
    sort_order: sortOrder,
    agent_id: manifest.agent.id,
    agent: {
      type: manifest.agent.type,
      source: 'internal',
      acp_backend: manifest.agent.acp_backend,
    },
    enabled_skills: manifest.required_capabilities.skills.map((skill) => skill.id),
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context: manifest.instructions.context,
    context_i18n: {},
    prompts: manifest.instructions.recommended_prompts,
    prompts_i18n: {},
    models: manifest.defaults.model ? [manifest.defaults.model] : [],
    agent_status: active ? 'unchecked' : 'offline',
    agent_status_message: assignment.state_reason,
    team_selectable: active,
    team_block_reason: active ? undefined : assignment.state_reason,
    deletable: false,
    managed: {
      assignment_id: assignment.assignment_id,
      template_id: manifest.template_id,
      template_version: manifest.template_version,
      catalog_revision: catalogRevision,
      activation: assignment.activation,
      state: assignment.state,
      state_reason: assignment.state_reason,
      minimum_client_version: assignment.minimum_client_version,
      sync_status: 'fresh',
      required_skill_ids: manifest.required_capabilities.skills.map((skill) => skill.id),
      required_mcp_ids: manifest.required_capabilities.mcps.map((mcp) => mcp.id),
      user_extensions: {
        mode: manifest.user_extensions.mode ?? 'none',
        allow_skills: manifest.user_extensions.allow_skills ?? false,
        allow_mcps: manifest.user_extensions.allow_mcps ?? false,
      },
      extensions: {
        revision: assignment.extensions?.revision ?? catalogRevision,
        skill_ids: assignment.extensions?.skills ?? [],
        mcp_ids: assignment.extensions?.mcps ?? [],
        status: assignment.extensions?.status ?? 'active',
        violations: assignment.extensions?.violations ?? [],
      },
    },
  };
}

function projectEnterpriseAssistantSnapshot(snapshot: EnterpriseAssistantCatalogSnapshot, locale: string): Assistant[] {
  return snapshot.assignments.map((assignment, index) =>
    projectEnterpriseAssistantAssignment(assignment, snapshot.revision, locale, index)
  );
}

export function createEnterpriseAssistantFixtureAdapter(
  responseValue: EnterpriseAssistantCatalogResponse,
  options: { lastGood?: EnterpriseAssistantCatalogSnapshot } = {}
): AssistantCatalogAdapter {
  return {
    load: async (locale) => {
      const response = parseEnterpriseAssistantCatalogResponse(responseValue);
      if (response.status === 'ok') {
        return {
          assistants: projectEnterpriseAssistantSnapshot(response.snapshot, locale),
          mode: response.snapshot.assignments.length > 0 ? 'managed' : 'standard',
          sync_status: 'fresh',
          revision: response.snapshot.revision,
        };
      }
      if (response.status === 'not_modified' && options.lastGood) {
        return {
          assistants: projectEnterpriseAssistantSnapshot(options.lastGood, locale),
          mode: options.lastGood.assignments.length > 0 ? 'managed' : 'standard',
          sync_status: 'fresh',
          revision: response.revision,
        };
      }
      if (
        response.status === 'error' &&
        options.lastGood &&
        response.last_good_revision === options.lastGood.revision
      ) {
        const assistants = projectEnterpriseAssistantSnapshot(options.lastGood, locale);
        for (const assistant of assistants) {
          if (assistant.managed) assistant.managed.sync_status = 'stale';
        }
        return {
          assistants,
          mode: 'managed',
          sync_status: 'stale',
          revision: options.lastGood.revision,
          error_code: response.error.code,
        };
      }
      throw new Error(response.status === 'error' ? response.error.code : 'ASSISTANT_CATALOG_LAST_GOOD_MISSING');
    },
  };
}
