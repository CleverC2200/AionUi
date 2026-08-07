/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VolcengineVoiceTransport,
  type VoiceTransportCallbacks,
} from '@/renderer/services/voice/VolcengineVoiceTransport';

const rtcMocks = vi.hoisted(() => {
  const engine = {
    joinRoom: vi.fn(async () => undefined),
    leaveRoom: vi.fn(async () => undefined),
    on: vi.fn(),
    publishStream: vi.fn(async () => undefined),
    sendUserBinaryMessage: vi.fn(async () => undefined),
    startAudioCapture: vi.fn(async () => ({ deviceId: 'microphone-1' })),
    stopAudioCapture: vi.fn(async () => undefined),
  };
  return {
    createEngine: vi.fn(() => engine),
    destroyEngine: vi.fn(),
    enableDevices: vi.fn(async () => ({ audio: true, video: false })),
    engine,
    enumerateAudioCaptureDevices: vi.fn(async () => [
      { deviceId: '', kind: 'audioinput' },
      { deviceId: 'microphone-1', kind: 'audioinput' },
    ]),
    isSupported: vi.fn(async () => true),
  };
});

vi.mock('@volcengine/rtc', () => ({
  ConnectionState: {
    CONNECTION_STATE_CONNECTED: 3,
    CONNECTION_STATE_CONNECTING: 2,
    CONNECTION_STATE_DISCONNECTED: 1,
    CONNECTION_STATE_LOST: 5,
    CONNECTION_STATE_RECONNECTED: 6,
    CONNECTION_STATE_RECONNECTING: 4,
  },
  MediaType: { AUDIO: 1 },
  RoomProfileType: { chat: 3 },
  default: {
    createEngine: rtcMocks.createEngine,
    destroyEngine: rtcMocks.destroyEngine,
    enableDevices: rtcMocks.enableDevices,
    enumerateAudioCaptureDevices: rtcMocks.enumerateAudioCaptureDevices,
    events: {
      onConnectionStateChanged: 'onConnectionStateChanged',
      onError: 'onError',
      onRoomBinaryMessageReceived: 'onRoomBinaryMessageReceived',
    },
    isSupported: rtcMocks.isSupported,
  },
}));

const callbacks: VoiceTransportCallbacks = {
  onAgentStateChange: vi.fn(),
  onConnectionChange: vi.fn(),
  onError: vi.fn(),
  onToolCall: vi.fn(),
  onTranscript: vi.fn(),
};

describe('VolcengineVoiceTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enumerates and explicitly selects an available microphone before capture', async () => {
    const transport = new VolcengineVoiceTransport(
      { app_id: 'app-1', room_id: 'room-1', user_id: 'user-1', token: 'token-1' },
      callbacks
    );

    await transport.connect();

    expect(rtcMocks.enumerateAudioCaptureDevices).toHaveBeenCalledOnce();
    expect(rtcMocks.engine.publishStream).toHaveBeenCalledWith(1);
    expect(rtcMocks.engine.startAudioCapture).toHaveBeenCalledWith('microphone-1');

    await transport.setMicrophoneEnabled(false);
    await transport.setMicrophoneEnabled(true);
    expect(rtcMocks.enumerateAudioCaptureDevices).toHaveBeenCalledTimes(2);
    expect(rtcMocks.engine.startAudioCapture).toHaveBeenLastCalledWith('microphone-1');
  });

  it('fails with a stable error when no audio input is available', async () => {
    rtcMocks.enumerateAudioCaptureDevices.mockResolvedValueOnce([]);
    const transport = new VolcengineVoiceTransport(
      { app_id: 'app-1', room_id: 'room-1', user_id: 'user-1', token: 'token-1' },
      callbacks
    );

    await expect(transport.connect()).rejects.toThrow('VOICE_MICROPHONE_NOT_FOUND');
  });
});
