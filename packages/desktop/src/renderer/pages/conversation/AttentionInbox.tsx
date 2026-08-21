import { ipcBridge } from '@/common';
import type { ApprovalTask } from '@/common/types/approval';
import type { InteractionRequest } from '@/common/types/interactionRequest';
import { Alert, Badge, Button, Drawer, Empty, Spin, Tabs, Tag, Typography } from '@arco-design/web-react';
import { Audit, CloseSmall, Right } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { useTalkToButler } from '@/renderer/hooks/assistant/useTalkToButler';
import {
  fetchActiveInteractionRequests,
  INTERACTION_REQUESTS_ACTIVE_KEY,
} from '@/renderer/services/interactionRequestActions';
import { FeishuApprovalInbox } from './ApprovalPrototype';
import styles from './ApprovalPrototype/ApprovalPrototype.module.css';

type AttentionInboxProps = {
  onNavigate?: () => void;
};

const DEMAND_FORECAST_DEFINITION_CODE = '1DA97CD8-B406-4A76-A39E-CFCB5AFEBB60';

export const AttentionInbox: React.FC<AttentionInboxProps> = ({ onNavigate }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const talkToButler = useTalkToButler();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<'approval' | 'interaction'>('approval');
  const loadApprovalTopic = useCallback(async (topic: 'pending' | 'done'): Promise<ApprovalTask[]> => {
    const tasks: ApprovalTask[] = [];
    let pageToken: string | undefined;
    do {
      // Page tokens are issued by the preceding Feishu response, so these requests are intentionally sequential.
      // eslint-disable-next-line no-await-in-loop
      const page = await ipcBridge.feishuApproval.list.invoke({
        topic,
        definitionCode: topic === 'done' ? DEMAND_FORECAST_DEFINITION_CODE : undefined,
        pageSize: 100,
        pageToken,
      });
      tasks.push(...page.tasks);
      pageToken = page.hasMore ? page.pageToken : undefined;
    } while (pageToken);
    return tasks;
  }, []);
  const {
    data: approvals,
    error: approvalError,
    isLoading: approvalLoading,
    mutate: refreshApprovals,
  } = useSWR(
    'feishu-approvals:inbox',
    async () => {
      const [pending, done] = await Promise.all([loadApprovalTopic('pending'), loadApprovalTopic('done')]);
      return { pending, done };
    },
    { refreshInterval: visible ? 30_000 : 0 }
  );
  const {
    data: interactions,
    error: interactionError,
    isLoading: interactionLoading,
    isValidating: interactionRefreshing,
    mutate: refreshInteractions,
  } = useSWR(INTERACTION_REQUESTS_ACTIVE_KEY, fetchActiveInteractionRequests);
  const pendingApprovals = approvals?.pending ?? [];
  const doneApprovals = approvals?.done ?? [];
  const interactionItems = interactions?.items ?? [];
  const demoInteractionItems = useMemo<InteractionRequest[]>(
    () => [
      {
        id: 'demo-forecast-scope',
        version: 'demo-v1',
        kind: 'question',
        status: 'pending',
        title: t('conversation.attention.demo.forecastTitle'),
        summary: t('conversation.attention.demo.forecastSummary'),
        source: { type: 'agent', label: t('conversation.attention.source.agent') },
        conversation_id: 'demo-conversation',
        allowed_actions: ['answer'],
        updated_at: '2026-08-21T01:00:00.000Z',
        stale: false,
      },
      {
        id: 'demo-customer-review',
        version: 'demo-v1',
        kind: 'permission',
        status: 'pending',
        title: t('conversation.attention.demo.customerReviewTitle'),
        summary: t('conversation.attention.demo.customerReviewSummary'),
        source: { type: 'team_agent', label: t('conversation.attention.source.team_agent') },
        conversation_id: 'demo-conversation',
        team_id: 'demo-team',
        slot_id: 'demo-reviewer',
        allowed_actions: ['approve', 'reject'],
        updated_at: '2026-08-21T01:05:00.000Z',
        stale: false,
      },
      {
        id: 'demo-dms-submit',
        version: 'demo-v1',
        kind: 'permission',
        status: 'pending',
        title: t('conversation.attention.demo.dmsSubmitTitle'),
        summary: t('conversation.attention.demo.dmsSubmitSummary'),
        source: { type: 'business_system', label: t('conversation.attention.source.business_system') },
        conversation_id: 'demo-conversation',
        allowed_actions: ['proceed_once', 'cancel'],
        updated_at: '2026-08-21T01:10:00.000Z',
        stale: true,
      },
    ],
    [t]
  );
  const showInteractionDemo =
    process.env.NODE_ENV !== 'production' &&
    interactions !== undefined &&
    !interactionError &&
    interactionItems.length === 0;
  const visibleInteractionItems = showInteractionDemo ? demoInteractionItems : interactionItems;
  const pendingCount = pendingApprovals.length + interactionItems.length;
  const syncWarning = interactions?.sync_state === 'partial' || interactions?.sync_state === 'failed';

  useEffect(() => {
    const offReconnected = ipcBridge.realtime.reconnected.on(() => {
      void refreshApprovals();
    });
    return () => {
      offReconnected();
    };
  }, [refreshApprovals]);

  const close = useCallback(() => {
    setVisible(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const openInteractionRequest = useCallback(
    (request: InteractionRequest) => {
      setVisible(false);
      onNavigate?.();
      void navigate(request.team_id ? `/team/${request.team_id}` : `/conversation/${request.conversation_id}`, {
        state: {
          targetMessageId: request.message_id,
          targetSlotId: request.slot_id,
          interactionRequestId: request.id,
          returnFocus: 'attention-inbox',
        },
      });
    },
    [navigate, onNavigate]
  );

  const startHandling = useCallback(
    (item: ApprovalTask, opinion: string) => {
      setVisible(false);
      onNavigate?.();
      void talkToButler({
        prompt: t('conversation.attention.approval.actions.handlePromptReal', {
          taskId: item.taskId,
          instanceCode: item.instanceCode,
          title: item.title,
          definitionName: item.definitionName,
          initiator: item.initiatorName || item.initiatorId || '—',
          summaries: item.summaries.map((summary) => `${summary.key}：${summary.value}`).join('\n') || '—',
          opinion: opinion.trim() || t('conversation.attention.approval.actions.opinionEmpty'),
        }),
      });
    },
    [onNavigate, t, talkToButler]
  );

  return (
    <>
      <Button
        ref={triggerRef}
        long
        type='text'
        className={`${styles.triggerButton} !h-34px !px-10px !text-t-primary hover:!bg-fill-2`}
        icon={<Audit theme='outline' size='17' />}
        onClick={() => setVisible(true)}
        aria-label={t('conversation.attention.open', { count: pendingCount })}
        data-testid='attention-inbox-trigger'
      >
        <span className={styles.triggerLabel}>{t('conversation.attention.title')}</span>
        {pendingCount > 0 ? (
          <Badge count={pendingCount} maxCount={99} className='shrink-0' data-testid='attention-inbox-count' />
        ) : null}
      </Button>
      <Drawer
        width='min(1120px, calc(100vw - 48px))'
        title={t('conversation.attention.title')}
        visible={visible}
        onCancel={close}
        closeIcon={
          <Button
            type='text'
            shape='circle'
            className={styles.drawerCloseButton}
            icon={<CloseSmall theme='outline' size='16' />}
            onClick={(event) => {
              event.stopPropagation();
              close();
            }}
            aria-label={t('common.close')}
            data-testid='attention-inbox-close'
          />
        }
        footer={null}
        bodyStyle={{ height: 'auto', minHeight: 0 }}
        unmountOnExit={false}
        getPopupContainer={() => document.body}
        className={styles.drawer}
        data-testid='attention-inbox-drawer'
      >
        <Tabs
          className={styles.sourceTabs}
          activeTab={source}
          onChange={(key) => setSource(key as 'approval' | 'interaction')}
        >
          <Tabs.TabPane
            key='approval'
            title={t('conversation.attention.sourceTabs.approval', { count: pendingApprovals.length })}
          />
          <Tabs.TabPane
            key='interaction'
            title={t('conversation.attention.sourceTabs.interaction', { count: visibleInteractionItems.length })}
          />
        </Tabs>
        {source === 'approval' ? (
          <FeishuApprovalInbox
            pendingItems={pendingApprovals}
            doneItems={doneApprovals}
            loading={approvalLoading}
            error={approvalError}
            onRefresh={refreshApprovals}
            onStartHandling={startHandling}
          />
        ) : interactionLoading ? (
          <div className='py-48px flex-center'>
            <Spin aria-label={t('common.loading', { defaultValue: 'Loading…' })} />
          </div>
        ) : interactionError ? (
          <Alert
            type='error'
            showIcon
            content={
              <div className='flex items-center justify-between gap-8px'>
                <span>{t('conversation.attention.interactionLoadFailed')}</span>
                <Button size='mini' loading={interactionRefreshing} onClick={() => void refreshInteractions()}>
                  {t('common.retry')}
                </Button>
              </div>
            }
          />
        ) : (
          <div className='flex flex-col gap-12px'>
            {showInteractionDemo ? (
              <Alert
                type='info'
                showIcon
                content={
                  <span className='flex items-center gap-8px'>
                    <Tag size='small' color='blue'>
                      {t('conversation.attention.demo.label')}
                    </Tag>
                    <span>{t('conversation.attention.demo.description')}</span>
                  </span>
                }
                data-testid='interaction-demo-notice'
              />
            ) : null}
            {syncWarning ? (
              <Alert
                type='warning'
                showIcon
                content={t(
                  interactions?.sync_state === 'failed'
                    ? 'conversation.attention.syncFailed'
                    : 'conversation.attention.syncPartial',
                  { count: interactions?.failed_session_count ?? 0 }
                )}
                action={
                  <Button size='mini' loading={interactionRefreshing} onClick={() => void refreshInteractions()}>
                    {t('common.retry', { defaultValue: 'Retry' })}
                  </Button>
                }
                data-testid='attention-sync-warning'
              />
            ) : null}
            {visibleInteractionItems.length === 0 ? (
              <Empty description={t('conversation.attention.interactionEmpty')} />
            ) : (
              <div className='flex flex-col gap-8px p-12px' role='list' data-testid='interaction-request-list'>
                {visibleInteractionItems.map((request) => (
                  <Button
                    key={request.id}
                    type='secondary'
                    className='!h-auto !p-12px !justify-start !items-start !text-left'
                    disabled={showInteractionDemo}
                    onClick={() => openInteractionRequest(request)}
                    data-testid={`attention-request-${request.id}`}
                  >
                    <span className='flex min-w-0 w-full items-center gap-10px'>
                      <span className='flex-1 min-w-0'>
                        <span className='flex items-center gap-6px'>
                          <Typography.Text className='font-600 text-t-primary'>{request.title}</Typography.Text>
                          {request.stale ? (
                            <Tag size='small' color='orange' data-testid={`attention-request-${request.id}-stale`}>
                              {t('conversation.attention.stale')}
                            </Tag>
                          ) : null}
                        </span>
                        {request.summary ? (
                          <Typography.Text className='block mt-3px text-12px text-t-secondary' ellipsis>
                            {request.summary}
                          </Typography.Text>
                        ) : null}
                        <Typography.Text className='block mt-5px text-12px text-t-tertiary'>
                          {request.source.label || t(`conversation.attention.source.${request.source.type}`)}
                        </Typography.Text>
                      </span>
                      <Right theme='outline' size='16' className='shrink-0 text-t-tertiary' />
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
};
