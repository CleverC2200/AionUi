import type { Assistant } from '../../types/agent/assistantTypes';
import type {
  ConversationConfigurationSnapshot,
  ConversationPreparationIssue,
  ConversationPreparationRequest,
} from '../../types/conversationConfiguration';
import {
  parseConversationPreparationRequest,
  parseConversationPreparationResponse,
} from '../../types/conversationConfiguration';

export type ConversationPreparationAdapter = {
  prepare: (request: ConversationPreparationRequest) => Promise<unknown>;
};

export type ConversationPreparationInput = {
  assistant: Pick<Assistant, 'id' | 'managed' | 'source'>;
  locale?: string;
  idempotencyKey: string;
  workspace?: string;
  overrides: ConversationPreparationRequest['overrides'];
};

export type ConversationPreparationResult =
  | {
      status: 'ready';
      mode: 'managed';
      preparation: { id: string; revision: string };
      snapshot: ConversationConfigurationSnapshot;
      expires_at: string;
    }
  | { status: 'ready'; mode: 'standard'; preparation: null; snapshot: null }
  | {
      status: 'blocked';
      issues: ConversationPreparationIssue[];
      last_good_snapshot?: ConversationConfigurationSnapshot;
    }
  | { status: 'cancelled' };

/**
 * Coordinates prepare results without owning business policy. AionCore resolves
 * dependencies and publishes the immutable snapshot; this module only shapes
 * requests, rejects stale races, and retains last-good evidence for display.
 */
export class ConversationPreparation {
  private generation = 0;
  private lastGoodSnapshot: ConversationConfigurationSnapshot | null = null;

  constructor(private readonly adapter: ConversationPreparationAdapter) {}

  cancel(): void {
    this.generation += 1;
  }

  async prepare(input: ConversationPreparationInput): Promise<ConversationPreparationResult> {
    const currentGeneration = ++this.generation;
    if (input.assistant.source !== 'managed') {
      return currentGeneration === this.generation
        ? { status: 'ready', mode: 'standard', preparation: null, snapshot: null }
        : { status: 'cancelled' };
    }

    const managed = input.assistant.managed;
    if (!managed) {
      return { status: 'blocked', issues: [{ code: 'STALE_REVISION', action: 'reload' }] };
    }
    const request = parseConversationPreparationRequest({
      assistant: {
        id: input.assistant.id,
        source: input.assistant.source,
        assignment_id: managed.assignment_id,
        template_version: managed.template_version,
        catalog_revision: managed.catalog_revision,
        extension_revision: managed.extensions.revision,
      },
      locale: input.locale,
      idempotency_key: input.idempotencyKey,
      workspace: input.workspace,
      overrides: input.overrides,
    });
    const response = parseConversationPreparationResponse(await this.adapter.prepare(request));
    if (currentGeneration !== this.generation) return { status: 'cancelled' };
    if (response.status === 'blocked') {
      return {
        status: 'blocked',
        issues: response.issues,
        ...(this.lastGoodSnapshot ? { last_good_snapshot: this.lastGoodSnapshot } : {}),
      };
    }

    this.lastGoodSnapshot = response.snapshot;
    return {
      status: 'ready',
      mode: 'managed',
      preparation: { id: response.preparation_id, revision: response.revision },
      snapshot: response.snapshot,
      expires_at: response.expires_at,
    };
  }
}

export const createAionCoreConversationPreparationAdapter = (
  prepare: (request: ConversationPreparationRequest) => Promise<unknown>
): ConversationPreparationAdapter => ({ prepare });
