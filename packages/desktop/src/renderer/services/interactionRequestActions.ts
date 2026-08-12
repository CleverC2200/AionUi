import { ipcBridge } from '@/common';
import { InteractionRequestActions } from '@/common/adapter/interactionRequest';
import type { InteractionRequestReceipt } from '@/common/types/interactionRequest';

export const interactionRequestActions = new InteractionRequestActions({
  submit: (command) => ipcBridge.interactionRequest.act.invoke(command),
  refreshPending: () => ipcBridge.interactionRequest.list.invoke(),
});

export const requireAcceptedInteractionReceipt = (receipt: InteractionRequestReceipt): void => {
  if (receipt.status === 'accepted' || receipt.status === 'already_resolved') return;
  throw new Error(`INTERACTION_REQUEST_${receipt.status.toUpperCase()}`);
};
