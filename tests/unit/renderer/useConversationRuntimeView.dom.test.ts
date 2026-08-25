/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConversationRuntimeViewStoreForTest } from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';
import { useConversationRuntimeView } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';

const mocks = vi.hoisted(() => ({
  getConversationOrNull: vi.fn(),
  reconcileGeneratingFromRuntime: vi.fn(),
  reconnectedOn: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      writeRendererLog: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
    conversation: {
      turnCompleted: { on: vi.fn().mockReturnValue(() => {}) },
      listChanged: { on: vi.fn().mockReturnValue(() => {}) },
    },
    realtime: {
      reconnected: { on: mocks.reconnectedOn },
    },
  },
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: mocks.getConversationOrNull,
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync', () => ({
  reconcileGeneratingFromRuntime: mocks.reconcileGeneratingFromRuntime,
}));

const runtime = (isProcessing: boolean) => ({
  state: isProcessing ? 'running' : 'idle',
  can_send_message: !isProcessing,
  has_task: isProcessing,
  task_status: isProcessing ? 'running' : 'finished',
  is_processing: isProcessing,
  pending_confirmations: 0,
  turn_id: isProcessing ? 'turn-1' : null,
});

describe('useConversationRuntimeView realtime recovery', () => {
  beforeEach(() => {
    resetConversationRuntimeViewStoreForTest();
    vi.clearAllMocks();
  });

  it('re-hydrates an authoritative idle runtime after reconnect misses turn completion', async () => {
    let emitReconnected: (() => void) | undefined;
    mocks.reconnectedOn.mockImplementation((callback: () => void) => {
      emitReconnected = callback;
      return () => {};
    });
    mocks.getConversationOrNull
      .mockResolvedValueOnce({ id: 'conversation-1', runtime: runtime(true) })
      .mockResolvedValueOnce({ id: 'conversation-1', runtime: runtime(false) });

    const { result } = renderHook(() => useConversationRuntimeView('conversation-1'));
    await waitFor(() => expect(result.current.isProcessing).toBe(true));

    await act(async () => {
      emitReconnected?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.isProcessing).toBe(false));
    expect(result.current.canSendMessage).toBe(true);
    expect(mocks.getConversationOrNull).toHaveBeenCalledTimes(2);
  });
});
