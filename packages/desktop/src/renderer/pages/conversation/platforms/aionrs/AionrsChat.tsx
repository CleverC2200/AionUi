/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationMcpStatus } from '@/common/config/storage';
import type { ChatFileRef } from '@/common/types/chatFile';
import type { ConversationContextValue } from '@/renderer/hooks/context/ConversationContext';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import { CHAT_SURFACE_CONTAINER_CLASS } from '@/renderer/pages/conversation/utils/chatSurfaceWidth';
import FlexFullContainer from '@renderer/components/layout/FlexFullContainer';
import MessageList from '@renderer/pages/conversation/Messages/MessageList';
import { ConversationArtifactProvider } from '@renderer/pages/conversation/Messages/artifacts';
import {
  MessageListLoadingProvider,
  MessageListProvider,
  MessagePaginationProvider,
  useMessageLstCache,
} from '@renderer/pages/conversation/Messages/hooks';
import { usePendingConfirmationsRecovery } from '@renderer/pages/conversation/Messages/usePendingConfirmationsRecovery';
import HOC from '@renderer/utils/ui/HOC';
import React, { useMemo } from 'react';
import type { TeamSendBoxRuntime } from '@/renderer/pages/team/components/teamSendRuntime';
import AionrsSendBox from './AionrsSendBox';
import type { AionrsModelSelection } from './useAionrsModelSelection';
import ConversationResourcesPortal from '../../components/ConversationResources';
import type { SurfaceContextSnapshot } from '@/renderer/pages/assistantSurface/surfaceContext';

const AionrsChat: React.FC<{
  conversation_id: string;
  workspace: string;
  modelSelection: AionrsModelSelection;
  session_mode?: string;
  cron_job_id?: string;
  emptySlot?: React.ReactNode;
  loadedSkills?: string[];
  loadedMcpServers?: string[];
  loadedMcpStatuses?: IConversationMcpStatus[];
  agent_name?: string;
  teamSendMessage?: (payload: { input: string; files: ChatFileRef[] }) => Promise<void>;
  teamRuntime?: TeamSendBoxRuntime;
  hideComposerModelSelector?: boolean;
  assistantId?: string;
  hideConversationResources?: boolean;
  forkCapability?: { at_turn: boolean };
  surfaceContext?: SurfaceContextSnapshot;
  scrollPersistenceKey?: string;
  compactComposerControls?: boolean;
}> = ({
  conversation_id,
  workspace,
  modelSelection,
  session_mode,
  cron_job_id,
  emptySlot,
  loadedSkills,
  loadedMcpServers,
  loadedMcpStatuses,
  agent_name,
  teamSendMessage,
  teamRuntime,
  hideComposerModelSelector,
  assistantId,
  hideConversationResources,
  forkCapability,
  surfaceContext,
  scrollPersistenceKey,
  compactComposerControls,
}) => {
  useMessageLstCache(conversation_id);
  usePendingConfirmationsRecovery(conversation_id);
  const conversationValue = useMemo<ConversationContextValue>(() => {
    return {
      conversation_id: conversation_id,
      workspace,
      type: 'aionrs',
      cron_job_id,
      loadedSkills,
      loadedMcpServers,
      loadedMcpStatuses,
      assistantId,
      forkCapability,
      surfaceContext,
      scrollPersistenceKey,
    };
  }, [
    conversation_id,
    workspace,
    cron_job_id,
    loadedSkills,
    loadedMcpServers,
    loadedMcpStatuses,
    assistantId,
    forkCapability,
    surfaceContext,
    scrollPersistenceKey,
  ]);

  return (
    <ConversationProvider value={conversationValue}>
      <ConversationArtifactProvider conversation_id={conversation_id}>
        {!hideConversationResources && (
          <ConversationResourcesPortal conversationId={conversation_id} workspace={workspace} />
        )}
        <div className={`${CHAT_SURFACE_CONTAINER_CLASS} flex-1 flex flex-col px-20px min-h-0`}>
          <FlexFullContainer>
            <MessageList className='flex-1' emptySlot={emptySlot} />
          </FlexFullContainer>
          <AionrsSendBox
            conversation_id={conversation_id}
            modelSelection={modelSelection}
            session_mode={session_mode}
            agent_name={agent_name}
            teamSendMessage={teamSendMessage}
            teamRuntime={teamRuntime}
            hideComposerModelSelector={hideComposerModelSelector}
            compactComposerControls={compactComposerControls}
          />
        </div>
      </ConversationArtifactProvider>
    </ConversationProvider>
  );
};

export default HOC.Wrapper(MessageListProvider, MessageListLoadingProvider, MessagePaginationProvider)(AionrsChat);
