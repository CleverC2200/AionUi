/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ConversationPreparation, createAionCoreConversationPreparationAdapter } from '@/common/adapter/conversation';
import { type ChatFileRef, chatFileRefPath } from '@/common/types/chatFile';
import type { IMcpServer, TProviderWithModel } from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { ConversationPreparationIssue } from '@/common/types/conversationConfiguration';
import { toSessionMcpServer } from '@/renderer/hooks/mcp/catalog';
import { emitter } from '@/renderer/utils/emitter';
import { updateWorkspaceTime } from '@/renderer/utils/workspace/workspaceHistory';
import { Message } from '@arco-design/web-react';
import { useCallback, useRef, useState } from 'react';
import { type TFunction } from 'i18next';
import type { NavigateFunction } from 'react-router-dom';
import { mutate as swrMutate } from 'swr';
import { getConversationCreateErrorMessage } from '@/renderer/pages/conversation/utils/conversationCreateError';
import type { AcpModelInfo } from '../types';

export type GuidSendDeps = {
  // Input state
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  files: ChatFileRef[];
  setFiles: React.Dispatch<React.SetStateAction<ChatFileRef[]>>;
  dir: string;
  setDir: React.Dispatch<React.SetStateAction<string>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  loading: boolean;

  // Assistant state
  selectedAssistantId: string | null;
  selectedAssistant?: Assistant;
  selectedAssistantBackend: string;
  selectedMode: string;
  selectedAcpModel: string | null;
  selectedThoughtLevelValue?: string;
  currentAcpCachedModelInfo: AcpModelInfo | null;
  current_model: TProviderWithModel | undefined;

  guidDisabledBuiltinSkills: string[] | undefined;
  guidEnabledSkills: string[] | undefined;
  assistantDefaultSkillIds?: string[];
  assistantDefaultDisabledBuiltinSkillIds?: string[];
  availableMcpServers: IMcpServer[];
  selectedMcpServerIds: string[] | undefined;
  assistantDefaultMcpIds?: string[];
  isGoogleAuth: boolean;

  // Mention state reset
  setMentionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMentionQuery: React.Dispatch<React.SetStateAction<string | null>>;
  setMentionSelectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setMentionActiveIndex: React.Dispatch<React.SetStateAction<number>>;

  // Navigation
  navigate: NavigateFunction;
  t: TFunction;
  localeKey: string;
};

export type GuidSendResult = {
  handleSend: () => Promise<void>;
  sendMessageHandler: () => void;
  isButtonDisabled: boolean;
  preparationState: 'blocked' | 'idle' | 'preparing' | 'ready';
  preparationIssues: ConversationPreparationIssue[];
  cancelPreparation: () => void;
};

class ConversationPreparationBlockedError extends Error {
  constructor(readonly issues: ConversationPreparationIssue[]) {
    super(issues[0]?.message || issues[0]?.code || 'CONVERSATION_PREPARATION_BLOCKED');
    this.name = 'ConversationPreparationBlockedError';
  }
}

const createPreparationIdempotencyKey = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `conversation-preparation-${Date.now()}`;

const preparationFingerprint = (value: unknown): string => JSON.stringify(value);

/**
 * Hook that manages the send logic for ACP and Aion CLI conversations.
 */
