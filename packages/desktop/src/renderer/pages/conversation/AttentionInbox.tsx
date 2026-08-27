import { ipcBridge } from '@/common';
import type { ApprovalTask } from '@/common/types/approval';
import type { InteractionRequest } from '@/common/types/interactionRequest';
import { Alert, Badge, Button, Drawer, Empty, Message, Spin, Tabs, Tag, Typography } from '@arco-design/web-react';
import { Audit, CloseSmall } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR, { mutate as swrMutate } from 'swr';
import { useTalkToButler } from '@/renderer/hooks/assistant/useTalkToButler';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import {
  fetchActiveInteractionRequests,
  INTERACTION_REQUESTS_ACTIVE_KEY,
  interactionRequestActions,
  requireAcceptedInteractionReceipt,
} from '@/renderer/services/interactionRequestActions';
import { fetchActiveNotifications, notificationInboxKey } from '@/renderer/services/notificationInbox';
import { FeishuApprovalInbox } from './ApprovalPrototype';
import { NotificationInbox } from './NotificationInbox';
import styles from './ApprovalPrototype/ApprovalPrototype.module.css';

type AttentionInboxProps = {
  onNavigate?: () => void;
};

const DEMAND_FORECAST_DEFINITION_CODE = '1DA97CD8-B406-4A76-A39E-CFCB5AFEBB60';
const SALES_FORECAST_SOURCE_LABEL = '销售预测 Web';
const SALES_FORECAST_SKILL_ID = 'sales-forecast-submit';

const decisionContent = (request: InteractionRequest): { prompt?: string; options: string[] } => {
  const presentation = request.presentation;
  if (!presentation) return { options: [] };
  if (presentation.type === 'question') {
    return {
      prompt: presentation.questions
        .map((question) => question.question)
        .filter(Boolean)
        .join(' / '),
      options: presentation.questions.flatMap((question) =>
        question.options.map((option) => (option.description ? `${option.label}：${option.description}` : option.label))
      ),
    };
  }
  return {
    prompt: presentation.description || presentation.title,
    options: presentation.options.map((option) => option.label),
  };
};

type InteractionDecisionAction = {
  actionId: string;
  label: string;
  payload?: Record<string, unknown>;
  tone: 'accept' | 'reject';
};

type InteractionDecisionFallbackLabels = {
  answer: string;
  decline: string;
};

const decisionActions = (
  request: InteractionRequest,
  fallbackLabels: InteractionDecisionFallbackLabels
): InteractionDecisionAction[] => {
  const presentation = request.presentation;
  if (!presentation) {
    // AionCore can expose a valid pending request with only its authoritative allowed actions.
    return [
      request.allowed_actions.includes('answer')
        ? { actionId: 'answer', label: fallbackLabels.answer, tone: 'accept' as const }
        : undefined,
      request.allowed_actions.includes('decline')
        ? { actionId: 'decline', label: fallbackLabels.decline, tone: 'reject' as const }
        : undefined,
    ].filter((action): action is InteractionDecisionAction => action !== undefined);
  }
  if (presentation.type === 'permission') {
    return presentation.options.map((option, index) => ({
      actionId: option.value,
      label: option.label,
      tone: index === 0 ? 'accept' : 'reject',
    }));
  }
  if (presentation.questions.length !== 1) return [];
  const question = presentation.questions[0];
  if (question.multiSelect || question.options.length !== 2) return [];
  return [
    {
      actionId: 'answer',
      label: question.options[0].label,
      payload: {
        answers: [{ question: question.question, labels: [question.options[0].label] }],
      },
      tone: 'accept',
    },
    {
      actionId: 'decline',
      label: question.options[1].label,
      tone: 'reject',
    },
  ];
};

