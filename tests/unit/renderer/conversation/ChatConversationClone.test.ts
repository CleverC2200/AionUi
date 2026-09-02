import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';

const { createWithConversationMock, emitMock, getConversationMock, uuidMock } = vi.hoisted(() => ({
  createWithConversationMock: vi.fn(),
  emitMock: vi.fn(),
  getConversationMock: vi.fn(),
  uuidMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      createWithConversation: { invoke: createWithConversationMock },
    },
  },
}));

vi.mock('@/common/utils', () => ({ uuid: uuidMock }));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: getConversationMock,
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: emitMock },
}));

import { createConversationFromConversation } from '@/renderer/pages/conversation/components/ChatConversation';

const sourceConversation = {
  id: 'conversation-source',
  name: '需求预测对话',
  type: 'aionrs',
  created_at: 1,
  modified_at: 1,
  extra: {},
  assistant: { id: 'forecast-managed', source: 'managed', name: '', avatar: '', backend: '' },
} as TChatConversation;

describe('createConversationFromConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uuidMock.mockReturnValue('client-generated-id');
    getConversationMock.mockResolvedValue(sourceConversation);
  });

  it('returns the persisted Conversation from AionCore instead of the client-side clone id', async () => {
    const persistedConversation = {
      ...sourceConversation,
      id: 'server-created-id',
      created_at: 2,
      modified_at: 2,
    } as TChatConversation;
    createWithConversationMock.mockResolvedValue(persistedConversation);

    const created = await createConversationFromConversation(sourceConversation);

    expect(createWithConversationMock).toHaveBeenCalledWith({
      conversation: expect.objectContaining({ id: 'client-generated-id' }),
    });
    expect(created).toBe(persistedConversation);
    expect(emitMock).toHaveBeenCalledWith('chat.history.refresh');
  });
});
