import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import BusinessMessageInbox from '@/renderer/pages/assistantSurface/components/BusinessMessageInbox';

const { list, detail, submit, navigate } = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  submit: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@/renderer/services/notificationInbox', () => ({
  notificationInboxKey: (userId: string) => `notifications.active.test:${userId}`,
  fetchActiveNotifications: list,
  fetchNotificationDetail: detail,
  notificationActions: { submit },
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'user-1' } }),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string; state?: string }) => {
      const translations: Record<string, string> = {
        'common.assistantSurface.messages.openRelated': '打开关联 Agent',
        'common.assistantSurface.messages.permissionDenied': '当前账号没有读取消息待办的权限。',
        'common.assistantSurface.messages.sourceExpired': '消息来源已失效，请刷新列表后重新确认。',
        'common.assistantSurface.messages.source': '消息来源',
        'common.assistantSurface.messages.allSources': '全部来源',
        'conversation.notifications.actions.openTarget': '打开目标',
        'conversation.notifications.actions.dismiss': '忽略',
        'common.close': '关闭',
        'common.retry': '重试',
      };
      if (key === 'common.assistantSurface.messages.unreadWithCount') return `未读 ${options?.count ?? 0}`;
      if (key === 'common.assistantSurface.messages.readWithCount') return `已读 ${options?.count ?? 0}`;
      if (key === 'common.assistantSurface.messages.empty') return `暂无${options?.state ?? ''}消息`;
      return translations[key] ?? options?.defaultValue ?? key;
    },
  }),
}));

const notification = {
  id: 'forecast-notification-1',
  version: 'v1',
  status: 'unread' as const,
  kind: 'action_required' as const,
  severity: 'warning' as const,
  title: '销售计划审批待办',
  summary: '区域提报进度 52%，存在客户与 SKU 差异。',
  body: ['未提报客户（3）', '- 北辰食品商贸', 'SKU 差异（4）', '- FSKU001', '审批建议', '- 先补证'].join('\n'),
  dismissible: true,
  source: 'gea.forecast.workflow',
  target: { type: 'conversation' as const, conversationId: 'conversation-1' },
  created_at: '2026-08-30T08:00:00Z',
};

const inboxStyles = readFileSync(
  resolve(
    process.cwd(),
    'packages/desktop/src/renderer/pages/assistantSurface/components/BusinessMessageInbox.module.css'
  ),
  'utf8'
);