export const AttentionInbox: React.FC<AttentionInboxProps> = ({ onNavigate }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const talkToButler = useTalkToButler();
  const { status, user } = useAuth();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<'notification' | 'approval' | 'interaction'>('approval');
  const [openingRequestId, setOpeningRequestId] = useState<string | null>(null);
  const [selectedInteractionId, setSelectedInteractionId] = useState<string | null>(null);
  const [submittingInteractionAction, setSubmittingInteractionAction] = useState<string | null>(null);
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
  const { data: notifications } = useSWR(
    status === 'authenticated' && user ? notificationInboxKey(user.id) : null,
    () => fetchActiveNotifications()
  );
  const pendingApprovals = approvals?.pending ?? [];
  const doneApprovals = approvals?.done ?? [];
  const interactionItems = interactions?.items ?? [];
  const unreadNotifications = notifications?.items.filter((item) => item.status === 'unread').length ?? 0;
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
        presentation: {
          type: 'question',
          questions: [
            {
              question: t('conversation.attention.demo.forecastTitle'),
              multiSelect: false,
              options: [{ label: t('common.confirm') }, { label: t('common.cancel') }],
            },
          ],
        },
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
        presentation: {
          type: 'permission',
          title: t('conversation.attention.demo.customerReviewTitle'),
          description: t('conversation.attention.demo.customerReviewSummary'),
          operation: 'review',
          options: [
            { label: t('common.confirm'), value: 'approve' },
            { label: t('common.cancel'), value: 'reject' },
          ],
        },
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
        presentation: {
          type: 'permission',
          title: t('conversation.attention.demo.dmsSubmitTitle'),
          description: t('conversation.attention.demo.dmsSubmitSummary'),
          operation: 'submit',
          options: [
            { label: t('common.confirm'), value: 'proceed_once' },
            { label: t('common.cancel'), value: 'cancel' },
          ],
        },
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
  const selectedInteractionRequest =
    visibleInteractionItems.find((request) => request.id === selectedInteractionId) ?? visibleInteractionItems[0];
  const selectedInteractionDecision = selectedInteractionRequest
    ? decisionContent(selectedInteractionRequest)
    : undefined;
  const selectedInteractionActions = selectedInteractionRequest
    ? decisionActions(selectedInteractionRequest, {
        answer: t('conversation.attention.interactionCard.confirm'),
        decline: t('conversation.attention.interactionCard.cancel'),
      })
    : [];
  const pendingCount = unreadNotifications + pendingApprovals.length + interactionItems.length;
  const syncWarning = interactions?.sync_state === 'partial' || interactions?.sync_state === 'failed';

  useEffect(() => {
    if (selectedInteractionRequest?.id !== selectedInteractionId) {
      setSelectedInteractionId(selectedInteractionRequest?.id ?? null);
    }
  }, [selectedInteractionId, selectedInteractionRequest?.id]);

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
    async (request: InteractionRequest) => {
      if (request.source.label?.trim() === SALES_FORECAST_SOURCE_LABEL) {
        setOpeningRequestId(request.id);
        try {
          const assistants = await ipcBridge.assistants.list.invoke();
          const candidates = assistants.filter((candidate) =>
            [...(candidate.enabled_skills ?? []), ...(candidate.custom_skill_names ?? [])].includes(
              SALES_FORECAST_SKILL_ID
            )
          );
          const assistant = candidates.find((candidate) => candidate.source !== 'generated') ?? candidates[0];
          if (!assistant) {
            Message.error(t('conversation.attention.salesForecast.assistantUnavailable'));
            return;
          }
          if (!assistant.enabled) {
            await ipcBridge.assistants.setState.invoke({ id: assistant.id, enabled: true });
            await swrMutate('assistants.list');
          }
          setVisible(false);
          onNavigate?.();
          void navigate('/guid', {
            state: {
              selectedAssistantId: assistant.id,
              prefillPrompt: t('conversation.attention.salesForecast.startPrompt', {
                skillId: SALES_FORECAST_SKILL_ID,
                requestId: request.id,
                title: request.title,
                summary: request.summary || '—',
                source: request.source.label,
              }),
              autoSendPrefill: true,
              requiredSkillId: SALES_FORECAST_SKILL_ID,
            },
          });
        } catch (error) {
          console.error('[AttentionInbox] Failed to start sales forecast:', error);
          Message.error(t('conversation.attention.salesForecast.startFailed'));
        } finally {
          setOpeningRequestId(null);
        }
        return;
      }
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
    [navigate, onNavigate, t]
  );

  const submitInteractionAction = useCallback(
    async (request: InteractionRequest, actionId: string, payload?: Record<string, unknown>) => {
      const submissionKey = `${request.id}:${actionId}`;
      setSubmittingInteractionAction(submissionKey);
      try {
        const receipt = await interactionRequestActions.submit({
          request_id: request.id,
          expected_version: request.version,
          action_id: actionId,
          payload,
        });
        requireAcceptedInteractionReceipt(receipt);
        await refreshInteractions();
      } catch {
        Message.error(t('conversation.attention.interactionCard.actionFailed'));
      } finally {
        setSubmittingInteractionAction(null);
      }
    },
    [refreshInteractions, t]
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
          onChange={(key) => setSource(key as 'notification' | 'approval' | 'interaction')}
        >
          <Tabs.TabPane key='notification' title={`${t('conversation.notifications.title')} ${unreadNotifications}`} />
          <Tabs.TabPane
            key='approval'
            title={t('conversation.attention.sourceTabs.approval', { count: pendingApprovals.length })}
          />
          <Tabs.TabPane
            key='interaction'
            title={t('conversation.attention.sourceTabs.interaction', { count: visibleInteractionItems.length })}
          />
        </Tabs>
        {source === 'notification' ? (
          <div className='p-12px'>
            <NotificationInbox embedded onNavigate={onNavigate} onRequestClose={close} />
          </div>
        ) : source === 'approval' ? (
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
          <div className={styles.workspace}>
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
              <div className={styles.workspaceBody} data-testid='interaction-request-workspace'>
                <aside className={styles.listPane}>
                  <div className={styles.listHeader}>
                    <Typography.Text className={styles.listTitle}>
                      {t('conversation.attention.interactionCard.listTitle')}
                    </Typography.Text>
                    <Typography.Text className={styles.listCount}>
                      {t('conversation.attention.interactionCard.listCount', {
                        count: visibleInteractionItems.length,
                      })}
                    </Typography.Text>
                  </div>
                  <div className={styles.listScroll} role='list' data-testid='interaction-request-list'>
                    {visibleInteractionItems.map((request) => {
                      const selected = selectedInteractionRequest?.id === request.id;
                      return (
                        <Button
                          key={request.id}
                          type='text'
                          long
                          className={`${styles.listCard} ${selected ? styles.listCardSelected : ''}`}
                          onClick={() => setSelectedInteractionId(request.id)}
                          aria-pressed={selected}
                          aria-label={t('conversation.attention.interactionCard.open', { title: request.title })}
                          data-testid={`attention-request-${request.id}`}
                        >
                          <span className={styles.listCardContent}>
                            <span className={styles.cardTopline}>
                              <Tag size='small'>
                                {request.source.label || t(`conversation.attention.source.${request.source.type}`)}
                              </Tag>
                              <Tag
                                size='small'
                                color={request.stale ? 'orange' : 'green'}
                                data-testid={request.stale ? `attention-request-${request.id}-stale` : undefined}
                              >
                                {request.stale
                                  ? t('conversation.attention.stale')
                                  : t('conversation.attention.interactionCard.pending')}
                              </Tag>
                            </span>
                            <Typography.Text className={styles.cardTitle}>{request.title}</Typography.Text>
                            {request.summary ? (
                              <span className={styles.cardSummary}>
                                <span className={styles.cardSummaryText}>{request.summary}</span>
                              </span>
                            ) : null}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </aside>
                <main className={styles.detailPane}>
                  {selectedInteractionRequest && selectedInteractionDecision ? (
                    <div className={styles.detail} data-testid={`interaction-detail-${selectedInteractionRequest.id}`}>
                      <header className={styles.detailHeader}>
                        <div className={styles.detailTitleRow}>
                          <Typography.Title heading={5} className={styles.detailTitle}>
                            {selectedInteractionRequest.title}
                          </Typography.Title>
                          <Tag size='small' color={selectedInteractionRequest.stale ? 'orange' : 'green'}>
                            {selectedInteractionRequest.stale
                              ? t('conversation.attention.stale')
                              : t('conversation.attention.interactionCard.pending')}
                          </Tag>
                        </div>
                        <div className={styles.detailMeta}>
                          <Tag size='small'>
                            {selectedInteractionRequest.source.label ||
                              t(`conversation.attention.source.${selectedInteractionRequest.source.type}`)}
                          </Tag>
                        </div>
                      </header>
                      <div className={styles.detailContent}>
                        {selectedInteractionRequest.summary ? (
                          <section className={styles.section}>
                            <Typography.Text className={styles.interactionDetailSummary}>
                              {selectedInteractionRequest.summary}
                            </Typography.Text>
                          </section>
                        ) : null}
                        {selectedInteractionDecision.prompt ? (
                          <section className={styles.section}>
                            <Typography.Title heading={6} className={styles.sectionTitle}>
                              {t('conversation.attention.interactionCard.questionTitle')}
                            </Typography.Title>
                            <Typography.Text className={styles.interactionDetailQuestion}>
                              {selectedInteractionDecision.prompt}
                            </Typography.Text>
                            {selectedInteractionDecision.options.length > 0 ? (
                              <div className={styles.interactionDetailOptions}>
                                {selectedInteractionDecision.options.map((option, index) => (
                                  <div className={styles.interactionDetailOption} key={`${option}-${index}`}>
                                    <span className={styles.interactionOptionIndex}>{index + 1}</span>
                                    <span>{option}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </section>
                        ) : null}
                      </div>
                      <footer className={styles.actionBar}>
                        <Button
                          type='secondary'
                          disabled={showInteractionDemo || selectedInteractionRequest.stale}
                          loading={openingRequestId === selectedInteractionRequest.id}
                          onClick={() => void openInteractionRequest(selectedInteractionRequest)}
                          data-testid={`interaction-open-${selectedInteractionRequest.id}`}
                        >
                          {t('conversation.attention.interactionCard.process')}
                        </Button>
                        <div className={styles.actionGroup}>
                          {selectedInteractionActions.map((action) => {
                            const submissionKey = `${selectedInteractionRequest.id}:${action.actionId}`;
                            return (
                              <Button
                                key={`${action.actionId}:${action.label}`}
                                type={action.tone === 'accept' ? 'primary' : 'secondary'}
                                status={action.tone === 'accept' ? 'success' : 'danger'}
                                disabled={
                                  showInteractionDemo ||
                                  selectedInteractionRequest.stale ||
                                  !selectedInteractionRequest.allowed_actions.includes(action.actionId)
                                }
                                loading={submittingInteractionAction === submissionKey}
                                onClick={() =>
                                  void submitInteractionAction(
                                    selectedInteractionRequest,
                                    action.actionId,
                                    action.payload
                                  )
                                }
                                data-testid={`interaction-action-${selectedInteractionRequest.id}-${action.actionId}`}
                              >
                                {action.label}
                              </Button>
                            );
                          })}
                        </div>
                      </footer>
                    </div>
                  ) : (
                    <Empty description={t('conversation.attention.interactionCard.detailEmpty')} />
                  )}
                </main>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
};
