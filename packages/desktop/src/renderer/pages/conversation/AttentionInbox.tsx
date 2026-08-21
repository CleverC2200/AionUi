import { ipcBridge } from '@/common';
import { isRouteUnavailableError } from '@/common/adapter/sidebarCompatibility';
import type { ApprovalTask } from '@/common/types/approval';
import type { InteractionRequest } from '@/common/types/interactionRequest';
import { Alert, Badge, Button, Drawer, Empty, Tabs, Typography } from '@arco-design/web-react';
import { Audit, CloseSmall, Right } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { useTalkToButler } from '@/renderer/hooks/assistant/useTalkToButler';
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
    isValidating: interactionRefreshing,
    mutate: refreshInteractions,
  } = useSWR('interaction-requests.pending', async () => {
    try {
      return await ipcBridge.interactionRequest.list.invoke();
    } catch (requestError) {
      if (isRouteUnavailableError(requestError)) return { revision: 'unsupported', items: [] };
      throw requestError;
    }
  });
  const pendingApprovals = approvals?.pending ?? [];
  const doneApprovals = approvals?.done ?? [];
  const interactionItems = interactions?.items ?? [];
  const pendingCount = pendingApprovals.length + interactionItems.length;

  useEffect(() => {
    const refresh = (): void => {
      void refreshInteractions();
    };
    const offChanged = ipcBridge.interactionRequest.changed.on(refresh);
    const offReconnected = ipcBridge.realtime.reconnected.on(() => {
      refresh();
      void refreshApprovals();
    });
    return () => {
      offChanged();
      offReconnected();
    };
  }, [refreshApprovals, refreshInteractions]);

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
            title={t('conversation.attention.sourceTabs.interaction', { count: interactionItems.length })}
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
        ) : interactionItems.length ? (
          <div className='flex flex-col gap-8px p-12px' role='list' data-testid='interaction-request-list'>
            {interactionItems.map((request) => (
              <Button
                key={request.id}
                type='secondary'
                className='!h-auto !p-12px !justify-start !items-start !text-left'
                onClick={() => openInteractionRequest(request)}
                data-testid={`attention-request-${request.id}`}
              >
                <span className='flex min-w-0 w-full items-center gap-10px'>
                  <span className='flex-1 min-w-0'>
                    <Typography.Text className='block font-600 text-t-primary'>{request.title}</Typography.Text>
                    {request.summary ? (
                      <Typography.Text className='block mt-3px text-12px text-t-secondary' ellipsis>
                        {request.summary}
                      </Typography.Text>
                    ) : null}
                  </span>
                  <Right theme='outline' size='16' className='shrink-0 text-t-tertiary' />
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <Empty description={t('conversation.attention.interactionEmpty')} />
        )}
      </Drawer>
    </>
  );
};
