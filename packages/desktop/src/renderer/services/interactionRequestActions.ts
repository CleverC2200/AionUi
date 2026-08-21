import { ipcBridge } from '@/common';
import { InteractionRequestActions } from '@/common/adapter/interaction-request';
import type { InteractionRequestReceipt } from '@/common/types/interactionRequest';

export const INTERACTION_REQUESTS_ACTIVE_KEY = 'interaction-requests.active';
export const fetchActiveInteractionRequests = () => ipcBridge.interactionRequest.list.invoke();

export const interactionRequestActions = new InteractionRequestActions({
  submit: (command) => ipcBridge.interactionRequest.act.invoke(command),
  refreshPending: fetchActiveInteractionRequests,
  preflightActive: fetchActiveInteractionRequests,
});

export const requireAcceptedInteractionReceipt = (receipt: InteractionRequestReceipt): void => {
  if (receipt.status === 'accepted' || receipt.status === 'already_resolved') return;
  throw new Error(`INTERACTION_REQUEST_${receipt.status.toUpperCase()}`);
};
