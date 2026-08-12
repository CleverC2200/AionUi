import type { InteractionRequestActionCommand, InteractionRequestReceipt } from '../../types/interactionRequest';
import {
  parseInteractionRequestActionCommand,
  parseInteractionRequestList,
  parseInteractionRequestReceipt,
} from '../../types/interactionRequest';

export type InteractionRequestActionAdapter = {
  submit: (command: InteractionRequestActionCommand) => Promise<unknown>;
  refreshPending?: () => Promise<unknown>;
};

type PendingAction = {
  idempotencyKey: string;
  promise?: Promise<InteractionRequestReceipt>;
  terminal?: InteractionRequestReceipt;
};

export class InteractionRequestActions {
  private readonly actions = new Map<string, PendingAction>();

  constructor(private readonly adapter: InteractionRequestActionAdapter) {}

  private async reconcile(receipt: InteractionRequestReceipt): Promise<InteractionRequestReceipt> {
    if (
      receipt.request ||
      !['conflict', 'expired', 'forbidden'].includes(receipt.status) ||
      !this.adapter.refreshPending
    ) {
      return receipt;
    }
    try {
      const pending = parseInteractionRequestList(await this.adapter.refreshPending());
      const request = pending.items.find((item) => item.id === receipt.request_id);
      return request ? { ...receipt, request } : receipt;
    } catch {
      // Preserve the authoritative action receipt. The renderer still locks the
      // stale card; reconnect/changed events will retry the pending snapshot.
      return receipt;
    }
  }

  submit(input: Omit<InteractionRequestActionCommand, 'idempotency_key'>): Promise<InteractionRequestReceipt> {
    const key = `${input.request_id}:${input.expected_version}:${input.action_id}`;
    const current = this.actions.get(key) ?? { idempotencyKey: `interaction:${key}` };
    if (current.terminal) return Promise.resolve(current.terminal);
    if (current.promise) return current.promise;

    const command = parseInteractionRequestActionCommand({ ...input, idempotency_key: current.idempotencyKey });
    current.promise = this.adapter
      .submit(command)
      .then(parseInteractionRequestReceipt)
      .then((receipt) => this.reconcile(receipt))
      .then((receipt) => {
        // A receipt is authoritative for this exact request/version/action
        // attempt. Cache every outcome so a stale card cannot submit the same
        // command again; conflict receipts may carry a newer request version,
        // which the renderer can use for a distinct follow-up command.
        current.terminal = receipt;
        return receipt;
      })
      .finally(() => {
        current.promise = undefined;
      });
    this.actions.set(key, current);
    return current.promise;
  }
}
