import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { NotificationItem } from '@/common/types/notification';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import {
  fetchActiveNotifications,
  fetchNotificationDetail,
  notificationActions,
  notificationInboxKey,
} from '@/renderer/services/notificationInbox';
import { resolveNotificationNavigation } from '@/renderer/services/notificationNavigation';
import { Alert, Badge, Button, Empty, Modal, Select, Spin, Table, Tabs, Tag, Typography } from '@arco-design/web-react';
import { CheckOne, Inbox, Right, Send } from '@icon-park/react';
import type { TFunction } from 'i18next';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import styles from './BusinessMessageInbox.module.css';

type InboxFilter = 'unread' | 'read';

type DetailSection = {
  key: string;
  title: string;
  content: string;
};

const sectionDefinitions = [
  { key: 'customers', pattern: /^(?:未提报客户|unsubmitted customers?)/i },
  { key: 'sku-difference', pattern: /^(?:sku\s*(?:与预测数量)?差异|sku differences?)/i },
  { key: 'customer-difference', pattern: /^(?:客户(?:提报与预测)?差异|customer differences?)/i },
  { key: 'approval', pattern: /^(?:本次)?审批建议(?:方向)?|approval recommendation/i },
  { key: 'version', pattern: /^版本差异(?:明细)?|version differences?/i },
] as const;

