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
  startRecording: vi.fn(() => Promise.resolve()),
  stopRecording: vi.fn(),
  status: 'idle' as 'idle' | 'recording' | 'transcribing' | 'error',
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
    startRecording: mocks.startRecording,
    status: mocks.status,
    stopRecording: mocks.stopRecording,
    transcribeFile: vi.fn(),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { shortcut?: string }) =>
      key === 'conversation.chat.speech.recordTooltipWithShortcut'
        ? '语音输入 cmd+M'
        : options?.shortcut
          ? `${key}:${options.shortcut}`
          : key,
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button {...props}>{icon}</button>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <span data-testid='speech-tooltip'>{children}</span>,
  Message: { warning: vi.fn(), error: vi.fn() },
}));

import SpeechInputButton from '@/renderer/components/chat/SpeechInputButton';

describe('SpeechInputButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.mockResolvedValue({ enabled: true });
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

    const button = await screen.findByRole('button', { name: /M/ });
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

  it('shows the shortcut and toggles recording on consecutive presses', async () => {
    const view = render(<SpeechInputButton onTranscript={vi.fn()} />);

    const button = await screen.findByRole('button');
    expect(button.getAttribute('aria-label')).toContain('M');
    fireEvent.mouseEnter(view.container.querySelector('.speech-input-control') as Element);

    // The window keydown listener is attached in an effect gated on async
    // config loading, so a single fire can race the attachment on slow CI
    // runners. Retry the press until it is observed; presses before the
    // listener exists contribute zero calls, so the final count stays exact.
    await waitFor(() => {
      fireEvent.keyDown(window, { code: 'KeyM', metaKey: true });
      expect(mocks.startRecording).toHaveBeenCalled();
    });
    expect(mocks.startRecording).toHaveBeenCalledTimes(1);

    mocks.status = 'recording';
    view.rerender(<SpeechInputButton onTranscript={vi.fn()} />);
    fireEvent.keyDown(window, { code: 'KeyM', metaKey: true });
    await waitFor(() => expect(mocks.stopRecording).toHaveBeenCalledTimes(1));
  });

  it('only triggers the active voice input when several send boxes are mounted', async () => {
    const view = render(
      <>
        <SpeechInputButton onTranscript={vi.fn()} />
        <SpeechInputButton onTranscript={vi.fn()} />
      </>
    );
    await screen.findAllByRole('button');
    const controls = view.container.querySelectorAll('.speech-input-control');
    fireEvent.mouseEnter(controls[1]);

    // Same listener-attachment race as above: retry the press until observed.
    // Only the hovered instance passes the ownership check, so the final
    // count still proves exactly one recording started.
    await waitFor(() => {
      fireEvent.keyDown(window, { code: 'KeyM', metaKey: true });
      expect(mocks.startRecording).toHaveBeenCalled();
    });
    expect(mocks.startRecording).toHaveBeenCalledTimes(1);
  });

  it('shows only the spinner button while transcribing', async () => {
    mocks.status = 'transcribing';
    const { container } = render(<SpeechInputButton onTranscript={vi.fn()} />);
    const button = await screen.findByRole('button');

    expect(button).toBeDisabled();
    expect(container.querySelector('.speech-input-feedback')).toBeNull();
    expect(screen.queryByTestId('speech-tooltip')).toBeNull();
  });
});