describe('BusinessMessageInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__aionuiAssistantSurfaceFixtures = true;
    list.mockResolvedValue({
      revision: 'r1',
      items: [notification],
      sync_state: 'fresh',
      last_synced_at: '2026-08-30T08:00:01Z',
      failure_codes: [],
    });
    detail.mockResolvedValue(notification);
    submit.mockResolvedValue({
      receipt_id: 'receipt-1',
      notification_id: notification.id,
      version: 'v2',
      status: 'read',
    });
  });

  it('opens a row from the keyboard, marks the shared Notification read, and follows its typed target', async () => {
    const user = userEvent.setup();
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <BusinessMessageInbox />
      </SWRConfig>
    );

    const messageButton = await screen.findByTestId(`business-message-${notification.id}`);
    messageButton.focus();
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        scopeId: 'user-1',
        action: 'read',
        notificationId: notification.id,
        expectedVersion: notification.version,
      })
    );
    expect(await screen.findByText('未提报客户（3）')).toBeVisible();
    expect(screen.getByText('SKU 差异（4）')).toBeVisible();
    expect(screen.getByText('审批建议')).toBeVisible();

    expect(await screen.findByText('已读')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '打开目标' }));
    expect(navigate).toHaveBeenCalledWith('/conversation/conversation-1', { state: undefined });
  });

  it('keeps read messages separate and does not mutate them when opened', async () => {
    const readNotification = {
      ...notification,
      id: 'forecast-notification-read',
      version: 'v2',
      status: 'read' as const,
    };
    list.mockResolvedValue({
      revision: 'r2',
      items: [readNotification],
      sync_state: 'fresh',
      last_synced_at: '2026-08-30T08:00:01Z',
      failure_codes: [],
    });
    detail.mockResolvedValue(readNotification);

    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <BusinessMessageInbox />
      </SWRConfig>
    );

    fireEvent.click(await screen.findByRole('tab', { name: '已读 1' }));
    fireEvent.click(await screen.findByTestId(`business-message-${readNotification.id}`));
    expect(await screen.findByRole('tab', { name: '未提报客户（3）' })).toBeVisible();
    expect(submit).not.toHaveBeenCalled();
  });

  it('derives source filters from real Notification items and filters without renaming sources', async () => {
    const secondNotification = {
      ...notification,
      id: 'core-notification-1',
      title: 'AionCore 调度通知',
      source: 'aioncore.scheduler',
    };
    list.mockResolvedValue({
      revision: 'r-source-filter',
      items: [notification, secondNotification],
      sync_state: 'fresh',
      last_synced_at: '2026-08-30T08:00:01Z',
      failure_codes: [],
    });

    const user = userEvent.setup();
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <BusinessMessageInbox />
      </SWRConfig>
    );

    const sourceFilter = await screen.findByRole('combobox', { name: '消息来源' });
    await user.click(sourceFilter);
    expect(await screen.findByRole('option', { name: 'gea.forecast.workflow' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'aioncore.scheduler' })).toBeVisible();
    fireEvent.click(screen.getByRole('option', { name: 'aioncore.scheduler' }));
    expect(screen.queryByText(notification.title)).not.toBeInTheDocument();
    expect(screen.getByText(secondNotification.title)).toBeVisible();

    await user.click(sourceFilter);
    fireEvent.click(await screen.findByRole('option', { name: '全部来源' }));
    expect(screen.getByText(notification.title)).toBeVisible();
    expect(screen.getByText(secondNotification.title)).toBeVisible();
  });

  it('owns the table width and adapts columns to the inbox container', () => {
    expect(inboxStyles).toMatch(/\.listPanel\s*\{[^}]*container-type:\s*inline-size;/s);
    expect(inboxStyles).toMatch(/\.table\s*\{[^}]*width:\s*100%;/s);
    expect(inboxStyles).toMatch(/\.messageButton\s*\{[^}]*display:\s*flex(?:\s*!important)?;[^}]*width:\s*100%;/s);
    expect(inboxStyles).toMatch(/\.messageCell\s*\{[^}]*text-align:\s*left;/s);
    expect(inboxStyles).toMatch(/@container(?:\s+[\w-]+)?\s*\(max-width:/);
    expect(inboxStyles).not.toMatch(/@media\s*\(max-width:\s*1124px\)/);
  });

  it('keeps the todo detail modal compact with the approved four-column summary', () => {
    expect(inboxStyles).toMatch(
      /\.detailModal :global\(\.arco-modal\)\s*\{[^}]*width:\s*920px;[^}]*max-width:\s*calc\(100vw - 48px\);/s
    );
    expect(inboxStyles).toMatch(/\.detailSummary\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/s);
    expect(inboxStyles).toMatch(/\.detailModal :global\(\.arco-tabs-header-nav\)\s*\{[^}]*padding-inline:\s*12px;/s);
    expect(inboxStyles).toMatch(/\.detailModal :global\(\.arco-tabs-content\)\s*\{[^}]*padding:\s*10px 12px 12px;/s);
    expect(inboxStyles).not.toMatch(/\.detailText\s*\{[^}]*min-height:/s);
    expect(inboxStyles).not.toMatch(/\.targetGrid\s*\{[^}]*min-height:/s);
    expect(inboxStyles).toMatch(/\.modalActions\s*\{[^}]*align-items:\s*center;/s);
    expect(inboxStyles).toMatch(/\.modalActionButton\s*\{[^}]*min-width:\s*60px;/s);
    expect(inboxStyles).toMatch(
      /@media \(max-width:\s*760px\)[\s\S]*?\.detailSummary\s*\{[^}]*grid-template-columns:\s*1fr;/
    );
  });

  it('keeps the lower-right modal actions concise when the notification has no client target', async () => {
    const readNotification = {
      ...notification,
      status: 'read' as const,
      target: { type: 'notification' as const },
    };
    list.mockResolvedValue({
      revision: 'r-footer',
      items: [readNotification],
      sync_state: 'fresh',
      last_synced_at: '2026-08-30T08:00:01Z',
      failure_codes: [],
    });
    detail.mockResolvedValue(readNotification);

    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <BusinessMessageInbox />
      </SWRConfig>
    );

    fireEvent.click(await screen.findByRole('tab', { name: '已读 1' }));
    fireEvent.click(await screen.findByTestId(`business-message-${readNotification.id}`));

    expect(await screen.findByRole('button', { name: '关闭' })).toHaveClass('arco-btn-outline');
    expect(screen.getByRole('button', { name: '忽略' })).toHaveClass('arco-btn-secondary');
    expect(screen.queryByText('该通知没有可打开的客户端目标。')).not.toBeInTheDocument();
  });

  it('distinguishes loading, empty and generic error states', async () => {
    list.mockImplementationOnce(() => new Promise(() => {}));
    const loadingView = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <BusinessMessageInbox />
      </SWRConfig>
    );
    expect(await screen.findByLabelText('common.loading')).toBeVisible();
    loadingView.unmount();

    list.mockResolvedValueOnce({
      revision: 'r-empty',
      items: [],
      sync_state: 'fresh',
      last_synced_at: '2026-08-30T08:00:01Z',
      failure_codes: [],
    });
    const emptyView = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <BusinessMessageInbox />
      </SWRConfig>
    );
    expect(await screen.findByText('暂无未读消息')).toBeVisible();
    emptyView.unmount();

    list.mockRejectedValueOnce(new Error('offline'));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <BusinessMessageInbox />
      </SWRConfig>
    );
    expect(await screen.findByText('conversation.notifications.loadFailed')).toBeVisible();
    expect(screen.queryByText('当前账号没有读取消息待办的权限。')).not.toBeInTheDocument();
  });

  it('keeps permission failure distinct and offers an explicit retry', async () => {
    list.mockRejectedValueOnce(
      new BackendHttpError({ method: 'GET', path: '/api/notifications', status: 403, body: { code: 'FORBIDDEN' } })
    );

    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <BusinessMessageInbox />
      </SWRConfig>
    );

    expect(await screen.findByText('当前账号没有读取消息待办的权限。')).toBeVisible();
    expect(screen.getByRole('button', { name: '重试' })).toBeVisible();
  });

  it('shows an expired-source state without inventing message content', async () => {
    const notificationOnly = {
      ...notification,
      status: 'read' as const,
      target: { type: 'notification' as const },
    };
    list.mockResolvedValueOnce({
      revision: 'r1',
      items: [notificationOnly],
      sync_state: 'fresh',
      last_synced_at: '2026-08-30T08:00:01Z',
      failure_codes: [],
    });
    detail.mockRejectedValueOnce(
      new BackendHttpError({ method: 'GET', path: `/api/notifications/${notification.id}`, status: 410, body: {} })
    );

    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <BusinessMessageInbox />
      </SWRConfig>
    );

    fireEvent.click(await screen.findByRole('tab', { name: '已读 1' }));
    fireEvent.click(await screen.findByTestId(`business-message-${notification.id}`));
    expect(await screen.findByText('消息来源已失效，请刷新列表后重新确认。')).toBeVisible();
    expect(screen.queryByText('该通知没有可打开的客户端目标。')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开目标' })).not.toBeInTheDocument();
    expect(screen.queryByText('未提报客户（3）')).not.toBeInTheDocument();
  });
});
