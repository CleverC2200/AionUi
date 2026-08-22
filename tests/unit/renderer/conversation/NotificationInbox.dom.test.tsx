import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import { NotificationInbox } from '@/renderer/pages/conversation/NotificationInbox';

const { list, detail, submit, navigate, clearDetail } = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  submit: vi.fn(),
  navigate: vi.fn(),
  clearDetail: vi.fn(),
}));

vi.mock('@/renderer/services/notificationInbox', () => ({
  notificationInboxKey: (userId: string) => `notifications.active.test:${userId}`,
  fetchActiveNotifications: list,
  fetchNotificationDetail: detail,
  clearNotificationDetailCache: clearDetail,
  notificationActions: { submit },
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'user-1' } }),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`),
  }),
}));

const notification = {
  id: 'notification-1',
  version: 'v1',
  status: 'unread' as const,
  kind: 'event' as const,
  severity: 'warning' as const,
  title: 'Forecast needs review',
  summary: 'September forecast',
  body: 'Review the changed forecast before submission.',
  dismissible: true,
  source: 'gea.workflow',
  target: { type: 'conversation' as const, conversationId: 'conversation-1' },
  created_at: '2026-08-22T08:00:00Z',
};

const renderInbox = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NotificationInbox />
    </SWRConfig>
  );

describe('NotificationInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({
      revision: 'r1',
      items: [notification],
      sync_state: 'fresh',
      last_synced_at: '2026-08-22T08:00:01Z',
      failure_codes: [],
    });
    submit.mockResolvedValue({
      receipt_id: 'receipt-1',
      notification_id: notification.id,
      version: 'v2',
      status: 'read',
    });
    detail.mockResolvedValue(notification);
  });

  it('renders unread count, details, action receipt command and typed navigation', async () => {
    renderInbox();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('notification-inbox-trigger')).toHaveAttribute(
      'aria-label',
      'conversation.notifications.open:1'
    );

    fireEvent.click(screen.getByTestId('notification-inbox-trigger'));
    fireEvent.click(await screen.findByText(notification.title));
    expect(await screen.findByText(notification.body)).toBeVisible();
    expect(detail).toHaveBeenCalledWith(notification.id, expect.any(AbortSignal));

    fireEvent.click(screen.getByText('conversation.notifications.actions.read'));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        scopeId: 'user-1',
        action: 'read',
        notificationId: notification.id,
        expectedVersion: notification.version,
      })
    );

    fireEvent.click(screen.getByText('conversation.notifications.actions.openTarget'));
    expect(navigate).toHaveBeenCalledWith('/conversation/conversation-1', { state: undefined });
    expect(clearDetail).toHaveBeenCalledWith('user-1', expect.any(Function));
  });

  it('shows last-good degradation without hiding confirmed items', async () => {
    list.mockResolvedValue({
      revision: 'r1',
      items: [notification],
      sync_state: 'stale',
      last_synced_at: '2026-08-22T08:00:01Z',
      failure_codes: ['GEA_UNAVAILABLE'],
    });
    renderInbox();
    fireEvent.click(await screen.findByTestId('notification-inbox-trigger'));

    expect(await screen.findByTestId('notification-sync-warning')).toBeVisible();
    expect(screen.getByText(notification.title)).toBeVisible();
  });

  it('renders syncing state and a safe fallback for notification-only targets', async () => {
    const notificationOnly = { ...notification, target: { type: 'notification' as const } };
    list.mockResolvedValue({
      revision: 'r1',
      items: [notificationOnly],
      sync_state: 'syncing',
      last_synced_at: '2026-08-22T08:00:01Z',
      failure_codes: [],
    });
    detail.mockResolvedValue(notificationOnly);
    renderInbox();
    fireEvent.click(await screen.findByTestId('notification-inbox-trigger'));
    expect(await screen.findByTestId('notification-syncing')).toBeVisible();
    fireEvent.click(await screen.findByText(notificationOnly.title));
    expect(await screen.findByText('conversation.notifications.navigationUnavailable')).toBeVisible();
    expect(screen.queryByText('conversation.notifications.actions.openTarget')).not.toBeInTheDocument();
  });

  it('surfaces a failed mutation and does not guess the next state', async () => {
    submit.mockRejectedValue(new Error('conflict'));
    renderInbox();
    fireEvent.click(await screen.findByTestId('notification-inbox-trigger'));
    fireEvent.click(await screen.findByText(notification.title));
    fireEvent.click(screen.getByText('conversation.notifications.actions.dismiss'));

    expect(await screen.findByText('conversation.notifications.action.failed')).toBeVisible();
    expect(screen.getByText(notification.title)).toBeVisible();
  });

  it('renders an authenticated successful empty snapshot', async () => {
    list.mockResolvedValue({
      revision: 'r-empty',
      items: [],
      sync_state: 'fresh',
      last_synced_at: '2026-08-22T08:00:01Z',
      failure_codes: [],
    });
    renderInbox();
    fireEvent.click(await screen.findByTestId('notification-inbox-trigger'));
    expect(await screen.findByText('conversation.notifications.empty')).toBeVisible();
  });

  it.each(['partial', 'failed'] as const)(
    'shows the %s sync state without hiding confirmed data',
    async (syncState) => {
      list.mockResolvedValue({
        revision: 'r1',
        items: [notification],
        sync_state: syncState,
        last_synced_at: '2026-08-22T08:00:01Z',
        failure_codes: ['GEA_UNAVAILABLE'],
      });
      renderInbox();
      fireEvent.click(await screen.findByTestId('notification-inbox-trigger'));
      expect(await screen.findByText(`conversation.notifications.sync.${syncState}`)).toBeVisible();
      expect(screen.getByText(notification.title)).toBeVisible();
    }
  );

  it('keeps a failed list request distinct from a successful empty snapshot', async () => {
    list.mockRejectedValue(new Error('offline'));
    renderInbox();
    fireEvent.click(await screen.findByTestId('notification-inbox-trigger'));
    expect(await screen.findByText('conversation.notifications.loadFailed')).toBeVisible();
    expect(screen.queryByText('conversation.notifications.empty')).not.toBeInTheDocument();
  });
});
