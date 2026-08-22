import type { NotificationActionCommand, NotificationReceipt } from '../../types/notification';
import { parseNotificationReceipt } from '../../types/notification';
import { isBackendHttpError } from '../httpBridge';

export type NotificationAction = 'read' | 'dismiss';

export type NotificationActionAdapter = {
  submit: (action: NotificationAction, notificationId: string, command: NotificationActionCommand) => Promise<unknown>;
  refresh: (scopeId: string) => Promise<unknown>;
};

export class NotificationActions {
  private readonly pending = new Map<string, Promise<NotificationReceipt>>();

  constructor(private readonly adapter: NotificationActionAdapter) {}

  submit(input: {
    scopeId: string;
    action: NotificationAction;
    notificationId: string;
    expectedVersion: string;
  }): Promise<NotificationReceipt> {
    const intentKey = `${input.notificationId}:${input.expectedVersion}:${input.action}`;
    const key = `${input.scopeId}\0${intentKey}`;
    const running = this.pending.get(key);
    if (running) return running;

    const command: NotificationActionCommand = {
      expected_version: input.expectedVersion,
      idempotency_key: `notification:${intentKey}`,
    };
    const promise = this.adapter
      .submit(input.action, input.notificationId, command)
      .then(parseNotificationReceipt)
      .then(async (receipt) => {
        await this.adapter.refresh(input.scopeId);
        return receipt;
      })
      .catch(async (error: unknown) => {
        if (isBackendHttpError(error) && error.status === 409) {
          await this.adapter.refresh(input.scopeId);
        }
        throw error;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}
