/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import ConversationResourcesPortal, {
  ConversationResourcesButton,
} from '@/renderer/pages/conversation/components/ConversationResources';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  messages: [] as TMessage[],
  loadAllMessages: vi.fn(),
  openBrowserTab: vi.fn(),
  openLocalFile: vi.fn(),
  recordsGet: vi.fn(),
  recordsChangedOn: vi.fn(() => vi.fn()),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversationRecords: {
      get: { invoke: mocks.recordsGet },
      changed: { on: mocks.recordsChangedOn },
    },
  },
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => mocks.messages,
}));

vi.mock('@/renderer/pages/conversation/Preview/hooks/useLocalFilePreview', () => ({
  useLocalFilePreview: () => mocks.openLocalFile,
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ openBrowserTab: mocks.openBrowserTab }),
}));

vi.mock('@/renderer/utils/chat/messagePagination', () => ({
  loadAllConversationMessagesPaged: mocks.loadAllMessages,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ConversationResourcesButton', () => {
  beforeEach(() => {
    mocks.messages = [];
    mocks.loadAllMessages.mockReset().mockResolvedValue([]);
    mocks.openBrowserTab.mockReset();
    mocks.openLocalFile.mockReset();
    mocks.recordsGet.mockReset().mockRejectedValue(new Error('legacy backend'));
    mocks.recordsChangedOn.mockClear();
  });

  afterEach(() => {
    document.querySelectorAll('[id^="conversation-resources-conversation-"]').forEach((target) => target.remove());
  });

  it('opens a listed output through the provided preview handler', async () => {
    const onOpen = vi.fn();
    const output = { kind: 'file' as const, path: '/workspace/artifact.md', name: 'artifact.md' };

    render(<ConversationResourcesButton outputs={[output]} sources={[]} onOpen={onOpen} />);

    fireEvent.click(screen.getByTestId('conversation-resources-trigger'));
    fireEvent.click(await screen.findByText('artifact.md'));

    expect(onOpen).toHaveBeenCalledWith(output);
    await waitFor(() => {
      expect(screen.queryByTestId('conversation-resources-panel')).not.toBeInTheDocument();
    });
  });

  it('keeps every output and source in independently scrollable lists', async () => {
    const outputs = Array.from({ length: 7 }, (_, index) => ({
      kind: 'file' as const,
      path: `/workspace/output-${index}.md`,
      name: `output-${index}.md`,
    }));
    const sources = Array.from({ length: 7 }, (_, index) => ({
      kind: 'file' as const,
      path: `/workspace/source-${index}.png`,
      name: `source-${index}.png`,
    }));

    render(<ConversationResourcesButton outputs={outputs} sources={sources} onOpen={vi.fn()} />);

    fireEvent.click(screen.getByTestId('conversation-resources-trigger'));

    const outputList = await screen.findByTestId('conversation-resources-outputs-list');
    const sourceList = screen.getByTestId('conversation-resources-sources-list');
    expect(outputList).toHaveClass('max-h-170px', 'overflow-y-auto');
    expect(sourceList).toHaveClass('max-h-170px', 'overflow-y-auto');
    expect(outputList.querySelectorAll('button')).toHaveLength(7);
    expect(sourceList.querySelectorAll('button')).toHaveLength(7);
  });

  it('reattaches the trigger when the header slot is replaced', async () => {
    const slotId = 'conversation-resources-conversation-1';
    const firstTarget = document.createElement('div');
    firstTarget.id = slotId;
    document.body.append(firstTarget);

    const view = render(<ConversationResourcesPortal conversationId='conversation-1' workspace='/workspace' />);
    await waitFor(() =>
      expect(firstTarget.querySelector('[data-testid="conversation-resources-trigger"]')).not.toBeNull()
    );

    firstTarget.remove();
    const replacementTarget = document.createElement('div');
    replacementTarget.id = slotId;
    document.body.append(replacementTarget);

    await waitFor(() =>
      expect(replacementTarget.querySelector('[data-testid="conversation-resources-trigger"]')).not.toBeNull()
    );

    view.unmount();
    replacementTarget.remove();
  });

  it('attaches the trigger when an existing header slot changes to the conversation id', async () => {
    const target = document.createElement('div');
    target.id = 'conversation-resources-conversation-1';
    document.body.append(target);

    const view = render(<ConversationResourcesPortal conversationId='conversation-2' workspace='/workspace' />);
    expect(target.querySelector('[data-testid="conversation-resources-trigger"]')).toBeNull();

    target.id = 'conversation-resources-conversation-2';

    await waitFor(() => expect(target.querySelector('[data-testid="conversation-resources-trigger"]')).not.toBeNull());

    view.unmount();
    target.remove();
  });

  it('loads older resources when the panel opens', async () => {
    const slotId = 'conversation-resources-conversation-1';
    const target = document.createElement('div');
    target.id = slotId;
    document.body.append(target);
    mocks.loadAllMessages.mockResolvedValue([
      {
        id: 'old-source',
        conversation_id: 'conversation-1',
        type: 'text',
        position: 'right',
        content: { content: '旧附件\n[[AION_FILES]]\nreferences/old.png' },
      } as TMessage,
    ]);

    const view = render(<ConversationResourcesPortal conversationId='conversation-1' workspace='/workspace' />);
    fireEvent.click(await screen.findByTestId('conversation-resources-trigger'));

    expect(await screen.findByText('old.png')).toBeInTheDocument();
    expect(mocks.loadAllMessages).toHaveBeenCalledWith('conversation-1', { contentMode: 'compact' });

    view.unmount();
    target.remove();
  });

  it('opens web sources in the existing browser preview', async () => {
    const slotId = 'conversation-resources-conversation-1';
    const target = document.createElement('div');
    target.id = slotId;
    document.body.append(target);
    mocks.messages = [
      {
        id: 'web-source',
        conversation_id: 'conversation-1',
        type: 'text',
        position: 'left',
        content: { content: '参考 [MDN](https://developer.mozilla.org/en-US/docs/Web/API)' },
      } as TMessage,
    ];

    const view = render(<ConversationResourcesPortal conversationId='conversation-1' workspace='/workspace' />);
    fireEvent.click(await screen.findByTestId('conversation-resources-trigger'));
    fireEvent.click(await screen.findByText('developer.mozilla.org'));

    expect(mocks.openBrowserTab).toHaveBeenCalledWith('https://developer.mozilla.org/en-US/docs/Web/API');
    expect(mocks.openLocalFile).not.toHaveBeenCalled();

    view.unmount();
    target.remove();
  });

  it('uses structured records without scanning message wording and shows no inferred label', async () => {
    const target = document.createElement('div');
    target.id = 'conversation-resources-conversation-1';
    document.body.append(target);
    mocks.recordsGet.mockResolvedValue({
      revision: 1,
      records: [
        {
          id: 'verification-1',
          revision: 1,
          record_type: 'verification_evidence',
          conversation_id: 'conversation-1',
          turn_id: 'turn-1',
          producer: { type: 'aioncore', id: 'aioncore' },
          created_at: '2026-08-12T00:00:30.000Z',
          outcome: 'pass',
          summary: 'Production record matched',
          evidence_record_ids: ['deliverable-1'],
        },
        {
          id: 'deliverable-1',
          revision: 1,
          record_type: 'deliverable_revision',
          conversation_id: 'conversation-1',
          turn_id: 'turn-1',
          producer: { type: 'agent', id: 'agent-1' },
          created_at: '2026-08-12T00:00:00.000Z',
          deliverable_id: 'deliverable',
          status: 'ready',
          resource: { kind: 'file', uri: '/workspace/final.xlsx', name: 'final.xlsx' },
        },
        {
          id: 'receipt-1',
          revision: 1,
          record_type: 'completion_receipt',
          conversation_id: 'conversation-1',
          turn_id: 'turn-1',
          producer: { type: 'aioncore', id: 'aioncore' },
          created_at: '2026-08-12T00:01:00.000Z',
          definition: 'Production submission verified',
          owner: 'finance-agent',
          status: 'verified',
          evidence_record_ids: ['verification-1'],
        },
      ],
    });

    const view = render(<ConversationResourcesPortal conversationId='conversation-1' workspace='/workspace' />);
    fireEvent.click(await screen.findByTestId('conversation-resources-trigger'));

    expect(await screen.findByText('final.xlsx')).toBeInTheDocument();
    expect(screen.getByText('Production submission verified')).toBeInTheDocument();
    expect(screen.queryByText('conversation.resources.inferred')).not.toBeInTheDocument();
    expect(mocks.loadAllMessages).not.toHaveBeenCalled();

    view.unmount();
    target.remove();
  });
});
