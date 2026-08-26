import { expect, test } from '../fixtures';
import { goToGuid, invokeBridge } from '../helpers';

test.describe('GEA notification inbox mock contract', () => {
  test('new notification opens, marks read and dismisses through the public HTTP seam', async ({ page }) => {
    let notification = {
      id: 'notification-e2e',
      version: 'v1',
      status: 'unread',
      kind: 'event',
      severity: 'warning',
      title: 'E2E forecast notification',
      summary: 'Mock contract snapshot',
      body: 'Review the forecast before submission.',
      dismissible: true,
      source: 'gea.mock',
      target: { type: 'notification' },
      created_at: '2026-08-22T08:00:00Z',
    };

    await page.route('**/api/notifications**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/notifications') {
        const items = notification.status === 'dismissed' ? [] : [notification];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              revision: `revision-${notification.version}`,
              items,
              sync_state: 'fresh',
              last_synced_at: '2026-08-22T08:00:01Z',
              failure_codes: [],
            },
          }),
        });
        return;
      }
      if (request.method() === 'GET' && url.pathname === '/api/notifications/notification-e2e') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: notification }),
        });
        return;
      }
      if (request.method() === 'POST' && url.pathname.endsWith('/read')) {
        const command = request.postDataJSON() as { expected_version: string; idempotency_key: string };
        expect(command.expected_version).toBe('v1');
        expect(command.idempotency_key).toBe('notification:notification-e2e:v1:read');
        notification = { ...notification, version: 'v2', status: 'read' };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              receipt_id: 'receipt-read-e2e',
              notification_id: notification.id,
              version: notification.version,
              status: notification.status,
            },
          }),
        });
        return;
      }
      if (request.method() === 'POST' && url.pathname.endsWith('/dismiss')) {
        const command = request.postDataJSON() as { expected_version: string; idempotency_key: string };
        expect(command.expected_version).toBe('v2');
        expect(command.idempotency_key).toBe('notification:notification-e2e:v2:dismiss');
        notification = { ...notification, version: 'v3', status: 'dismissed' };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              receipt_id: 'receipt-dismiss-e2e',
              notification_id: notification.id,
              version: notification.version,
              status: notification.status,
            },
          }),
        });
        return;
      }
      await route.fallback();
    });

    try {
      await page.reload();
      await goToGuid(page);
      const trigger = page.getByTestId('attention-inbox-trigger');
      await expect(trigger).toBeVisible({ timeout: 15_000 });
      await trigger.click();
      const notificationTab = page.getByRole('tab', { name: /^(?:通知|Notifications) 1$/ });
      await expect(notificationTab).toBeVisible();
      await notificationTab.click();
      await page.getByText(notification.title).click();
      await expect(page.getByText(notification.body)).toBeVisible();
      await page.getByRole('button', { name: /标记已读|Mark as read/ }).click();
      await expect(page.getByRole('tab', { name: /^(?:通知|Notifications) 0$/ })).toBeVisible();

      await page.getByRole('button', { name: /忽略|Dismiss/ }).click();
      await expect(page.getByText(/暂无有效通知|No active notifications/)).toBeVisible();
    } finally {
      await page.unroute('**/api/notifications**');
    }
  });

  test('native notification click respects the active identity before navigating', async ({ page, electronApp }) => {
    await page.reload();
    await goToGuid(page);
    const auth = await invokeBridge<{
      success: boolean;
      data?: { authenticated: boolean; user?: { id?: string } };
    }>(page, 'lark-auth.status');
    const userId = auth.data?.user?.id;
    expect(userId).toBeTruthy();

    const emitClick = async (scopeId: string, conversationId: string) => {
      await electronApp.evaluate(
        ({ BrowserWindow }, payload) => {
          const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
          win?.webContents.send(
            'office-ai-bridge-adapter',
            JSON.stringify({ name: 'notification.clicked', data: payload })
          );
        },
        {
          notification_id: 'notification-native-e2e',
          notification_version: 'v1',
          scope_id: scopeId,
          target: { type: 'conversation', conversationId },
        }
      );
    };

    await emitClick(`${userId}-other`, 'must-not-open');
    await expect(page).not.toHaveURL(/must-not-open/);

    await emitClick(userId as string, 'native-click-target');
    await expect(page).toHaveURL(/\/conversation\/native-click-target/, { timeout: 5_000 });
  });
});
