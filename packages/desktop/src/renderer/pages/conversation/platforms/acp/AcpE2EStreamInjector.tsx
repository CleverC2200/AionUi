/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import { dispatchE2EWsEvent } from '@/common/adapter/httpBridge';
import { useAddOrUpdateMessage, useMergeLiveMessage } from '@/renderer/pages/conversation/Messages/hooks';
import React, { useEffect } from 'react';

const STREAM_TICK_MS = 35;
const ENABLED_CONVERSATION_KEY = 'aionui:e2e-message-stream-conversation-id';

type RunScenarioOptions = {
  historyPairs?: number;
  lines?: number;
  seedHistoryOnly?: boolean;
};

type InteractionQuestionFixture = {
  header?: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
};

type InteractionPermissionFixture = {
  title: string;
  description: string;
  action?: string;
  detail?: string;
  options: Array<{ label: string; value: string }>;
};

type FollowUpFixture = {
  user: string;
  assistant: string;
};

type StreamController = {
  runScenario: (options?: RunScenarioOptions) => Promise<void>;
  emitPlan: (entries: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>) => Promise<void>;
  emitInfoTip: (code: string, content: string) => Promise<void>;
  emitErrorTip: (content: string, error?: Record<string, unknown>) => Promise<void>;
  emitToolError: (toolName: string, description: string) => Promise<void>;
  emitFileChange: (path: string, oldText: string, newText: string) => Promise<void>;
  emitAgentStatusError: (agentName: string) => Promise<void>;
  emitFollowUpExchange: (fixture?: FollowUpFixture) => Promise<void>;
  emitInteractionQuestion: (requestId: string, version?: string, fixture?: InteractionQuestionFixture) => Promise<void>;
  emitInteractionPermission: (
    requestId: string,
    version?: string,
    fixture?: InteractionPermissionFixture
  ) => Promise<void>;
};

type StreamRegistry = {
  controllers: Record<string, StreamController>;
};

declare global {
  interface Window {
    __AIONUI_E2E_MESSAGE_STREAM__?: StreamRegistry;
  }
}

const createSeedMessages = (conversationId: string, historyPairs: number): TMessage[] => {
  const baseCreatedAt = Date.now() - 100_000;
  const messages: TMessage[] = [];

  for (let index = 0; index < historyPairs; index += 1) {
    messages.push({
      id: `e2e-seed-user-${index}`,
      msg_id: `e2e-seed-user-${index}`,
      conversation_id: conversationId,
      type: 'text',
      position: 'right',
      created_at: baseCreatedAt + index * 2,
      content: {
        content: `User seed message ${index + 1}: keep the list tall enough to overflow.`,
      },
    });

    messages.push({
      id: `e2e-seed-assistant-${index}`,
      msg_id: `e2e-seed-assistant-${index}`,
      conversation_id: conversationId,
      type: 'text',
      position: 'left',
      created_at: baseCreatedAt + index * 2 + 1,
      content: {
        content: `Assistant seed reply ${index + 1}: this is stable history used to create a realistic scroll range.`,
      },
    });
  }

  messages.push({
    id: 'e2e-seed-user-final',
    msg_id: 'e2e-seed-user-final',
    conversation_id: conversationId,
    type: 'text',
    position: 'right',
    created_at: baseCreatedAt + historyPairs * 2 + 1,
    content: {
      content: 'Please stream a long reply line by line so the message list keeps growing.',
    },
  });

  return messages;
};

const createStreamChunks = (lines: number): string[] => {
  return Array.from(
    { length: lines },
    (_, index) =>
      `${index + 1}. Streamed line ${index + 1} keeps extending the assistant reply to stress-test bottom-follow scrolling.\n`
  );
};

