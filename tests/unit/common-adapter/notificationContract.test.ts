import { parseNotificationList, parseNotificationReceipt } from '@/common/types/notification';
import { describe, expect, it } from 'vitest';

const item = {
  id: 'notification-1',
  version: 'v1',
  status: 'unread',
  kind: 'event',
  severity: 'warning',
  title: 'Forecast needs review',
  dismissible: true,
  source: 'gea.workflow',
  target: { type: 'conversation', conversationId: 'conversation-1' },
  created_at: '2026-08-22T08:00:00Z',
};

describe('notification wire contract', () => {
  it('accepts a valid tenant-safe snapshot', () => {
    const parsed = parseNotificationList({
      revision: 'r1',
      items: [item],
      sync_state: 'fresh',
      last_synced_at: '2026-08-22T08:00:01Z',
      failure_codes: [],
    });
    expect(parsed.items[0].target).toEqual({ type: 'conversation', conversationId: 'conversation-1' });
  });

  it('rejects duplicate IDs and sensitive fields before rendering', () => {
    expect(() =>
      parseNotificationList({ revision: 'r1', items: [item, item], sync_state: 'fresh', failure_codes: [] })
    ).toThrow('duplicate notification id');
    expect(() =>
      parseNotificationList({
        revision: 'r1',
        items: [{ ...item, access_token: 'must-not-cross-the-contract' }],
        sync_state: 'fresh',
        failure_codes: [],
      })
    ).toThrow('NOTIFICATION_SENSITIVE_FIELD');
  });

  it('requires the target identifiers needed by navigation', () => {
    expect(() =>
      parseNotificationList({
        revision: 'r1',
        items: [{ ...item, target: { type: 'message', conversationId: 'conversation-1' } }],
        sync_state: 'fresh',
        failure_codes: [],
      })
    ).toThrow('messageId is required');
  });

  it('parses an authoritative action receipt', () => {
    expect(
      parseNotificationReceipt({
        receipt_id: 'receipt-1',
        notification_id: 'notification-1',
        version: 'v2',
        status: 'dismissed',
      })
    ).toMatchObject({ status: 'dismissed', version: 'v2' });
  });
});
