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
  config: vi.fn(),
  managedStart: vi.fn(),
  managedStop: vi.fn(),
  managedStatus: 'idle' as 'idle' | 'connecting' | 'recording' | 'transcribing' | 'error',
  status: 'idle' as 'idle' | 'recording' | 'transcribing' | 'error',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: mocks.config,
}));

vi.mock('@/renderer/services/SpeechToTextService', () => ({
  SPEECH_TO_TEXT_CONFIG_CHANGED_EVENT: 'speech-to-text-config-changed',
}));

vi.mock('@/renderer/services/voice/voiceCapability', () => ({
  getManagedVoiceCapability: mocks.capability,
}));

vi.mock('@/renderer/services/voice/VolcengineVoiceTransport', () => ({
  preloadVolcengineVoiceTransport: vi.fn(async () => ({})),
}));

vi.mock('@/renderer/hooks/voice/useManagedVoiceDictation', () => ({
  useManagedVoiceDictation: () => ({
    clearError: vi.fn(),
    errorCode: null,
    errorMessage: null,
    recordingDurationMs: 0,
    recordingLevels: [],
    startRecording: mocks.managedStart,
    status: mocks.managedStatus,
    stopRecording: mocks.managedStop,
  }),
}));

vi.mock('@/renderer/hooks/system/useSpeechInput', () => ({
  getSpeechInputErrorMessageKey: () => 'conversation.chat.speech.genericError',
  useSpeechInput: () => ({
    availability: 'record',
    clearError: vi.fn(),
    errorCode: null,
    errorMessage: null,
    recordingDurationMs: 1200,
    recordingLevels: [0.1, 0.25, 0.5, 0.8, 0.4, 0.2],
    startRecording: vi.fn(),
    status: mocks.status,
    stopRecording: vi.fn(),
    transcribeFile: vi.fn(),
  }),
}));

import SpeechInputButton from '@/renderer/components/chat/SpeechInputButton';

describe('SpeechInputButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capability.mockResolvedValue({ enabled: false });
    mocks.managedStatus = 'idle';
    mocks.status = 'idle';
  });

  it('keeps the short speech entry visible before transcription is configured', async () => {
    mocks.config.mockResolvedValue(undefined);
    render(<SpeechInputButton onTranscript={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'conversation.chat.speech.notConfigured' })).toBeInTheDocument();
  });

  it('offers managed dictation when legacy transcription is not configured', async () => {
    mocks.config.mockResolvedValue(undefined);
    mocks.capability.mockResolvedValue({ enabled: true, provider: 'volcengine-rtc' });
    render(<SpeechInputButton onTranscript={vi.fn()} />);

    const button = await screen.findByRole('button', { name: 'conversation.chat.speech.recordTooltip' });
    fireEvent.click(button);

    expect(mocks.managedStart).toHaveBeenCalledOnce();
  });

  it('shows the live waveform while short speech recording is active', async () => {
    mocks.config.mockResolvedValue({ enabled: true });
    mocks.status = 'recording';
    const { container } = render(<SpeechInputButton onTranscript={vi.fn()} />);

    await waitFor(() => expect(container.querySelector('.speech-input-feedback--recording')).toBeInTheDocument());
    expect(container.querySelectorAll('.speech-input-feedback__bar')).toHaveLength(6);
    expect(container.querySelector('.speech-input-button--listening')).toBeInTheDocument();
  });

  it('shows a cancellable connecting state before managed recording starts', async () => {
    mocks.config.mockResolvedValue(undefined);
    mocks.capability.mockResolvedValue({ enabled: true, provider: 'volcengine-rtc' });
    mocks.managedStatus = 'connecting';
    render(<SpeechInputButton onTranscript={vi.fn()} />);

    const button = await screen.findByRole('button', { name: 'conversation.chat.speech.connecting' });
    fireEvent.click(button);

    expect(mocks.managedStop).toHaveBeenCalledOnce();
  });
});
