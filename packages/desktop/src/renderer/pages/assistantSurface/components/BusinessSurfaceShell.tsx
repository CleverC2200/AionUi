import { ipcBridge } from '@/common';
import { ConversationPreparation, createAionCoreConversationPreparationAdapter } from '@/common/adapter/conversation';
import type { TChatConversation } from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import ChatConversation, {
  createConversationFromConversation,
} from '@/renderer/pages/conversation/components/ChatConversation';
import { getConversationCreateErrorMessage } from '@/renderer/pages/conversation/utils/conversationCreateError';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { useConversationRuntimeView } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';
import { getActivityTime } from '@/renderer/utils/chat/timeline';
import { addEventListener, emitter } from '@/renderer/utils/emitter';
import { Alert, Button, Drawer, Empty, Message, Spin, Steps, Tag, Tooltip } from '@arco-design/web-react';
import { AddOne, Comments, Data, History, Refresh, Robot } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mutate as swrMutate } from 'swr';
import type { AssistantSurfaceId } from '../registry';
import { readAssistantSurfaceState, writeAssistantSurfaceState } from '../storage';
import type { SurfaceContextSnapshot } from '../surfaceContext';
import styles from './BusinessSurfaceShell.module.css';

type SpecializedSurfaceId = Exclude<AssistantSurfaceId, 'general'>;
type SupportedConversation = Extract<TChatConversation, { type: 'aionrs' | 'acp' | 'antigravity' }>;

const RECENT_CONVERSATION_LIMIT = 50;
const SALES_FORECAST_SKILL_ID = 'sales-forecast-submit';
const createPreparationIdempotencyKey = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `conversation-preparation-${Date.now()}`;

const BusinessSurfaceSessionContext = React.createContext<{ conversationId: string | null }>({
  conversationId: null,
});

export const useBusinessSurfaceSession = () => React.useContext(BusinessSurfaceSessionContext);

const isSupportedConversation = (conversation: TChatConversation): conversation is SupportedConversation =>
  conversation.type === 'aionrs' || conversation.type === 'acp' || conversation.type === 'antigravity';

const findPreferredForecastAssistant = (assistants: Assistant[]): Assistant | undefined => {
  const candidates = assistants.filter((candidate) =>
    [...(candidate.enabled_skills ?? []), ...(candidate.custom_skill_names ?? [])].includes(SALES_FORECAST_SKILL_ID)
  );
  return candidates.find((candidate) => candidate.source !== 'generated') ?? candidates[0];
};

const isConversationForAssistant = (
  conversation: TChatConversation,
  assistantId: string
): conversation is SupportedConversation => {
  const extra = conversation.extra;
  const belongsToTeam = typeof extra === 'object' && extra !== null && ('team_id' in extra || 'teamId' in extra);
  return isSupportedConversation(conversation) && conversation.assistant?.id === assistantId && !belongsToTeam;
};

const conversationOptionLabel = (conversation: SupportedConversation) => {
  const assistantName = conversation.assistant?.name?.trim();
  return assistantName ? `${conversation.name} · ${assistantName}` : conversation.name;
};

const ActiveTurnTag: React.FC<{
  surfaceId: SpecializedSurfaceId;
  conversationId: string;
}> = ({ surfaceId, conversationId }) => {
  const { t } = useTranslation();
  const runtime = useConversationRuntimeView(conversationId);
  if (!runtime.isProcessing || !runtime.activeTurnId) return null;
  return (
    <Tag size='small' color='blue' data-testid={`${surfaceId}-active-turn`}>
      {t('common.assistantSurface.activeTurn', {
        defaultValue: '运行中 · {{turnId}}',
        turnId: runtime.activeTurnId,
      })}
    </Tag>
  );
};

type BusinessSurfaceShellProps = React.PropsWithChildren<{
  surfaceId: SpecializedSurfaceId;
  stateScope: string;
  surfaceContext?: SurfaceContextSnapshot;
  surfaceContextConversationId?: string | null;
  agentName: string;
  conversationTitle: string;
  selectConversationLabel: string;
  boardLabel: string;
  fixtureBoundary?: string;
  workflowSteps: readonly string[];
  workflowCurrent: number;
}>;

