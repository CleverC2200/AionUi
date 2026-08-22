import { resolveNotificationNavigation } from '@/renderer/services/notificationNavigation';
import { describe, expect, it } from 'vitest';

describe('resolveNotificationNavigation', () => {
  it('maps typed targets without accepting arbitrary URLs', () => {
    expect(resolveNotificationNavigation({ type: 'conversation', conversationId: 'c1' })).toEqual({
      pathname: '/conversation/c1',
    });
    expect(resolveNotificationNavigation({ type: 'message', conversationId: 'c1', messageId: 'm1' })).toEqual({
      pathname: '/conversation/c1',
      state: { targetMessageId: 'm1' },
    });
    expect(resolveNotificationNavigation({ type: 'slot', teamId: 't1', slotId: 's1' })).toEqual({
      pathname: '/team/t1',
      state: { targetSlotId: 's1' },
    });
  });

  it('keeps notification-only targets inside the inbox', () => {
    expect(resolveNotificationNavigation({ type: 'notification' })).toBeNull();
  });

  it('keeps external identifiers inside one route segment', () => {
    expect(
      resolveNotificationNavigation({ type: 'conversation', conversationId: '../../settings?danger=true' })
    ).toEqual({ pathname: '/conversation/..%2F..%2Fsettings%3Fdanger%3Dtrue' });
  });
});
