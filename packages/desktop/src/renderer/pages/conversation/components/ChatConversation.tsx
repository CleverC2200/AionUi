/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IConversationMcpStatus, IProvider, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import { uuid } from '@/common/utils';
import addChatIcon from '@/renderer/assets/icons/add-chat.svg';
import { CronJobManager } from '@/renderer/pages/cron';
import { resolveCronJobId } from '@/renderer/pages/cron/cronUtils';
import { usePresetAssistantInfo } from '@/renderer/hooks/agent/usePresetAssistantInfo';
import { iconColors } from '@/renderer/styles/colors';
import { Button, Dropdown, Menu, Message, Tooltip, Typography } from '@arco-design/web-react';
import { History } from '@icon-park/react';
import React, { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { emitter } from '../../../utils/emitter';
import AcpChat from '../platforms/acp/AcpChat';
import ChatLayout from './ChatLayout';
import ChatSlider from './ChatSlider.tsx';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { getConversationCreateErrorMessage } from '@/renderer/pages/conversation/utils/conversationCreateError';
import AionrsChat from '../platforms/aionrs/AionrsChat';
import { useAionrsModelSelection } from '../platforms/aionrs/useAionrsModelSelection';
import { useConversationRuntimeView } from '../runtime/useConversationRuntimeView';
import { isLegacyReadOnlyConversationType } from '../utils/conversationRuntime';
import { resolveConversationBackend } from '../utils/conversationAssistantIdentity';
import LegacyReadOnlyConversation from '../platforms/legacy/LegacyReadOnlyConversation';
import SingleChatEmptyState from './SingleChatEmptyState';
import { useActiveLease } from '../hooks/useActiveLease';
import type { SurfaceContextSnapshot } from '@/renderer/pages/assistantSurface/surfaceContext';
// import SkillRuleGenerator from './components/SkillRuleGenerator'; // Temporarily hidden

const _AssociatedConversation: React.FC<{ conversation_id: string }> = ({ conversation_id }) => {
  const { data } = useSWR(['getAssociateConversation', conversation_id], () =>
    ipcBridge.conversation.getAssociateConversation.invoke({ conversation_id })
  );
  const navigate = useNavigate();
  const list = useMemo(() => {
    if (!data?.length) return [];
    return data.filter((conversation) => conversation.id !== conversation_id);
  }, [data]);
  if (!list.length) return null;
  return (
    <Dropdown
      droplist={
        <Menu
          onClickMenuItem={(key) => {
            Promise.resolve(navigate(`/conversation/${key}`)).catch((error) => {
              console.error('Navigation failed:', error);
            });
          }}
        >
          {list.map((conversation) => {
            return (
              <Menu.Item key={conversation.id}>
                <Typography.Ellipsis className={'max-w-300px'}>{conversation.name}</Typography.Ellipsis>
              </Menu.Item>
            );
          })}
        </Menu>
      }
      trigger={['click']}
    >
      <Button
        size='mini'
        icon={
          <History
            theme='filled'
            size='14'
            fill={iconColors.primary}
            strokeWidth={2}
            strokeLinejoin='miter'
            strokeLinecap='square'
          />
        }
      ></Button>
    </Dropdown>
  );
};

export const createConversationFromConversation = async (
  conversation: TChatConversation
): Promise<TChatConversation> => {
  const id = uuid();
  // Fetch the latest record so session mode and workspace metadata match the real Conversation source.
  const latest = await getConversationOrNull(conversation.id);
  const source = latest || conversation;
  const createdConversation = {
    ...source,
    id,
    created_at: Date.now(),
    modified_at: Date.now(),
    // A new chat must not inherit an ACP/Antigravity resume anchor from the source Conversation.
    extra:
      source.type === 'acp' || source.type === 'antigravity'
        ? { ...source.extra, acp_session_id: undefined, acp_session_updated_at: undefined }
        : source.extra,
  } as TChatConversation;
  const persistedConversation = await ipcBridge.conversation.createWithConversation.invoke({
    conversation: createdConversation,
  });
  emitter.emit('chat.history.refresh');
  return persistedConversation;
};

const _AddNewConversation: React.FC<{ conversation: TChatConversation }> = ({ conversation }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isCreatingRef = useRef(false);
  if (!conversation.extra?.workspace) return null;
  return (
    <Tooltip content={t('conversation.workspace.createNewConversation')}>
      <Button
        size='mini'
        icon={<img src={addChatIcon} alt='Add chat' className='w-14px h-14px block m-auto' />}
        onClick={async () => {
          if (isCreatingRef.current) return;
          isCreatingRef.current = true;
          try {
            const createdConversation = await createConversationFromConversation(conversation);
            void navigate(`/conversation/${createdConversation.id}`);
          } catch (error) {
            console.error('Failed to create conversation:', error);
            Message.error(getConversationCreateErrorMessage(error, t));
          } finally {
            isCreatingRef.current = false;
          }
        }}
      />
    </Tooltip>
  );
};

type AionrsConversation = Extract<TChatConversation, { type: 'aionrs' }>;

const AionrsConversationPanel: React.FC<{
  conversation: AionrsConversation;
  sliderTitle: React.ReactNode;
  embedded?: boolean;
  embeddedHeaderExtra?: React.ReactNode;
  surfaceContext?: SurfaceContextSnapshot;
  scrollPersistenceKey?: string;
}> = ({ conversation, sliderTitle, embedded, embeddedHeaderExtra, surfaceContext, scrollPersistenceKey }) => {
  const runtimeView = useConversationRuntimeView(conversation.id);
  const onSelectModel = useCallback(
    async (_provider: IProvider, modelName: string) => {
      const selected = { ..._provider, use_model: modelName } as TProviderWithModel;
      // Kill running agent on model switch — will be rebuilt with new model on next message
      if (runtimeView.activeTurnId) {
        const result = await ipcBridge.conversation.stop.invoke({
          conversation_id: conversation.id,
          turn_id: runtimeView.activeTurnId,
        });
        runtimeView.markStopAcknowledged(runtimeView.activeTurnId, result.runtime);
      }
      const ok = await ipcBridge.conversation.update.invoke({ id: conversation.id, updates: { model: selected } });
      return Boolean(ok);
    },
    [conversation.id, runtimeView]
  );

  const modelSelection = useAionrsModelSelection({
    initialModel: conversation.model,
    onSelectModel,
  });
  // Project conversations get the Layout-level Explorer column (stage3 FULL);
  // ChatLayout's own right sider is only for no-project (legacy tree), so it does
  // not double up or reserve an empty column.
  const workspaceEnabled = Boolean(conversation.extra?.workspace) && !conversation.project_id;
  const cronJobId = resolveCronJobId(conversation.extra);
  const { info: presetAssistantInfo } = usePresetAssistantInfo(conversation);
  const aionrsAssistantId = presetAssistantInfo?.assistantId;

  const chatLayoutProps = {
    title: conversation.name,
    siderTitle: sliderTitle,
    sider: <ChatSlider conversation={conversation} />,
    headerExtra: (
      <div className='flex items-center gap-8px'>
        {embeddedHeaderExtra}
        <CronJobManager conversation_id={conversation.id} cron_job_id={cronJobId} />
      </div>
    ),
    workspaceEnabled: embedded ? false : workspaceEnabled,
    embedded,
    // For project conversations the preview panel is hoisted to the Layout-level
    // project host (structurally persistent across same-project conversation
    // switches — no remount). ChatLayout then renders chat only.
    previewHosted: Boolean(conversation.project_id),
    workspacePath: conversation.extra?.workspace,
    // Key the workspace-panel collapse preference per-project (falls back to
    // conversation_id inside ChatLayout when there is no project) so the panel's
    // open/closed state restores when switching conversations within a project.
    workspacePreferenceKey: conversation.project_id,
    isTemporaryWorkspace: (conversation.extra as { is_temporary_workspace?: boolean } | undefined)
      ?.is_temporary_workspace,
    backend: 'aionrs' as const,
    presetAssistant: presetAssistantInfo ? { ...presetAssistantInfo, id: aionrsAssistantId } : undefined,
  };

  const emptySlot = (
    <SingleChatEmptyState
      conversation_id={conversation.id}
      assistant_name={presetAssistantInfo?.name}
      assistant_backend={presetAssistantInfo?.backend}
    />
  );

  return (
    <ChatLayout {...chatLayoutProps} conversation_id={conversation.id}>
      <AionrsChat
        conversation_id={conversation.id}
        workspace={conversation.extra.workspace}
        emptySlot={emptySlot}
        modelSelection={modelSelection}
        session_mode={conversation.extra?.session_mode}
        cron_job_id={cronJobId}
        loadedSkills={(conversation.extra as { skills?: string[] } | undefined)?.skills}
        loadedMcpServers={(conversation.extra as { mcp_servers?: string[] } | undefined)?.mcp_servers}
        loadedMcpStatuses={
          (conversation.extra as { mcp_statuses?: IConversationMcpStatus[] } | undefined)?.mcp_statuses
        }
        agent_name={presetAssistantInfo?.name}
        assistantId={aionrsAssistantId}
        forkCapability={conversation.fork_capability}
        surfaceContext={surfaceContext}
        scrollPersistenceKey={scrollPersistenceKey}
        hideConversationResources={embedded}
        compactComposerControls={embedded}
      />
    </ChatLayout>
  );
};

const ChatConversation: React.FC<{
  conversation?: TChatConversation;
  hideSendBox?: boolean;
  embedded?: boolean;
  embeddedHeaderExtra?: React.ReactNode;
  surfaceContext?: SurfaceContextSnapshot;
  scrollPersistenceKey?: string;
}> = ({ conversation, hideSendBox, embedded, embeddedHeaderExtra, surfaceContext, scrollPersistenceKey }) => {
  const { t } = useTranslation();
  useActiveLease({ type: 'conversation', id: conversation?.id });
  const workspaceEnabled = Boolean(conversation?.extra?.workspace) && !conversation?.project_id;
  const cronJobId = resolveCronJobId(conversation?.extra);

  const isAionrsConversation = conversation?.type === 'aionrs';
  const isLegacyReadOnlyConversation = isLegacyReadOnlyConversationType(conversation?.type);
  const resolvedHideSendBox = hideSendBox || isLegacyReadOnlyConversationType(conversation?.type);

  // 使用统一的 Hook 获取预设助手信息（ACP/Codex 会话）
  // Use unified hook for preset assistant info (ACP/Codex conversations)
  const acpConversation = isAionrsConversation ? undefined : conversation;
  const { info: presetAssistantInfo, isLoading: isLoadingPreset } = usePresetAssistantInfo(acpConversation);
  const acpAssistantId = presetAssistantInfo?.assistantId;
  const resolvedConversationBackend = resolveConversationBackend(conversation, presetAssistantInfo?.backend);

  const conversationAgentName = (conversation?.extra as { agent_name?: string } | undefined)?.agent_name;
  const assistantDisplayName = presetAssistantInfo?.name || conversationAgentName;

  const conversationNode = useMemo(() => {
    if (!conversation || isAionrsConversation) return null;
    // Greeting shown while the conversation has no messages yet (freshly created
    // or cloned window). Each *Chat forwards it to MessageList's empty slot.
    const emptySlot = (
      <SingleChatEmptyState
        conversation_id={conversation.id}
        assistant_name={assistantDisplayName}
        assistant_backend={resolvedConversationBackend}
      />
    );
    if (isLegacyReadOnlyConversation) {
      return <LegacyReadOnlyConversation key={conversation.id} conversation={conversation} emptySlot={emptySlot} />;
    }
    switch (conversation.type) {
      case 'acp':
      // Antigravity reports its own conversation type but renders through the
      // ACP chat surface: same extra payload, same event stream, same send box.
      // Without this case it falls to `default: null` — the chat area renders
      // empty, no send box mounts, and the queued initial message in
      // `acp_initial_message_<id>` is never delivered, so the turn never starts.
      case 'antigravity':
        return (
          <AcpChat
            key={conversation.id}
            conversation_id={conversation.id}
            workspace={conversation.extra?.workspace}
            backend={resolvedConversationBackend || 'claude'}
            session_mode={conversation.extra?.session_mode}
            agent_name={assistantDisplayName}
            cron_job_id={cronJobId}
            hideSendBox={resolvedHideSendBox}
            emptySlot={emptySlot}
            loadedSkills={(conversation.extra as { skills?: string[] } | undefined)?.skills}
            loadedMcpServers={(conversation.extra as { mcp_servers?: string[] } | undefined)?.mcp_servers}
            loadedMcpStatuses={
              (conversation.extra as { mcp_statuses?: IConversationMcpStatus[] } | undefined)?.mcp_statuses
            }
            assistantId={acpAssistantId}
            forkCapability={conversation.fork_capability}
            promptCapability={conversation.prompt_capability}
            surfaceContext={surfaceContext}
            scrollPersistenceKey={scrollPersistenceKey}
            hideConversationResources={embedded}
            compactComposerControls={embedded}
          ></AcpChat>
        );
      default:
        return null;
    }
  }, [
    conversation,
    isAionrsConversation,
    isLegacyReadOnlyConversation,
    resolvedConversationBackend,
    assistantDisplayName,
    cronJobId,
    resolvedHideSendBox,
    acpAssistantId,
    embedded,
    surfaceContext,
    scrollPersistenceKey,
  ]);

  const sliderTitle = useMemo(() => {
    return (
      <div className='flex items-center justify-between'>
        <span className='text-16px font-bold text-t-primary'>{t('conversation.workspace.title')}</span>
      </div>
    );
  }, [t]);

  if (conversation && conversation.type === 'aionrs') {
    return (
      <AionrsConversationPanel
        key={conversation.id}
        conversation={conversation}
        sliderTitle={sliderTitle}
        embedded={embedded}
        embeddedHeaderExtra={embeddedHeaderExtra}
        surfaceContext={surfaceContext}
        scrollPersistenceKey={scrollPersistenceKey}
      />
    );
  }

  // 如果有预设助手信息，使用预设助手的 logo 和名称；加载中时不进入 fallback；否则使用 backend 的 logo
  // If preset assistant info exists, use preset logo/name; while loading, avoid fallback; otherwise use backend logo
  const chatLayoutProps = presetAssistantInfo
    ? {
        presetAssistant: { ...presetAssistantInfo, id: acpAssistantId },
      }
    : isLoadingPreset
      ? {} // Still loading custom agents — avoid showing backend logo prematurely
      : {
          backend: resolvedConversationBackend,
          agent_name: conversationAgentName,
        };

  const headerExtraNode = (
    <div className='flex items-center gap-8px'>
      {embeddedHeaderExtra}
      {conversation && (
        <div className='shrink-0'>
          <CronJobManager conversation_id={conversation.id} cron_job_id={cronJobId} />
        </div>
      )}
    </div>
  );

  return (
    <ChatLayout
      title={conversation?.name}
      {...chatLayoutProps}
      headerExtra={headerExtraNode}
      siderTitle={sliderTitle}
      sider={<ChatSlider conversation={conversation} />}
      workspaceEnabled={workspaceEnabled}
      previewHosted={Boolean(conversation?.project_id)}
      workspacePath={conversation?.extra?.workspace}
      workspacePreferenceKey={conversation?.project_id}
      isTemporaryWorkspace={
        (conversation?.extra as { is_temporary_workspace?: boolean } | undefined)?.is_temporary_workspace
      }
      conversation_id={conversation?.id}
      embedded={embedded}
    >
      {conversationNode}
    </ChatLayout>
  );
};

export default ChatConversation;