const AcpE2EStreamInjector: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const addOrUpdateMessage = useAddOrUpdateMessage();
  const mergeLiveMessage = useMergeLiveMessage();

  useEffect(() => {
    if (typeof window === 'undefined' || window.__aionuiE2ETest !== true) {
      return;
    }
    const enabledConversationId = window.sessionStorage.getItem(ENABLED_CONVERSATION_KEY);
    if (enabledConversationId !== conversationId) {
      return;
    }

    const registry = (window.__AIONUI_E2E_MESSAGE_STREAM__ ??= { controllers: {} });

    registry.controllers[conversationId] = {
      emitPlan: async (entries) => {
        const msgId = 'e2e-plan';

        mergeLiveMessage({
          id: msgId,
          msg_id: msgId,
          conversation_id: conversationId,
          type: 'plan',
          position: 'left',
          status: 'work',
          created_at: Date.now(),
          content: {
            session_id: 'e2e-session',
            entries,
          },
        });

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, STREAM_TICK_MS);
        });
      },
      runScenario: async (options?: RunScenarioOptions) => {
        const historyPairs = options?.historyPairs ?? 18;
        const lines = options?.lines ?? 160;
        const streamMsgId = `e2e-stream-${Date.now()}`;

        if (historyPairs > 0) {
          createSeedMessages(conversationId, historyPairs).forEach((message) => addOrUpdateMessage(message, true));
        }

        if (options?.seedHistoryOnly) {
          return;
        }

        const chunks = createStreamChunks(lines);
        await new Promise<void>((resolve) => {
          let chunkIndex = 0;

          const pushNextChunk = () => {
            if (chunkIndex >= chunks.length) {
              resolve();
              return;
            }

            addOrUpdateMessage({
              id: `${streamMsgId}-${chunkIndex}`,
              msg_id: streamMsgId,
              conversation_id: conversationId,
              type: 'text',
              position: 'left',
              created_at: Date.now() + chunkIndex,
              content: {
                content: chunks[chunkIndex],
              },
            });
            chunkIndex += 1;
            window.setTimeout(pushNextChunk, STREAM_TICK_MS);
          };

          pushNextChunk();
        });
      },
      emitInfoTip: async (code: string, content: string) => {
        const msgId = `e2e-info-tip-${Date.now()}`;

        addOrUpdateMessage(
          {
            id: msgId,
            msg_id: msgId,
            conversation_id: conversationId,
            type: 'tips',
            position: 'center',
            status: 'finish',
            created_at: Date.now(),
            content: {
              content,
              type: 'info',
              code,
            },
          },
          true
        );

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, STREAM_TICK_MS);
        });
      },
      emitErrorTip: async (content: string, error?: Record<string, unknown>) => {
        const msgId = `e2e-error-tip-${Date.now()}`;

        addOrUpdateMessage(
          {
            id: msgId,
            msg_id: msgId,
            conversation_id: conversationId,
            type: 'tips',
            position: 'center',
            status: 'finish',
            created_at: Date.now(),
            content: {
              content,
              type: 'error',
              ...(error ? { error } : {}),
            },
          } as unknown as TMessage,
          true
        );

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, STREAM_TICK_MS);
        });
      },
      emitToolError: async (toolName: string, description: string) => {
        const msgId = `e2e-tool-error-${Date.now()}`;

        addOrUpdateMessage(
          {
            id: msgId,
            msg_id: msgId,
            conversation_id: conversationId,
            type: 'tool_group',
            position: 'left',
            status: 'finish',
            created_at: Date.now(),
            content: [
              {
                call_id: `${msgId}-call`,
                name: toolName,
                status: 'Error',
                description,
              },
            ],
          } as unknown as TMessage,
          true
        );

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, STREAM_TICK_MS);
        });
      },
      emitFileChange: async (path: string, oldText: string, newText: string) => {
        const msgId = `e2e-file-change-${Date.now()}`;

        addOrUpdateMessage(
          {
            id: msgId,
            msg_id: msgId,
            conversation_id: conversationId,
            type: 'acp_tool_call',
            position: 'left',
            status: 'finish',
            created_at: Date.now(),
            content: {
              session_id: 'e2e-session',
              update: {
                sessionUpdate: 'tool_call_update',
                tool_call_id: `${msgId}-call`,
                status: 'completed',
                title: `Write ${path}`,
                kind: 'edit',
                rawInput: { path },
                content: [{ type: 'diff', path, old_text: oldText, new_text: newText }],
              },
            },
          } as TMessage,
          true
        );

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, STREAM_TICK_MS);
        });
      },
      emitAgentStatusError: async (agentName: string) => {
        const msgId = `e2e-agent-status-error-${Date.now()}`;

        addOrUpdateMessage(
          {
            id: msgId,
            msg_id: msgId,
            conversation_id: conversationId,
            type: 'agent_status',
            position: 'center',
            status: 'finish',
            created_at: Date.now(),
            content: {
              backend: 'codex',
              status: 'error',
              agent_name: agentName,
            },
          } as unknown as TMessage,
          true
        );

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, STREAM_TICK_MS);
        });
      },
      emitFollowUpExchange: async (fixture?: FollowUpFixture) => {
        const exchange = fixture ?? {
          user: 'Please continue after the neutral info tip.',
          assistant: 'Follow-up reply arrived after the neutral empty-turn tip.',
        };
        const userMsgId = `e2e-follow-up-user-${Date.now()}`;
        const assistantMsgId = `e2e-follow-up-assistant-${Date.now()}`;

        addOrUpdateMessage(
          {
            id: userMsgId,
            msg_id: userMsgId,
            conversation_id: conversationId,
            type: 'text',
            position: 'right',
            status: 'finish',
            created_at: Date.now(),
            content: {
              content: exchange.user,
            },
          },
          true
        );

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, STREAM_TICK_MS);
        });

        addOrUpdateMessage(
          {
            id: assistantMsgId,
            msg_id: assistantMsgId,
            conversation_id: conversationId,
            type: 'text',
            position: 'left',
            status: 'finish',
            created_at: Date.now() + 1,
            content: {
              content: exchange.assistant,
            },
          },
          true
        );

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, STREAM_TICK_MS);
        });
      },
      emitInteractionQuestion: async (requestId: string, version = 'v1', fixture?: InteractionQuestionFixture) => {
        const question = fixture ?? {
          header: 'Approval',
          question: 'Continue the governed workflow?',
          options: [
            { label: 'Continue', description: 'Resume the original managed turn.' },
            { label: 'Stop', description: 'Leave the request unresolved.' },
          ],
        };
        addOrUpdateMessage(
          {
            id: `e2e-question-${requestId}`,
            msg_id: `e2e-question-${requestId}`,
            conversation_id: conversationId,
            type: 'ask',
            position: 'left',
            status: 'work',
            created_at: Date.now(),
            content: {
              request_id: requestId,
              interaction_request: { id: requestId, version },
              questions: [
                {
                  ...question,
                  multi_select: false,
                },
              ],
            },
          } as unknown as TMessage,
          true
        );

        dispatchE2EWsEvent('interaction_request.changed', { revision: `e2e:${requestId}:${version}` });

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, STREAM_TICK_MS);
        });
      },
      emitInteractionPermission: async (requestId: string, version = 'v1', fixture?: InteractionPermissionFixture) => {
        const permission = fixture ?? {
          title: 'Confirm production submission',
          description: 'Submit the reviewed payment request to the governed production system.',
          action: 'execute',
          detail: 'OA-PAY-20260812-001',
          options: [
            { label: 'Allow once', value: 'proceed_once' },
            { label: 'Reject', value: 'reject_once' },
          ],
        };
        const msgId = `e2e-permission-${requestId}`;
        addOrUpdateMessage(
          {
            id: msgId,
            msg_id: msgId,
            conversation_id: conversationId,
            type: 'permission',
            position: 'left',
            status: 'work',
            created_at: Date.now(),
            content: {
              id: requestId,
              call_id: requestId,
              title: permission.title,
              description: permission.description,
              action: permission.action ?? 'execute',
              command_type: permission.detail,
              interaction_request: { id: requestId, version },
              options: permission.options,
            },
          } as unknown as TMessage,
          true
        );

        dispatchE2EWsEvent('interaction_request.changed', { revision: `e2e:${requestId}:${version}` });

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, STREAM_TICK_MS);
        });
      },
    };

    return () => {
      if (window.__AIONUI_E2E_MESSAGE_STREAM__) {
        delete window.__AIONUI_E2E_MESSAGE_STREAM__.controllers[conversationId];
      }
    };
  }, [addOrUpdateMessage, conversationId, mergeLiveMessage]);

  return null;
};

export default AcpE2EStreamInjector;
