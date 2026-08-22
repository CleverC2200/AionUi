import type { NotificationTarget } from '@/common/types/notification';

export type NotificationNavigation = {
  pathname: string;
  state?: Record<string, string | undefined>;
};

const pathSegment = (value: string): string => encodeURIComponent(value);

export const resolveNotificationNavigation = (target: NotificationTarget): NotificationNavigation | null => {
  switch (target.type) {
    case 'notification':
      return null;
    case 'conversation':
      return target.conversationId ? { pathname: `/conversation/${pathSegment(target.conversationId)}` } : null;
    case 'message':
      return target.conversationId && target.messageId
        ? {
            pathname: `/conversation/${pathSegment(target.conversationId)}`,
            state: { targetMessageId: target.messageId },
          }
        : null;
    case 'team':
      return target.teamId ? { pathname: `/team/${pathSegment(target.teamId)}` } : null;
    case 'slot':
      return target.teamId && target.slotId
        ? { pathname: `/team/${pathSegment(target.teamId)}`, state: { targetSlotId: target.slotId } }
        : null;
    case 'interaction_request':
      if (target.teamId) {
        return {
          pathname: `/team/${pathSegment(target.teamId)}`,
          state: { targetSlotId: target.slotId, interactionRequestId: target.requestId },
        };
      }
      return target.conversationId
        ? {
            pathname: `/conversation/${pathSegment(target.conversationId)}`,
            state: { interactionRequestId: target.requestId },
          }
        : null;
  }
};
