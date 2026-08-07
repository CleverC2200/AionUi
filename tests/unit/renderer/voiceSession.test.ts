/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { VoiceSessionCreateResponse } from '@/common/types/voice';
import { VoiceSession } from '@/renderer/services/voice/VoiceSession';
import type { VoiceTransport, VoiceTransportCallbacks } from '@/renderer/services/voice/VolcengineVoiceTransport';

const credentials: VoiceSessionCreateResponse = {
  session_id: 'session-1',
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
    runTurn: vi.fn(async () => ({ text: '客户端 Agent 已完成查询' })),
  };
  const transport: VoiceTransport = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    setMicrophoneEnabled: vi.fn(async () => undefined),
  };
  let callbacks: VoiceTransportCallbacks | null = null;
  const session = new VoiceSession('conversation-1', backend, (_rtc, nextCallbacks) => {
    callbacks = nextCallbacks;
    return transport;
  });
  const getCallbacks = (): VoiceTransportCallbacks => {
    if (!callbacks) throw new Error('transport was not created');
    return callbacks;
  };
  return { backend, getCallbacks, session, transport };
};

describe('VoiceSession', () => {
  it('creates a short-lived backend session, connects RTC, and releases both on stop', async () => {
    const { backend, session, transport } = createFixture();

    await session.start();
    expect(backend.createSession).toHaveBeenCalledWith({ conversation_id: 'conversation-1' });
    expect(transport.connect).toHaveBeenCalledOnce();
    expect(backend.startSession).toHaveBeenCalledWith('session-1');
    expect(vi.mocked(transport.connect).mock.invocationCallOrder[0]).toBeLessThan(
      backend.startSession.mock.invocationCallOrder[0]
    );
    expect(session.getSnapshot()).toMatchObject({
      connection: 'connected',
      agent: 'listening',
      microphoneEnabled: true,
    });

    await session.stop();
    expect(transport.disconnect).toHaveBeenCalledOnce();
    expect(backend.stopSession).toHaveBeenCalledWith('session-1');
    expect(session.getSnapshot()).toMatchObject({ connection: 'ended', microphoneEnabled: false });
  });

  it('keeps the backend session recoverable when stop fails', async () => {
    const { backend, session, transport } = createFixture();
    await session.start();
    backend.stopSession.mockRejectedValueOnce(new Error('temporary stop failure'));

    await expect(session.stop()).rejects.toThrow('VOICE_SESSION_STOP_FAILED');
    expect(transport.disconnect).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({ connection: 'error', errorCode: 'VOICE_SESSION_STOP_FAILED' });

    await session.stop();
    expect(backend.stopSession).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot()).toMatchObject({ connection: 'ended', microphoneEnabled: false });
  });

  it('forwards final user transcripts to the bound client conversation', async () => {
    const { backend, getCallbacks, session } = createFixture();
    await session.start();

    getCallbacks().onTranscript('user', '查询订单 42', true);
    getCallbacks().onTranscript('agent', '火山内置模型的回复', false);

    await vi.waitFor(() => expect(backend.runTurn).toHaveBeenCalledWith('session-1', '查询订单 42'));
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        userTranscript: '查询订单 42',
        agentTranscript: '客户端 Agent 已完成查询',
        agent: 'speaking',
      })
    );

    getCallbacks().onTranscript('user', '查询订单 42', true);
    expect(backend.runTurn).toHaveBeenCalledOnce();
  });

  it('drains every final user transcript in order while an agent turn is pending', async () => {
    const { backend, getCallbacks, session } = createFixture();
    const resolvers: Array<(value: { text: string }) => void> = [];
    backend.runTurn.mockImplementation(
      async (_sessionId, text) =>
        await new Promise<{ text: string }>((resolve) => resolvers.push(() => resolve({ text: `回复:${text}` })))
    );
    await session.start();

    getCallbacks().onTranscript('user', '第一轮', true);
    getCallbacks().onTranscript('user', '第二轮', true);
    getCallbacks().onTranscript('user', '第三轮', true);
    await vi.waitFor(() => expect(backend.runTurn).toHaveBeenCalledTimes(1));

    resolvers.shift()?.({ text: '' });
    await vi.waitFor(() => expect(backend.runTurn).toHaveBeenCalledTimes(2));
    resolvers.shift()?.({ text: '' });
    await vi.waitFor(() => expect(backend.runTurn).toHaveBeenCalledTimes(3));
    resolvers.shift()?.({ text: '' });

    expect(backend.runTurn.mock.calls.map(([, text]) => text)).toEqual(['第一轮', '第二轮', '第三轮']);
  });

  it('cleans up the backend session when RTC connection fails', async () => {
    const { backend, session, transport } = createFixture();
    vi.mocked(transport.connect).mockRejectedValueOnce(new Error('VOICE_RTC_UNSUPPORTED'));

    await expect(session.start()).rejects.toThrow('VOICE_RTC_UNSUPPORTED');
    expect(transport.disconnect).toHaveBeenCalledOnce();
    expect(backend.stopSession).toHaveBeenCalledWith('session-1');
    expect(session.getSnapshot()).toMatchObject({
      connection: 'error',
      microphoneEnabled: false,
      errorCode: 'VOICE_RTC_UNSUPPORTED',
    });
  });

  it('allows cleanup retry when both startup and initial backend cleanup fail', async () => {
    const { backend, session, transport } = createFixture();
    vi.mocked(transport.connect).mockRejectedValueOnce(new Error('VOICE_RTC_UNSUPPORTED'));
    backend.stopSession.mockRejectedValueOnce(new Error('temporary stop failure'));

    await expect(session.start()).rejects.toThrow('VOICE_RTC_UNSUPPORTED');
    await session.stop();

    expect(backend.stopSession).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot()).toMatchObject({ connection: 'ended', microphoneEnabled: false });
  });

  it('leaves RTC and releases the session when the managed agent cannot start', async () => {
    const { backend, session, transport } = createFixture();
    backend.startSession.mockRejectedValueOnce(new Error('VOICE_PROVIDER_UNAVAILABLE'));

    await expect(session.start()).rejects.toThrow('VOICE_PROVIDER_UNAVAILABLE');
    expect(transport.connect).toHaveBeenCalledOnce();
    expect(transport.disconnect).toHaveBeenCalledOnce();
    expect(backend.stopSession).toHaveBeenCalledWith('session-1');
    expect(session.getSnapshot()).toMatchObject({
      connection: 'error',
      microphoneEnabled: false,
      errorCode: 'VOICE_PROVIDER_UNAVAILABLE',
    });
  });

  it('releases microphone and backend session after a runtime RTC error', async () => {
    const { backend, getCallbacks, session, transport } = createFixture();
    await session.start();

    getCallbacks().onError('VOICE_RTC_RUNTIME_ERROR');

    await vi.waitFor(() => expect(transport.disconnect).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(backend.stopSession).toHaveBeenCalledWith('session-1'));
    expect(session.getSnapshot()).toMatchObject({
      connection: 'error',
      microphoneEnabled: false,
      errorCode: 'VOICE_RTC_RUNTIME_ERROR',
    });
  });
});