const normalizeHeading = (line: string): string =>
  line
    .replace(/^#{1,6}\s*/, '')
    .replace(/[（(]\d+[）)]\s*$/, '')
    .trim();

export const extractBusinessDetailSections = (body: string | undefined): DetailSection[] => {
  if (!body?.trim()) return [];
  const sections: DetailSection[] = [];
  let active: DetailSection | undefined;

  for (const line of body.split(/\r?\n/)) {
    const heading = normalizeHeading(line);
    const definition = sectionDefinitions.find((candidate) => candidate.pattern.test(heading));
    if (definition) {
      active = { key: definition.key, title: line.replace(/^#{1,6}\s*/, '').trim(), content: '' };
      sections.push(active);
      continue;
    }
    if (active) active.content = `${active.content}${active.content ? '\n' : ''}${line}`.trim();
  }

  return sections.filter((section) => section.content.length > 0);
};

const severityColor = (severity: NotificationItem['severity']): 'blue' | 'green' | 'orange' | 'red' => {
  if (severity === 'success') return 'green';
  if (severity === 'warning') return 'orange';
  if (severity === 'critical') return 'red';
  return 'blue';
};

const targetSummary = (item: NotificationItem): string => {
  const target = item.target;
  if (target.type === 'conversation') return target.conversationId ?? target.type;
  if (target.type === 'message') return target.messageId ?? target.conversationId ?? target.type;
  if (target.type === 'team') return target.teamId ?? target.type;
  if (target.type === 'slot') return target.slotId ?? target.teamId ?? target.type;
  if (target.type === 'interaction_request') return target.requestId ?? target.type;
  return target.type;
};

const statusLabel = (item: NotificationItem, t: TFunction) =>
  item.status === 'unread'
    ? t('common.assistantSurface.messages.unread', { defaultValue: '未读' })
    : t('common.assistantSurface.messages.read', { defaultValue: '已读' });

const BusinessMessageInbox: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, user } = useAuth();
  const [filter, setFilter] = useState<InboxFilter>('unread');
  const [sourceFilter, setSourceFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedSnapshot, setSelectedSnapshot] = useState<NotificationItem>();
  const [pendingAction, setPendingAction] = useState<'read' | 'dismiss'>();
  const [actionError, setActionError] = useState<'conflict' | 'retryable' | 'failed'>();
  const listController = useMemo(() => new AbortController(), [user?.id]);
  const {
    data,
    error: listError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR(status === 'authenticated' && user ? notificationInboxKey(user.id) : null, () =>
    fetchActiveNotifications(listController.signal)
  );
  const items = data?.items.filter((item) => item.status !== 'dismissed') ?? [];
  const unreadItems = items.filter((item) => item.status === 'unread');
  const readItems = items.filter((item) => item.status === 'read');
  const sourceOptions = useMemo(
    () => [...new Set(items.map((item) => item.source))].toSorted((left, right) => left.localeCompare(right)),
    [items]
  );
  const stateItems = filter === 'unread' ? unreadItems : readItems;
  const visibleItems = sourceFilter ? stateItems.filter((item) => item.source === sourceFilter) : stateItems;
  const selectedListItem = items.find((item) => item.id === selectedId);
  const selectedVersion = selectedSnapshot?.version ?? selectedListItem?.version;
  const detailController = useMemo(() => new AbortController(), [selectedId, selectedVersion, user?.id]);
  const {
    data: detail,
    error: detailError,
    isLoading: detailLoading,
  } = useSWR(
    selectedId && selectedVersion && user ? `notifications.detail:${user.id}:${selectedId}:${selectedVersion}` : null,
    () => fetchNotificationDetail(selectedId as string, detailController.signal)
  );
  const selectedDetail = detail?.version === selectedVersion ? detail : undefined;
  const selectedItem = selectedSnapshot
    ? {
        ...selectedDetail,
        ...selectedSnapshot,
        body: selectedDetail?.body ?? selectedSnapshot.body,
      }
    : (selectedDetail ?? selectedListItem);
  const businessSections = useMemo(() => extractBusinessDetailSections(selectedItem?.body), [selectedItem?.body]);

  useEffect(() => () => listController.abort(), [listController]);
  useEffect(() => () => detailController.abort(), [detailController]);
  useEffect(() => {
    setSelectedId(undefined);
    setSelectedSnapshot(undefined);
    setActionError(undefined);
    setSourceFilter('');
  }, [user?.id]);
  useEffect(() => {
    if (sourceFilter && !sourceOptions.includes(sourceFilter)) setSourceFilter('');
  }, [sourceFilter, sourceOptions]);

  const runAction = useCallback(
    async (item: NotificationItem, action: 'read' | 'dismiss') => {
      setPendingAction(action);
      setActionError(undefined);
      try {
        const receipt = await notificationActions.submit({
          scopeId: user?.id ?? 'signed-out',
          action,
          notificationId: item.id,
          expectedVersion: item.version,
        });
        setSelectedSnapshot((current) => {
          if (current?.id !== item.id) return current;
          return receipt.notification ?? { ...current, version: receipt.version, status: receipt.status };
        });
        if (action === 'dismiss') {
          setSelectedId(undefined);
          setSelectedSnapshot(undefined);
        }
        return receipt;
      } catch (error) {
        if (isBackendHttpError(error) && error.status === 409) setActionError('conflict');
        else if (isBackendHttpError(error) && [429, 502, 503, 504].includes(error.status)) {
          setActionError('retryable');
        } else setActionError('failed');
        return undefined;
      } finally {
        setPendingAction(undefined);
      }
    },
    [user?.id]
  );

  const openDetail = useCallback(
    (item: NotificationItem) => {
      setSelectedId(item.id);
      setSelectedSnapshot(item);
      if (item.status === 'unread') {
        void runAction(item, 'read');
      }
    },
    [runAction]
  );

  const openTarget = useCallback(
    (item: NotificationItem) => {
      const destination = resolveNotificationNavigation(item.target);
      if (!destination) return;
      setSelectedId(undefined);
      setSelectedSnapshot(undefined);
      void navigate(destination.pathname, { state: destination.state });
    },
    [navigate]
  );

  const columns = useMemo(
    () => [
      {
        title: t('common.assistantSurface.messages.columns.message', { defaultValue: '消息' }),
        dataIndex: 'title',
        className: styles.messageCell,
        render: (_: unknown, item: NotificationItem) => (
          <Button
            type='text'
            long
            className={styles.messageButton}
            onClick={() => openDetail(item)}
            data-testid={`business-message-${item.id}`}
          >
            <span className={styles.messageLead}>
              {item.status === 'unread' ? <Badge status='error' /> : <CheckOne size={15} />}
            </span>
            <span className={styles.messageCopy}>
              <span className={styles.messageTitleLine}>
                <Typography.Text className={styles.messageTitle}>{item.title}</Typography.Text>
                <Tag size='small' color={severityColor(item.severity)}>
                  {t(`conversation.notifications.severity.${item.severity}`)}
                </Tag>
              </span>
              {item.summary ? (
                <Typography.Text className={styles.messageSummary} ellipsis>
                  {item.summary}
                </Typography.Text>
              ) : null}
            </span>
          </Button>
        ),
      },
      {
        title: t('common.assistantSurface.messages.columns.source', { defaultValue: '来源' }),
        dataIndex: 'source',
        width: 150,
        ellipsis: true,
      },
      {
        title: t('common.assistantSurface.messages.columns.time', { defaultValue: '时间' }),
        dataIndex: 'created_at',
        width: 168,
        render: (value: string) => new Date(value).toLocaleString(),
      },
      {
        title: t('common.assistantSurface.messages.columns.status', { defaultValue: '状态' }),
        dataIndex: 'status',
        width: 78,
        render: (_: unknown, item: NotificationItem) => (
          <Typography.Text className={item.status === 'unread' ? styles.unreadStatus : styles.readStatus}>
            {statusLabel(item, t)}
          </Typography.Text>
        ),
      },
      {
        title: '',
        width: 44,
        render: (_: unknown, item: NotificationItem) => (
          <Button
            type='text'
            shape='circle'
            icon={<Right size={15} />}
            aria-label={t('common.assistantSurface.messages.openDetail', { defaultValue: '打开消息详情' })}
            onClick={() => openDetail(item)}
          />
        ),
      },
    ],
    [openDetail, t]
  );

  const selectedDestination = selectedItem ? resolveNotificationNavigation(selectedItem.target) : null;
  const emptyStateLabel =
    filter === 'unread'
      ? t('common.assistantSurface.messages.unread', { defaultValue: '未读' })
      : t('common.assistantSurface.messages.read', { defaultValue: '已读' });

  return (
    <main className={styles.root} aria-label={t('common.assistantSurface.messages.title')}>
      <header className={styles.header}>
        <div>
          <h1>{t('common.assistantSurface.messages.title')}</h1>
          <p>{t('common.assistantSurface.messages.description')}</p>
        </div>
        <Tag size='small'>{t('common.assistantSurface.messages.readStateBoundary')}</Tag>
      </header>

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
        />
      ) : null}

      <section className={styles.listPanel}>
        <div className={styles.filterBar}>
          <Tabs
            className={styles.stateTabs}
            activeTab={filter}
            type='line'
            onChange={(key) => setFilter(key as InboxFilter)}
            destroyOnHide={false}
          >
            <Tabs.TabPane
              key='unread'
              title={t('common.assistantSurface.messages.unreadWithCount', { count: unreadItems.length })}
            />
            <Tabs.TabPane
              key='read'
              title={t('common.assistantSurface.messages.readWithCount', { count: readItems.length })}
            />
          </Tabs>
          <Select
            className={styles.sourceFilter}
            size='small'
            value={sourceFilter}
            aria-label={t('common.assistantSurface.messages.source')}
            options={[
              { label: t('common.assistantSurface.messages.allSources'), value: '' },
              ...sourceOptions.map((source) => ({ label: source, value: source })),
            ]}
            onChange={(value) => setSourceFilter(value)}
          />
        </div>
        {isLoading ? (
          <div className={styles.state}>
            <Spin aria-label={t('common.loading')} />
          </div>
        ) : listError ? (
          <Alert
            type='error'
            showIcon
            content={
              isBackendHttpError(listError) && [401, 403].includes(listError.status)
                ? t('common.assistantSurface.messages.permissionDenied')
                : t('conversation.notifications.loadFailed')
            }
            action={
              <Button size='mini' loading={isValidating} onClick={() => void mutate()}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : visibleItems.length === 0 ? (
          <div className={styles.state}>
            <Empty description={t('common.assistantSurface.messages.empty', { state: emptyStateLabel })} />
          </div>
        ) : (
          <Table
            className={styles.table}
            columns={columns}
            data={visibleItems}
            rowKey='id'
            size='small'
            border={{ wrapper: true, cell: false }}
            pagination={false}
            tableLayoutFixed
          />
        )}
      </section>

      <Modal
        wrapClassName={styles.detailModal}
        visible={Boolean(selectedId)}
        title={selectedItem?.title ?? t('common.assistantSurface.messages.detailTitle')}
        footer={
          selectedItem ? (
            <div className={styles.modalFooter}>
              <Typography.Text className={styles.boundaryNote}>
                {t('common.assistantSurface.messages.readStateBoundary')}
              </Typography.Text>
              <div className={styles.modalActions}>
                <Button
                  className={styles.modalActionButton}
                  type='outline'
                  onClick={() => {
                    setSelectedId(undefined);
                    setSelectedSnapshot(undefined);
                  }}
                >
                  {t('common.close')}
                </Button>
                {selectedItem.status === 'unread' ? (
                  <Button
                    className={styles.modalActionButton}
                    type='secondary'
                    icon={<CheckOne size={15} />}
                    loading={pendingAction === 'read'}
                    onClick={() => void runAction(selectedItem, 'read')}
                  >
                    {t('conversation.notifications.actions.read')}
                  </Button>
                ) : null}
                {selectedItem.dismissible ? (
                  <Button
                    className={styles.modalActionButton}
                    type='secondary'
                    loading={pendingAction === 'dismiss'}
                    onClick={() => void runAction(selectedItem, 'dismiss')}
                  >
                    {t('conversation.notifications.actions.dismiss')}
                  </Button>
                ) : null}
                {selectedDestination ? (
                  <Button type='primary' icon={<Send size={15} />} onClick={() => openTarget(selectedItem)}>
                    {t('conversation.notifications.actions.openTarget')}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null
        }
        onCancel={() => {
          setSelectedId(undefined);
          setSelectedSnapshot(undefined);
        }}
        maskClosable
        focusLock
        unmountOnExit={false}
      >
        {detailLoading ? (
          <div className={styles.state}>
            <Spin aria-label={t('common.loading')} />
          </div>
        ) : detailError ? (
          <Alert
            type='error'
            showIcon
            content={
              isBackendHttpError(detailError) && [404, 410].includes(detailError.status)
                ? t('common.assistantSurface.messages.sourceExpired')
                : t('conversation.notifications.detailFailed')
            }
          />
        ) : selectedItem ? (
          <div className={styles.detailBody}>
            {actionError ? (
              <Alert type='error' showIcon content={t(`conversation.notifications.action.${actionError}`)} />
            ) : null}
            <div className={styles.detailSummary}>
              <div className={styles.detailLead}>
                <Inbox size={18} />
                <div>
                  <strong>{selectedItem.summary || selectedItem.title}</strong>
                  <span>{selectedItem.source}</span>
                </div>
              </div>
              <div className={styles.summaryMetric}>
                <span>{t('common.assistantSurface.messages.columns.status')}</span>
                <strong>{statusLabel(selectedItem, t)}</strong>
              </div>
              <div className={styles.summaryMetric}>
                <span>{t('common.assistantSurface.messages.businessTarget')}</span>
                <strong>{targetSummary(selectedItem)}</strong>
              </div>
              <div className={styles.summaryMetric}>
                <span>{t('common.assistantSurface.messages.columns.time')}</span>
                <strong>{new Date(selectedItem.created_at).toLocaleString()}</strong>
              </div>
            </div>
            <Tabs type='line' defaultActiveTab='detail' overflow='scroll'>
              <Tabs.TabPane key='detail' title={t('common.assistantSurface.messages.tabs.detail')}>
                <Typography.Paragraph className={styles.detailText}>
                  {selectedItem.body || selectedItem.summary || t('common.assistantSurface.messages.noDetail')}
                </Typography.Paragraph>
              </Tabs.TabPane>
              {businessSections.map((section) => (
                <Tabs.TabPane key={section.key} title={section.title}>
                  <Typography.Paragraph className={styles.detailText}>{section.content}</Typography.Paragraph>
                </Tabs.TabPane>
              ))}
              <Tabs.TabPane key='target' title={t('common.assistantSurface.messages.tabs.target')}>
                <div className={styles.targetGrid}>
                  <span>{t('common.assistantSurface.messages.businessTarget')}</span>
                  <strong>{selectedItem.target.type}</strong>
                  <span>{t('common.assistantSurface.messages.targetIdentifier')}</span>
                  <strong>{targetSummary(selectedItem)}</strong>
                  <span>{t('common.assistantSurface.messages.source')}</span>
                  <strong>{selectedItem.source}</strong>
                </div>
              </Tabs.TabPane>
            </Tabs>
          </div>
        ) : null}
      </Modal>
    </main>
  );
};

export default BusinessMessageInbox;
