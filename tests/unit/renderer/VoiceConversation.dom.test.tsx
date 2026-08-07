/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  capability: vi.fn(),
  setMicrophoneEnabled: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  submitConfirmation: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/services/voice/voiceCapability', () => ({
  getManagedVoiceCapability: mocks.capability,
}));

vi.mock('@/renderer/hooks/voice/useVoiceSession', () => ({
  useVoiceSession: () => ({
    snapshot: {
      connection: 'idle',
      agent: 'idle',
      microphoneEnabled: true,
      userTranscript: '',
      agentTranscript: '',
    },
    setMicrophoneEnabled: mocks.setMicrophoneEnabled,
    start: mocks.start,
    stop: mocks.stop,
    submitConfirmation: mocks.submitConfirmation,
  }),
}));

import VoiceConversation from '@/renderer/components/chat/VoiceConversation';

describe('VoiceConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue(undefined);
  });

  it('stays hidden when AionCore does not advertise managed voice', async () => {
    mocks.capability.mockResolvedValue({ enabled: false });
    render(<VoiceConversation conversationId='conversation-1' />);

    await waitFor(() => expect(mocks.capability).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('realtime-voice-button')).not.toBeInTheDocument();
  });

  it('starts a managed session from the gated entry', async () => {
    mocks.capability.mockResolvedValue({ enabled: true, provider: 'volcengine-rtc' });
    render(<VoiceConversation conversationId='conversation-1' />);

    const button = await screen.findByTestId('realtime-voice-button');
    fireEvent.click(button);

    await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
    expect(screen.getByText('conversation.chat.realtimeVoice.title')).toBeInTheDocument();
    expect(screen.getByTestId('voice-activity-visualizer')).toHaveAttribute('data-state', 'connecting');
  });

  it('renders the supplied fallback when managed voice is unavailable', async () => {
    mocks.capability.mockResolvedValue({ enabled: false });
    render(
      <VoiceConversation
        conversationId='conversation-1'
        unavailableFallback={<button type='button'>feedback</button>}
      />
    );

    expect(screen.getByRole('button', { name: 'feedback' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.capability).toHaveBeenCalledOnce());
    expect(screen.queryByTestId('realtime-voice-button')).not.toBeInTheDocument();
  });
});
