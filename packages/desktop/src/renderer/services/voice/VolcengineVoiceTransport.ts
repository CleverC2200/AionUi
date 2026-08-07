/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IRTCEngine } from '@volcengine/rtc';
import type { VoiceAgentState, VoiceConnectionState, VoiceSessionRtcCredentials } from '@/common/types/voice';
import { parseVoiceProtocolEvent } from './voiceProtocol';

type VolcengineRtcModule = typeof import('@volcengine/rtc');

let rtcModulePromise: Promise<VolcengineRtcModule> | null = null;

export const preloadVolcengineVoiceTransport = (): Promise<VolcengineRtcModule> => {
  rtcModulePromise ??= import('@volcengine/rtc');
  return rtcModulePromise;
};

export type VoiceTransportCallbacks = {
  onConnectionChange: (state: VoiceConnectionState) => void;
  onAgentStateChange: (state: VoiceAgentState) => void;
  onTranscript: (speaker: 'user' | 'agent', text: string, final: boolean) => void;
  onError: (code: string) => void;
};

export type VoiceTransport = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
};

export class VolcengineVoiceTransport implements VoiceTransport {
  private engine: IRTCEngine | null = null;
  private microphoneDeviceId: string | null = null;
  private microphoneEnabled = false;
  private closed = false;

  constructor(
    private readonly credentials: VoiceSessionRtcCredentials,
    private readonly callbacks: VoiceTransportCallbacks
  ) {}

  async connect(): Promise<void> {
    const rtcModule = await preloadVolcengineVoiceTransport();
    const VERTC = rtcModule.default;

    if (!(await VERTC.isSupported())) {
      throw new Error('VOICE_RTC_UNSUPPORTED');
    }

    this.closed = false;
    const engine = VERTC.createEngine(this.credentials.app_id);
    this.engine = engine;

    engine.on(VERTC.events.onError, (event) => {
      if (!this.closed) this.callbacks.onError(`VOICE_RTC_${String(event.errorCode)}`);
    });
    engine.on(VERTC.events.onConnectionStateChanged, ({ state }) => {
      if (this.closed) return;
      switch (state) {
        case rtcModule.ConnectionState.CONNECTION_STATE_CONNECTING:
          this.callbacks.onConnectionChange('connecting');
          break;
        case rtcModule.ConnectionState.CONNECTION_STATE_CONNECTED:
        case rtcModule.ConnectionState.CONNECTION_STATE_RECONNECTED:
          this.callbacks.onConnectionChange('connected');
          break;
        case rtcModule.ConnectionState.CONNECTION_STATE_RECONNECTING:
        case rtcModule.ConnectionState.CONNECTION_STATE_LOST:
          this.callbacks.onConnectionChange('reconnecting');
          break;
        case rtcModule.ConnectionState.CONNECTION_STATE_DISCONNECTED:
          this.callbacks.onConnectionChange('error');
          break;
        default:
          break;
      }
    });
    engine.on(VERTC.events.onRoomBinaryMessageReceived, ({ message }) => {
      if (this.closed) return;
      const event = parseVoiceProtocolEvent(message);
      switch (event.type) {
        case 'agent-state':
          this.callbacks.onAgentStateChange(event.state);
          break;
        case 'transcript':
          this.callbacks.onTranscript(
            event.speakerId === this.credentials.user_id ? 'user' : 'agent',
            event.text,
            event.final
          );
          break;
        case 'tool-call':
          // Provider-side function calls are intentionally unsupported until
          // the authenticated AionCore execution contract is implemented.
          break;
        case 'unknown':
          break;
      }
    });

    try {
      await engine.joinRoom(
        this.credentials.token,
        this.credentials.room_id,
        {
          userId: this.credentials.user_id,
          extraInfo: JSON.stringify({
            call_scene: 'RTC-AIGC',
            user_id: this.credentials.user_id,
            user_name: this.credentials.user_id,
          }),
        },
        {
          isAutoPublish: true,
          isAutoSubscribeAudio: true,
          roomProfileType: rtcModule.RoomProfileType.chat,
        }
      );

      const permission = await VERTC.enableDevices({ audio: true, video: false });
      if (!permission.audio) throw permission.audioExceptionError ?? new Error('VOICE_MICROPHONE_PERMISSION_DENIED');
      await engine.publishStream(rtcModule.MediaType.AUDIO);
      await engine.startAudioCapture(await this.resolveMicrophoneDeviceId());
      this.microphoneEnabled = true;
      this.callbacks.onConnectionChange('connected');
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    const engine = this.engine;
    this.engine = null;
    this.microphoneDeviceId = null;
    this.microphoneEnabled = false;
    if (!engine) return;

    await engine.stopAudioCapture().catch((): void => {});
    await engine.leaveRoom().catch((): void => {});
    const { default: VERTC } = await preloadVolcengineVoiceTransport();
    VERTC.destroyEngine(engine);
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (!this.engine || this.microphoneEnabled === enabled) return;
    if (enabled) {
      await this.engine.startAudioCapture(await this.resolveMicrophoneDeviceId());
    } else {
      await this.engine.stopAudioCapture();
    }
    this.microphoneEnabled = enabled;
  }

  private async resolveMicrophoneDeviceId(): Promise<string> {
    const { default: VERTC } = await preloadVolcengineVoiceTransport();
    const devices = await VERTC.enumerateAudioCaptureDevices();
    const selected =
      devices.find((device) => device.kind === 'audioinput' && device.deviceId === this.microphoneDeviceId) ??
      devices.find((device) => device.kind === 'audioinput' && device.deviceId);
    if (!selected?.deviceId) throw new Error('VOICE_MICROPHONE_NOT_FOUND');
    this.microphoneDeviceId = selected.deviceId;
    return selected.deviceId;
  }
}