export const useGuidSend = (deps: GuidSendDeps): GuidSendResult => {
  const {
    input,
    setInput,
    files,
    setFiles,
    dir,
    setDir,
    setLoading,
    loading,
    selectedAssistantId,
    selectedAssistant,
    selectedAssistantBackend,
    selectedMode,
    selectedAcpModel,
    selectedThoughtLevelValue,
    currentAcpCachedModelInfo,
    current_model,
    guidDisabledBuiltinSkills,
    guidEnabledSkills,
    assistantDefaultSkillIds,
    assistantDefaultDisabledBuiltinSkillIds,
    availableMcpServers,
    selectedMcpServerIds,
    assistantDefaultMcpIds,
    setMentionOpen,
    setMentionQuery,
    setMentionSelectorOpen,
    setMentionActiveIndex,
    navigate,
    t,
    localeKey,
  } = deps;
  const sendingRef = useRef(false);
  const preparationIdempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const conversationPreparationRef = useRef(
    new ConversationPreparation(
      createAionCoreConversationPreparationAdapter((request) =>
        ipcBridge.conversation.prepareConfiguration.invoke(request)
      )
    )
  );
  const [preparationState, setPreparationState] = useState<GuidSendResult['preparationState']>('idle');
  const [preparationIssues, setPreparationIssues] = useState<ConversationPreparationIssue[]>([]);

  const cancelPreparation = useCallback(() => {
    conversationPreparationRef.current.cancel();
    setPreparationState('idle');
    setPreparationIssues([]);
  }, []);

  const handleSend = useCallback(async () => {
    if (!selectedAssistantId) {
      return;
    }

    const isCustomWorkspace = !!dir;
    const finalWorkspace = dir || '';

    const assistantConversationId = selectedAssistantId;
    const assistantBackend = selectedAssistantBackend;
    const enabled_skills_to_send = guidEnabledSkills ?? assistantDefaultSkillIds;
    const excludeBuiltinSkills = guidDisabledBuiltinSkills ?? assistantDefaultDisabledBuiltinSkillIds;
    const selectedAllMcpServerIds = selectedMcpServerIds ?? [];
    const selectedMcpServerIdSet = new Set(selectedAllMcpServerIds);
    const selectedUserMcpServerIds = availableMcpServers
      .filter((server) => selectedMcpServerIdSet.has(server.id) && server.builtin !== true)
      .map((server) => server.id);
    const selectedSessionMcpServers = availableMcpServers
      .filter((server) => selectedMcpServerIdSet.has(server.id) && server.builtin === true)
      .map((server) => toSessionMcpServer(server));
    const defaultSelectedMcpServerIds = assistantDefaultMcpIds;
    const defaultSelectedUserMcpServerIds = availableMcpServers
      .filter((server) => (defaultSelectedMcpServerIds ?? []).includes(server.id) && server.builtin !== true)
      .map((server) => server.id);
    const assistantOverrideMcpIds =
      selectedMcpServerIds !== undefined ? selectedAllMcpServerIds : defaultSelectedMcpServerIds;
    const selectedUserMcpServerIdsToSend =
      selectedMcpServerIds !== undefined ? selectedUserMcpServerIds : defaultSelectedUserMcpServerIds;
    const selectedSessionMcpServersToSend =
      selectedMcpServerIds !== undefined
        ? selectedSessionMcpServers
        : availableMcpServers
            .filter((server) => (defaultSelectedMcpServerIds ?? []).includes(server.id) && server.builtin === true)
            .map((server) => toSessionMcpServer(server));

    // `current_model` is the aionrs provider selection and means nothing to a
    // CLI agent, which owns its own model list. Used as a blanket fallback it
    // leaked into the FIRST turn of every CLI conversation: before the agent's
    // catalog has been probed the two preceding options are empty, so a brand
    // new Antigravity conversation started with e.g. `gemini-3.1-pro-preview`
    // — a provider model agy has never heard of — and the turn failed with
    // USER_LLM_PROVIDER_MODEL_NOT_FOUND. Once the catalog lands the second
    // option wins, which is why it only ever reproduced on first use.
    //
    // Omitting it lets the agent start on its own default, which is what a user
    // who has not picked a model means. The cron dialog already gates the same
    // value this way (`resolvedBackend !== 'aionrs' → undefined`).
    const assistantOverrideModel =
      assistantBackend === 'aionrs'
        ? current_model?.use_model
        : selectedAcpModel || currentAcpCachedModelInfo?.current_model_id || undefined;
    const assistantOverrides = {
      model: assistantOverrideModel,
      permission: selectedMode || undefined,
      thought_level: selectedThoughtLevelValue || undefined,
      skill_ids: enabled_skills_to_send,
      disabled_builtin_skill_ids: excludeBuiltinSkills,
      mcp_ids: assistantOverrideMcpIds,
    };
    if (assistantBackend === 'aionrs' && !current_model) {
      setPreparationState('idle');
      setPreparationIssues([]);
      Message.warning(t('conversation.noModelConfigured'));
      return;
    }
    const fingerprint = preparationFingerprint({
      assistant_id: assistantConversationId,
      managed: selectedAssistant?.managed,
      locale: localeKey,
      workspace: finalWorkspace || undefined,
      overrides: assistantOverrides,
    });
    if (preparationIdempotencyRef.current?.fingerprint !== fingerprint) {
      preparationIdempotencyRef.current = { fingerprint, key: createPreparationIdempotencyKey() };
    }
    setPreparationState('preparing');
    setPreparationIssues([]);
    const preparationResult = await conversationPreparationRef.current.prepare({
      assistant: selectedAssistant ?? { id: assistantConversationId, source: 'user' },
      locale: localeKey,
      idempotencyKey: preparationIdempotencyRef.current.key,
      workspace: finalWorkspace || undefined,
      overrides: assistantOverrides,
    });
    if (preparationResult.status === 'cancelled') {
      setPreparationState('idle');
      throw new Error('CONVERSATION_PREPARATION_CANCELLED');
    }
    if (preparationResult.status === 'blocked') {
      setPreparationState('blocked');
      setPreparationIssues(preparationResult.issues);
      throw new ConversationPreparationBlockedError(preparationResult.issues);
    }
    setPreparationState('ready');
    const preparation = preparationResult.preparation ?? undefined;
    const managedCreateRequest = preparation ? { preparation } : null;

    if (assistantBackend === 'aionrs') {
      try {
        const conversation = await ipcBridge.conversation.create.invoke(
          managedCreateRequest ?? {
            name: input,
            model: current_model,
            assistant: {
              id: assistantConversationId,
              locale: localeKey,
              conversation_overrides: assistantOverrides,
            },
            extra: {
              default_files: files.map(chatFileRefPath),
              workspace: finalWorkspace,
              custom_workspace: isCustomWorkspace,
              selected_mcp_server_ids: selectedUserMcpServerIdsToSend,
              selected_session_mcp_servers: selectedSessionMcpServersToSend,
            },
          }
        );

        if (!conversation || !conversation.id) {
          Message.error(t('conversation.createFailed'));
          return;
        }

        if (isCustomWorkspace) {
          updateWorkspaceTime(finalWorkspace);
        }

        if (assistantConversationId) {
          await Promise.all([
            swrMutate(`guid.assistant.detail.${assistantConversationId}.${localeKey}`),
            swrMutate('assistants.list'),
          ]);
        }

        emitter.emit('chat.history.refresh');

        // Empty input = "start chat": create the conversation but do not stash an
        // initial message, so the window opens idle on the empty state instead of
        // auto-sending a blank first turn.
        if (input.trim()) {
          const initialMessage = {
            input,
            files: files.length > 0 ? files : undefined,
          };
          sessionStorage.setItem(`aionrs_initial_message_${conversation.id}`, JSON.stringify(initialMessage));
        }

        preparationIdempotencyRef.current = null;
        await navigate(`/conversation/${conversation.id}`);
      } catch (error: unknown) {
        console.error('Failed to create Aion CLI conversation:', error);
        throw error;
      }
      return;
    }

    try {
      const conversation = await ipcBridge.conversation.create.invoke(
        managedCreateRequest ?? {
          name: input,
          assistant: {
            id: assistantConversationId,
            locale: localeKey,
            conversation_overrides: assistantOverrides,
          },
          extra: {
            workspace: finalWorkspace,
            custom_workspace: isCustomWorkspace,
            default_files: files.map(chatFileRefPath),
            selected_mcp_server_ids: selectedUserMcpServerIdsToSend,
            selected_session_mcp_servers: selectedSessionMcpServersToSend,
          },
        }
      );
      if (!conversation || !conversation.id) {
        console.error('Failed to create ACP conversation - conversation object is null or missing id');
        return;
      }

      if (isCustomWorkspace) {
        updateWorkspaceTime(finalWorkspace);
      }

      if (assistantConversationId) {
        await Promise.all([
          swrMutate(`guid.assistant.detail.${assistantConversationId}.${localeKey}`),
          swrMutate('assistants.list'),
        ]);
      }

      emitter.emit('chat.history.refresh');

      // Empty input = "start chat": create the conversation but do not stash an
      // initial message, so the window opens idle on the empty state instead of
      // auto-sending a blank first turn.
      if (input.trim()) {
        const initialMessage = {
          input,
          files: files.length > 0 ? files : undefined,
        };
        sessionStorage.setItem(`acp_initial_message_${conversation.id}`, JSON.stringify(initialMessage));
      }

      preparationIdempotencyRef.current = null;
      await navigate(`/conversation/${conversation.id}`);
    } catch (error: unknown) {
      console.error('Failed to create ACP conversation:', error);
      throw error;
    }
  }, [
    input,
    files,
    dir,
    selectedAssistantId,
    selectedAssistant,
    selectedAssistantBackend,
    selectedMode,
    selectedAcpModel,
    selectedThoughtLevelValue,
    currentAcpCachedModelInfo,
    current_model,
    guidDisabledBuiltinSkills,
    guidEnabledSkills,
    assistantDefaultSkillIds,
    assistantDefaultDisabledBuiltinSkillIds,
    availableMcpServers,
    selectedMcpServerIds,
    assistantDefaultMcpIds,
    navigate,
    t,
    localeKey,
  ]);

  const sendMessageHandler = useCallback(() => {
    if (loading || sendingRef.current) return;
    sendingRef.current = true;
    setLoading(true);
    handleSend()
      .then(() => {
        setInput('');
        setMentionOpen(false);
        setMentionQuery(null);
        setMentionSelectorOpen(false);
        setMentionActiveIndex(0);
        setFiles([]);
        setDir('');
      })
      .catch((error) => {
        console.error('Failed to send message:', error);
        if (!(error instanceof Error && error.message === 'CONVERSATION_PREPARATION_CANCELLED')) {
          Message.error(getConversationCreateErrorMessage(error, t));
        }
      })
      .finally(() => {
        sendingRef.current = false;
        setLoading(false);
      });
  }, [
    loading,
    handleSend,
    setLoading,
    setInput,
    setMentionOpen,
    setMentionQuery,
    setMentionSelectorOpen,
    setMentionActiveIndex,
    setFiles,
    setDir,
    t,
  ]);

  // Calculate button disabled state
  // Calculate button disabled state. Empty input is allowed once an assistant is
  // picked — that path creates an empty conversation ("start chat") rather than
  // sending a message, so the gate only blocks while loading or with no assistant.
  const isButtonDisabled = loading || !selectedAssistantId;

  return {
    handleSend,
    sendMessageHandler,
    isButtonDisabled,
    preparationState,
    preparationIssues,
    cancelPreparation,
  };
};
