import type { NotificationItem } from '@/common/types/notification';
import { Alert, Badge, Button, Drawer, Empty, Spin, Tag, Typography } from '@arco-design/web-react';
import { CheckOne, CloseSmall, Inbox, Right } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import {
  clearNotificationDetailCache,
  fetchActiveNotifications,
  fetchNotificationDetail,
  notificationInboxKey,
  notificationActions,
} from '@/renderer/services/notificationInbox';
import { resolveNotificationNavigation } from '@/renderer/services/notificationNavigation';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { isBackendHttpError } from '@/common/adapter/httpBridge';

type NotificationInboxProps = {
  onNavigate?: () => void;
  embedded?: boolean;
  onRequestClose?: () => void;
};

const severityColor = (severity: NotificationItem['severity']): 'blue' | 'green' | 'orange' | 'red' => {
  if (severity === 'success') return 'green';
  if (severity === 'warning') return 'orange';
  if (severity === 'critical') return 'red';
  return 'blue';
};

export const NotificationInbox: React.FC<NotificationInboxProps> = ({
  onNavigate,
  embedded = false,
  onRequestClose,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, user } = useAuth();
  const { mutate: mutateCache } = useSWRConfig();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [pendingAction, setPendingAction] = useState<string>();
  const [actionError, setActionError] = useState<'conflict' | 'retryable' | 'failed'>();
  const listRequestController = useMemo(() => new AbortController(), [user?.id]);
  const {
    data,
    error: listError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR(status === 'authenticated' && user ? notificationInboxKey(user.id) : null, () =>
    fetchActiveNotifications(listRequestController.signal)
  );
  const items = data?.items ?? [];
  const selectedVersion = items.find((item) => item.id === selectedId)?.version;
  const detailRequestController = useMemo(() => new AbortController(), [selectedId, selectedVersion, user?.id]);
  const {
    data: detail,
    error: detailError,
    isLoading: detailLoading,
  } = useSWR(
    selectedId && selectedVersion && user ? `notifications.detail:${user.id}:${selectedId}:${selectedVersion}` : null,
    () => fetchNotificationDetail(selectedId as string, detailRequestController.signal)
  );
  const unreadCount = useMemo(() => items.filter((item) => item.status === 'unread').length, [items]);

  useEffect(() => {
    setSelectedId(undefined);
    setPendingAction(undefined);
    setActionError(undefined);
  }, [user?.id]);

  useEffect(() => () => listRequestController.abort(), [listRequestController]);
  useEffect(() => () => detailRequestController.abort(), [detailRequestController]);

  const close = useCallback(() => {
    detailRequestController.abort();
    setVisible(false);
    setSelectedId(undefined);
    if (user?.id) void clearNotificationDetailCache(user.id, mutateCache);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [detailRequestController, mutateCache, user?.id]);

  const runAction = useCallback(
    async (item: NotificationItem, action: 'read' | 'dismiss') => {
      const key = `${item.id}:${action}`;
      setPendingAction(key);
      setActionError(undefined);
      try {
        await notificationActions.submit({
          scopeId: user?.id ?? 'signed-out',
          action,
          notificationId: item.id,
          expectedVersion: item.version,
        });
      } catch (actionFailure) {
        if (isBackendHttpError(actionFailure) && actionFailure.status === 409) {
          setActionError('conflict');
        } else if (isBackendHttpError(actionFailure) && [429, 502, 503, 504].includes(actionFailure.status)) {
          setActionError('retryable');
        } else {
          setActionError('failed');
        }
      } finally {
        setPendingAction((current) => (current === key ? undefined : current));
      }
    },
    [user?.id]
  );

  const openTarget = useCallback(
    (item: NotificationItem) => {
      const destination = resolveNotificationNavigation(item.target);
      if (!destination) {
        console.info('[NotificationInbox] navigation unavailable', {
          notification_id: item.id,
          target_type: item.target.type,
          result: 'ignored',
        });
        return;
      }
      console.info('[NotificationInbox] navigation resolved', {
        notification_id: item.id,
        target_type: item.target.type,
        result: 'navigating',
      });
      detailRequestController.abort();
      setVisible(false);
      setSelectedId(undefined);
      if (user?.id) void clearNotificationDetailCache(user.id, mutateCache);
      onRequestClose?.();
      onNavigate?.();
      void navigate(destination.pathname, { state: destination.state });
    },
    [detailRequestController, mutateCache, navigate, onNavigate, onRequestClose, user?.id]
  );

  const content = isLoading ? (
    <div className='py-48px flex-center'>
      <Spin aria-label={t('common.loading')} />
    </div>
  ) : listError ? (
    <Alert
      type='error'
      showIcon
      content={t('conversation.notifications.loadFailed')}
      action={
        <Button size='mini' loading={isValidating} onClick={() => void mutate()}>
          {t('common.retry')}
        </Button>
      }
    />
  ) : (
    <div className='flex flex-col gap-12px'>
      {actionError ? (
        <Alert type='error' showIcon content={t(`conversation.notifications.action.${actionError}`)} />
      ) : null}
      {data && ['stale', 'partial', 'failed'].includes(data.sync_state) ? (
        <Alert
          type='warning'
          showIcon
          content={t(`conversation.notifications.sync.${data.sync_state}`)}
          action={
            <Button size='mini' loading={isValidating} onClick={() => void mutate()}>
              {t('common.retry')}
            </Button>
          }
          data-testid='notification-sync-warning'
        />
      ) : null}
      {data?.sync_state === 'syncing' || isValidating ? (
        <Alert
          type='info'
          showIcon
          content={t('conversation.notifications.sync.syncing')}
          data-testid='notification-syncing'
        />
      ) : null}
      {items.length === 0 ? (
        <Empty description={t('conversation.notifications.empty')} />
      ) : (
        <div className='flex flex-col gap-8px' role='list' data-testid='notification-list'>
          {items.map((item) => {
            const selected = selectedId === item.id;
            const selectedItem = selected && detail?.id === item.id ? detail : undefined;
            const readPending = pendingAction === `${item.id}:read`;
            const dismissPending = pendingAction === `${item.id}:dismiss`;
            return (
              <section
                key={item.id}
                className='rounded-8px border border-b-base bg-base p-12px'
                data-testid={`notification-${item.id}`}
              >
                <Button
                  long
                  type='text'
                  className='!h-auto !p-0 !justify-start !text-left'
                  onClick={() => setSelectedId(selected ? undefined : item.id)}
                >
                  <span className='flex min-w-0 w-full items-start gap-10px'>
                    <span className='flex-1 min-w-0'>
                      <span className='flex items-center gap-6px'>
                        {item.status === 'unread' ? <Badge status='processing' /> : null}
                        <Typography.Text className='font-600 text-t-primary'>{item.title}</Typography.Text>
                        <Tag size='small' color={severityColor(item.severity)}>
                          {t(`conversation.notifications.severity.${item.severity}`)}
                        </Tag>
                      </span>
                      {item.summary ? (
                        <Typography.Text className='block mt-4px text-12px text-t-secondary' ellipsis>
                          {item.summary}
                        </Typography.Text>
                      ) : null}
                      <Typography.Text className='block mt-5px text-12px text-t-tertiary'>
                        {item.source} · {new Date(item.created_at).toLocaleString()}
                      </Typography.Text>
                    </span>
                    <Right theme='outline' size='16' className='shrink-0 text-t-tertiary' />
                  </span>
                </Button>
                {selected ? (
                  <div className='mt-12px border-t border-b-base pt-12px'>
                    {detailLoading ? (
                      <Spin aria-label={t('common.loading')} />
                    ) : detailError ? (
                      <Alert type='error' showIcon content={t('conversation.notifications.detailFailed')} />
                    ) : null}
                    {selectedItem?.body ? (
                      <Typography.Paragraph className='whitespace-pre-wrap text-t-secondary'>
                        {selectedItem.body}
                      </Typography.Paragraph>
                    ) : null}
                    <div className='flex flex-wrap gap-8px'>
                      {(selectedItem ?? item).status === 'unread' ? (
                        <Button
                          size='small'
                          icon={<CheckOne theme='outline' />}
                          loading={readPending}
                          onClick={() => void runAction(selectedItem ?? item, 'read')}
                        >
                          {t('conversation.notifications.actions.read')}
                        </Button>
                      ) : null}
                      {(selectedItem ?? item).dismissible ? (
                        <Button
                          size='small'
                          loading={dismissPending}
                          onClick={() => void runAction(selectedItem ?? item, 'dismiss')}
                        >
                          {t('conversation.notifications.actions.dismiss')}
                        </Button>
                      ) : null}
                      {selectedItem && selectedItem.target.type !== 'notification' ? (
                        <Button size='small' type='primary' onClick={() => openTarget(selectedItem)}>
                          {t('conversation.notifications.actions.openTarget')}
                        </Button>
                      ) : selectedItem ? (
                        <Typography.Text className='text-12px text-t-tertiary'>
                          {t('conversation.notifications.navigationUnavailable')}
                        </Typography.Text>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );

  if (embedded) return content;

  return (
    <>
      <Button
        ref={triggerRef}
        long
        type='text'
        className='!h-34px !px-10px !text-t-primary hover:!bg-fill-2'
        icon={<Inbox theme='outline' size='17' />}
        onClick={() => setVisible(true)}
        aria-label={t('conversation.notifications.open', { count: unreadCount })}
        data-testid='notification-inbox-trigger'
      >
        <span className='flex-1 text-left'>{t('conversation.notifications.title')}</span>
        {unreadCount > 0 ? <Badge count={unreadCount} maxCount={99} data-testid='notification-unread-count' /> : null}
      </Button>
      <Drawer
        width='min(720px, calc(100vw - 48px))'
        title={t('conversation.notifications.title')}
        visible={visible}
        onCancel={close}
        closeIcon={
          <Button
            type='text'
            shape='circle'
            icon={<CloseSmall theme='outline' size='16' />}
            onClick={(event) => {
              event.stopPropagation();
              close();
            }}
            aria-label={t('common.close')}
          />
        }
        footer={null}
        unmountOnExit={false}
        getPopupContainer={() => document.body}
        data-testid='notification-inbox-drawer'
      >
        {content}
      </Drawer>
    </>
  );
};
