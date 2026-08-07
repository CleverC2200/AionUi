/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { VoiceSessionCreateResponse } from '@/common/types/voice';
import { ManagedVoiceDictation } from '@/renderer/services/voice/ManagedVoiceDictation';
import type { VoiceTransport, VoiceTransportCallbacks } from '@/renderer/services/voice/VolcengineVoiceTransport';

const credentials: VoiceSessionCreateResponse = {
  session_id: 'dictation-1',
  rtc: {
    app_id: 'app-1',
    room_id: 'room-1',
    user_id: 'user-1',
    token: 'short-lived-token',
  },
  expires_at: 1_786_000_000,
};

const createFixture = () => {
  const backend = {
    createSession: vi.fn(async () => credentials),
    startSession: vi.fn(async () => undefined),
    stopSession: vi.fn(async () => undefined),
  };
  const transport: VoiceTransport = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    setMicrophoneEnabled: vi.fn(async () => undefined),
    sendToolResult: vi.fn(async () => undefined),
  };
  let callbacks: VoiceTransportCallbacks | null = null;
  const onLiveTranscript = vi.fn();
  const onTranscript = vi.fn();
  const dictation = new ManagedVoiceDictation(
    onLiveTranscript,
    onTranscript,
    backend,
    (_rtc, nextCallbacks) => {
      callbacks = nextCallbacks;
      return transport;
    },
    async () => ({})
  );
  const getCallbacks = (): VoiceTransportCallbacks => {
    if (!callbacks) throw new Error('transport was not created');
    return callbacks;
  };

  return { backend, dictation, getCallbacks, onLiveTranscript, onTranscript, transport };
};

describe('ManagedVoiceDictation', () => {
  it('starts a dictation session and commits the first final user transcript', async () => {
    const { backend, dictation, getCallbacks, onLiveTranscript, onTranscript, transport } = createFixture();

    await dictation.start();
    expect(backend.createSession).toHaveBeenCalledWith({ mode: 'dictation' });
    expect(transport.connect).toHaveBeenCalledOnce();
    expect(backend.startSession).toHaveBeenCalledWith('dictation-1');
    expect(dictation.getSnapshot().status).toBe('recording');

    getCallbacks().onTranscript('user', '查询八月库存', false);
    expect(onLiveTranscript).toHaveBeenLastCalledWith('查询八月库存');

    getCallbacks().onTranscript('user', '查询八月库存。', true);
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith('查询八月库存。'));
    expect(onLiveTranscript).toHaveBeenLastCalledWith(null);
    expect(transport.disconnect).toHaveBeenCalledOnce();
    expect(backend.stopSession).toHaveBeenCalledWith('dictation-1');
    expect(dictation.getSnapshot().status).toBe('idle');
  });

  it('reports connection preparation separately from transcription', async () => {
    const { backend, dictation } = createFixture();
    let resolveSession!: (value: VoiceSessionCreateResponse) => void;
    backend.createSession.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSession = resolve;
      })
    );

    const starting = dictation.start();
    expect(dictation.getSnapshot().status).toBe('connecting');
    resolveSession(credentials);
    await starting;

    expect(dictation.getSnapshot().status).toBe('recording');
  });

  it('commits the latest partial transcript when the user presses stop', async () => {
    const { dictation, getCallbacks, onTranscript } = createFixture();
    await dictation.start();
    getCallbacks().onTranscript('user', '查一下库存', false);

    await dictation.stop();

    expect(onTranscript).toHaveBeenCalledWith('查一下库存');
    expect(dictation.getSnapshot().status).toBe('idle');
  });
});