const DesktopConversationRail: React.FC<{
  surfaceId: SpecializedSurfaceId;
  title: string;
  header: React.ReactNode;
  body: React.ReactNode;
}> = ({ surfaceId, title, header, body }) => {
  return (
    <aside className={styles.conversationRegion} data-testid={`${surfaceId}-conversation-region`} aria-label={title}>
      {header}
      <div className={styles.conversationBody}>{body}</div>
    </aside>
  );
};

const BusinessSurfaceShell: React.FC<BusinessSurfaceShellProps> = ({
  surfaceId,
  stateScope,
  surfaceContext,
  surfaceContextConversationId,
  agentName,
  conversationTitle,
  selectConversationLabel,
  boardLabel,
  fixtureBoundary,
  workflowSteps,
  workflowCurrent,
  children,
}) => {
  const { i18n, t } = useTranslation();
  const [conversations, setConversations] = useState<SupportedConversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [, setLastSharedRevision] = useState<number | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState(() =>
    readAssistantSurfaceState<string | null>(surfaceId, `${stateScope}:conversation-binding`, null)
  );
  const selectedConversationIdRef = useRef(selectedConversationId);
  const preferredAssistantRef = useRef<Assistant | undefined>(undefined);
  const conversationPreparationRef = useRef(
    new ConversationPreparation(
      createAionCoreConversationPreparationAdapter((request) =>
        ipcBridge.conversation.prepareConfiguration.invoke(request)
      )
    )
  );

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const resolvePreferredAssistant = useCallback(async () => {
    const assistant = findPreferredForecastAssistant(await ipcBridge.assistants.list.invoke());
    preferredAssistantRef.current = assistant;
    return assistant;
  }, []);

  const refreshConversations = useCallback(() => {
    setLoadingConversations(true);
    setLoadError(false);
    void ipcBridge.database.getUserConversations
      .invoke({ limit: RECENT_CONVERSATION_LIMIT })
      .then(async (result) => {
        const assistant = await resolvePreferredAssistant();
        let next = (result?.items ?? [])
          .filter((conversation): conversation is SupportedConversation =>
            assistant ? isConversationForAssistant(conversation, assistant.id) : false
          )
          .toSorted((a, b) => getActivityTime(b) - getActivityTime(a));

        const boundConversationId = selectedConversationIdRef.current;
        if (boundConversationId && !next.some((conversation) => conversation.id === boundConversationId)) {
          const boundConversation = await getConversationOrNull(boundConversationId);
          if (boundConversation && assistant && isConversationForAssistant(boundConversation, assistant.id)) {
            next = [boundConversation, ...next];
          }
        }

        setConversations(next);
        setSelectedConversationId((current) =>
          current && next.some((conversation) => conversation.id === current) ? current : null
        );
      })
      .catch((error) => {
        console.error(`[${surfaceId}AssistantSurface] Failed to load conversations:`, error);
        setLoadError(true);
        setConversations([]);
      })
      .finally(() => setLoadingConversations(false));
  }, [resolvePreferredAssistant, surfaceId]);

  useEffect(() => {
    refreshConversations();
    return addEventListener('chat.history.refresh', refreshConversations);
  }, [refreshConversations]);

  useEffect(() => {
    writeAssistantSurfaceState(surfaceId, `${stateScope}:conversation-binding`, selectedConversationId);
    setLastSharedRevision(
      selectedConversationId
        ? readAssistantSurfaceState<number | null>(
            surfaceId,
            `${stateScope}:conversation:${selectedConversationId}:last-shared-revision`,
            null
          )
        : null
    );
  }, [selectedConversationId, stateScope, surfaceId]);

  useEffect(
    () =>
      addEventListener('assistant-surface.context-sent', (event) => {
        if (event.surfaceId !== surfaceId) return;
        writeAssistantSurfaceState(
          surfaceId,
          `${stateScope}:conversation:${event.conversationId}:last-shared-revision`,
          event.revision
        );
        if (event.conversationId === selectedConversationId) setLastSharedRevision(event.revision);
      }),
    [selectedConversationId, stateScope, surfaceId]
  );

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId),
    [conversations, selectedConversationId]
  );

  const createConversation = useCallback(async () => {
    if (creatingConversation) return;
    const sourceConversation = selectedConversation ?? conversations[0];
    setCreatingConversation(true);
    try {
      const assistant = preferredAssistantRef.current ?? (await resolvePreferredAssistant());
      if (!assistant) {
        Message.error(t('conversation.attention.salesForecast.assistantUnavailable'));
        return;
      }
      let created: TChatConversation;
      if (sourceConversation) {
        created = await createConversationFromConversation(sourceConversation);
      } else {
        if (!assistant.enabled) {
          await ipcBridge.assistants.setState.invoke({ id: assistant.id, enabled: true });
          await swrMutate('assistants.list');
        }
        const preparationResult = await conversationPreparationRef.current.prepare({
          assistant,
          locale: i18n.language,
          idempotencyKey: createPreparationIdempotencyKey(),
          overrides: {},
        });
        if (preparationResult.status !== 'ready') {
          Message.error(t('conversation.attention.salesForecast.startFailed'));
          return;
        }
        created = await ipcBridge.conversation.create.invoke(
          preparationResult.preparation
            ? { preparation: preparationResult.preparation }
            : {
                name: conversationTitle,
                assistant: { id: assistant.id, locale: i18n.language, conversation_overrides: {} },
                extra: {},
              }
        );
      }
      if (!isConversationForAssistant(created, assistant.id)) return;
      setConversations((current) => [created, ...current.filter((conversation) => conversation.id !== created.id)]);
      selectedConversationIdRef.current = created.id;
      setSelectedConversationId(created.id);
      if (!sourceConversation) emitter.emit('chat.history.refresh');
    } catch (error) {
      console.error(`[${surfaceId}AssistantSurface] Failed to create conversation:`, error);
      Message.error(getConversationCreateErrorMessage(error, t));
    } finally {
      setCreatingConversation(false);
    }
  }, [
    conversationTitle,
    conversations,
    creatingConversation,
    i18n.language,
    resolvePreferredAssistant,
    selectedConversation,
    surfaceId,
    t,
  ]);
  const activeSurfaceContext =
    surfaceContext && surfaceContextConversationId === selectedConversationId ? surfaceContext : undefined;

  const conversationBody = loadingConversations ? (
    <div className={styles.conversationState}>
      <Spin />
      <span>{t('common.assistantSurface.loadingConversations', { defaultValue: '正在加载对话…' })}</span>
    </div>
  ) : loadError ? (
    <div className={styles.conversationState}>
      <Alert
        type='error'
        showIcon
        content={t('common.assistantSurface.conversationLoadFailed', { defaultValue: '对话加载失败。' })}
      />
      <Button icon={<Refresh size={14} />} onClick={refreshConversations}>
        {t('common.retry')}
      </Button>
    </div>
  ) : selectedConversation ? (
    <ChatConversation
      conversation={selectedConversation}
      embedded
      surfaceContext={activeSurfaceContext}
      scrollPersistenceKey={`aionui:assistant-surface:${surfaceId}:${stateScope}:conversation:${selectedConversation.id}:scroll`}
    />
  ) : (
    <div className={styles.conversationState}>
      <Empty
        icon={<Comments size={36} />}
        description={t('common.assistantSurface.explicitConversationBinding', {
          defaultValue: '请选择一个对话。工作台不会自动把业务上下文发送到未确认的会话。',
        })}
      />
      <Button type='primary' loading={creatingConversation} onClick={() => void createConversation()}>
        {t('common.assistantSurface.createConversation', { defaultValue: '新建 AI 对话' })}
      </Button>
    </div>
  );

  const historyBody = loadingConversations ? (
    <div className={styles.historyState}>
      <Spin />
      <span>{t('common.assistantSurface.loadingConversations', { defaultValue: '正在加载对话…' })}</span>
    </div>
  ) : loadError ? (
    <div className={styles.historyState}>
      <Alert
        type='error'
        showIcon
        content={t('common.assistantSurface.conversationLoadFailed', { defaultValue: '对话加载失败。' })}
      />
      <Button icon={<Refresh size={14} />} onClick={refreshConversations}>
        {t('common.retry')}
      </Button>
    </div>
  ) : conversations.length === 0 ? (
    <div className={styles.historyState}>
      <Empty description={t('common.assistantSurface.chooseConversation', { defaultValue: '选择对话' })} />
    </div>
  ) : (
    <div className={styles.historyList} role='listbox' aria-label={selectConversationLabel}>
      {conversations.map((conversation) => (
        <Button
          key={conversation.id}
          type='text'
          long
          className={styles.historyItem}
          data-selected={conversation.id === selectedConversationId}
          role='option'
          aria-selected={conversation.id === selectedConversationId}
          onClick={() => {
            setSelectedConversationId(conversation.id);
            setHistoryOpen(false);
          }}
        >
          {conversationOptionLabel(conversation)}
        </Button>
      ))}
    </div>
  );

  const conversationHeader = (
    <header className={styles.conversationHeader}>
      <div className={styles.conversationHeading}>
        <Robot size={16} />
        <span className={styles.agentName}>{agentName}</span>
        {selectedConversationId ? (
          <ActiveTurnTag surfaceId={surfaceId} conversationId={selectedConversationId} />
        ) : null}
      </div>
      <div className={styles.conversationControls}>
        <Tooltip content={t('common.assistantSurface.conversationHistory', { defaultValue: '历史对话' })}>
          <Button
            type='text'
            size='mini'
            icon={<History size={15} />}
            aria-label={t('common.assistantSurface.conversationHistory', { defaultValue: '历史对话' })}
            data-testid={`${surfaceId}-conversation-select`}
            onClick={() => setHistoryOpen(true)}
          />
        </Tooltip>
        <Tooltip content={t('common.assistantSurface.newConversation', { defaultValue: '新对话' })}>
          <Button
            type='text'
            size='mini'
            icon={<AddOne size={15} />}
            loading={creatingConversation}
            aria-label={t('common.assistantSurface.newConversation', { defaultValue: '新对话' })}
            data-testid={`${surfaceId}-new-conversation`}
            onClick={() => void createConversation()}
          />
        </Tooltip>
      </div>
    </header>
  );

  return (
    <>
      <div className={styles.root} data-testid={`assistant-surface-${surfaceId}`}>
        <section className={styles.boardRegion} data-testid={`${surfaceId}-board-region`} aria-label={boardLabel}>
          {workflowSteps.length > 0 ? (
            <div
              className={styles.taskRoute}
              aria-label={t('common.assistantSurface.workflow', { defaultValue: 'Agent 任务航线' })}
            >
              <Steps current={workflowCurrent} size='small'>
                {workflowSteps.map((step) => (
                  <Steps.Step key={step} title={step} />
                ))}
              </Steps>
            </div>
          ) : null}
          <BusinessSurfaceSessionContext.Provider value={{ conversationId: selectedConversationId }}>
            <div className={styles.boardContent}>{children}</div>
          </BusinessSurfaceSessionContext.Provider>
          {fixtureBoundary ? (
            <footer className={styles.fixtureBoundary} data-testid={`${surfaceId}-fixture-boundary`}>
              <Data size={13} />
              {fixtureBoundary}
            </footer>
          ) : null}
        </section>

        <DesktopConversationRail
          key={selectedConversationId ?? 'unbound'}
          surfaceId={surfaceId}
          title={conversationTitle}
          header={conversationHeader}
          body={<div className={styles.realConversation}>{conversationBody}</div>}
        />
      </div>
      <Drawer
        wrapClassName={styles.historyDrawerWrapper}
        width={320}
        title={t('common.assistantSurface.conversationHistory', { defaultValue: '历史对话' })}
        visible={historyOpen}
        footer={null}
        unmountOnExit
        onCancel={() => setHistoryOpen(false)}
      >
        <div className={styles.historyPanel} data-testid={`${surfaceId}-history-panel`}>
          {historyBody}
        </div>
      </Drawer>
    </>
  );
};

export default BusinessSurfaceShell;
