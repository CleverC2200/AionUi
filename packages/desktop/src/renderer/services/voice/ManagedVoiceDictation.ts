/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { VoiceSessionCreateRequest, VoiceSessionCreateResponse } from '@/common/types/voice';
import type { SpeechInputErrorCode, SpeechInputStatus } from '@/renderer/hooks/system/useSpeechInput';
import {
  preloadVolcengineVoiceTransport,
  VolcengineVoiceTransport,
  type VoiceTransport,
  type VoiceTransportCallbacks,
} from './VolcengineVoiceTransport';

export type ManagedVoiceDictationStatus = SpeechInputStatus | 'connecting';

export type ManagedVoiceDictationSnapshot = {
  errorCode: SpeechInputErrorCode | null;
  errorMessage: string | null;
  status: ManagedVoiceDictationStatus;
  transcript: string;
};

export type ManagedVoiceDictationBackend = {
  createSession(params: VoiceSessionCreateRequest): Promise<VoiceSessionCreateResponse>;
  startSession(sessionId: string): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
};

type VoiceTransportFactory = (
  credentials: VoiceSessionCreateResponse['rtc'],
  callbacks: VoiceTransportCallbacks
) => VoiceTransport;

const initialSnapshot = (): ManagedVoiceDictationSnapshot => ({
  errorCode: null,
  errorMessage: null,
  status: 'idle',
  transcript: '',
});

const defaultBackend: ManagedVoiceDictationBackend = {
  createSession: (params) => ipcBridge.voice.createSession.invoke(params),
  startSession: (sessionId) => ipcBridge.voice.startSession.invoke({ session_id: sessionId }),
  stopSession: (sessionId) => ipcBridge.voice.stopSession.invoke({ session_id: sessionId }),
};

const defaultTransportFactory: VoiceTransportFactory = (credentials, callbacks) =>
  new VolcengineVoiceTransport(credentials, callbacks);

const isValidSession = (response: VoiceSessionCreateResponse): boolean =>
  Boolean(
    response.session_id && response.rtc?.app_id && response.rtc.room_id && response.rtc.user_id && response.rtc.token
  );

export class ManagedVoiceDictation {
  private snapshot = initialSnapshot();
  private readonly listeners = new Set<(snapshot: ManagedVoiceDictationSnapshot) => void>();
  private sessionId: string | null = null;
  private transport: VoiceTransport | null = null;
  private lifecycleId = 0;
  private finalizing = false;

  constructor(
    private readonly onLiveTranscript: ((text: string | null) => void) | undefined,
    private readonly onTranscript: (text: string) => void,
    private readonly backend: ManagedVoiceDictationBackend = defaultBackend,
    private readonly transportFactory: VoiceTransportFactory = defaultTransportFactory,
    private readonly preloadTransport: () => Promise<unknown> = preloadVolcengineVoiceTransport
  ) {}

  getSnapshot = (): ManagedVoiceDictationSnapshot => this.snapshot;

  subscribe = (listener: (snapshot: ManagedVoiceDictationSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<ManagedVoiceDictationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  clearError(): void {
    this.update({ errorCode: null, errorMessage: null, status: 'idle' });
  }

  async start(): Promise<void> {
    if (
      this.snapshot.status === 'connecting' ||
      this.snapshot.status === 'recording' ||
      this.snapshot.status === 'transcribing'
    )
      return;

    const lifecycleId = ++this.lifecycleId;
    this.finalizing = false;
    this.onLiveTranscript?.(null);
    this.update({ ...initialSnapshot(), status: 'connecting' });

    let response: VoiceSessionCreateResponse | null = null;
    let transport: VoiceTransport | null = null;
    try {
      [response] = await Promise.all([this.backend.createSession({ mode: 'dictation' }), this.preloadTransport()]);
      if (!isValidSession(response)) throw new Error('VOICE_SESSION_INVALID_RESPONSE');
      if (lifecycleId !== this.lifecycleId) {
        await this.backend.stopSession(response.session_id).catch((): void => {});
        return;
      }

      this.sessionId = response.session_id;
      transport = this.transportFactory(response.rtc, this.createTransportCallbacks(lifecycleId));
      this.transport = transport;
      await transport.connect();
      if (lifecycleId !== this.lifecycleId) {
        await this.cleanup(response.session_id, transport);
        return;
      }

      await this.backend.startSession(response.session_id);
      if (lifecycleId !== this.lifecycleId) {
        await this.cleanup(response.session_id, transport);
        return;
      }
      this.update({ status: 'recording' });
    } catch (error) {
      await this.cleanup(response?.session_id ?? null, transport);
      if (lifecycleId !== this.lifecycleId) return;
      this.update({
        errorCode: 'audio-capture',
        errorMessage: error instanceof Error ? error.message : null,
        status: 'error',
      });
    }
  }

  async stop(): Promise<void> {
    if (this.snapshot.status === 'recording') {
      await this.finish(this.snapshot.transcript, this.lifecycleId);
      return;
    }

    this.lifecycleId += 1;
    this.finalizing = false;
    this.onLiveTranscript?.(null);
    await this.cleanup(this.sessionId, this.transport);
    this.update({ ...initialSnapshot() });
  }

  private createTransportCallbacks(lifecycleId: number): VoiceTransportCallbacks {
    return {
      onConnectionChange: (connection) => {
        if (connection === 'error') void this.fail('VOICE_RTC_CONNECTION_FAILED', lifecycleId);
      },
      onAgentStateChange: () => {},
      onTranscript: (speaker, text, final) => {
        if (speaker !== 'user' || lifecycleId !== this.lifecycleId || this.finalizing) return;
        const normalized = text.trim();
        this.update({ transcript: normalized });
        this.onLiveTranscript?.(normalized || null);
        if (final && normalized) void this.finish(normalized, lifecycleId);
      },
      onError: (errorCode) => void this.fail(errorCode, lifecycleId),
    };
  }

  private async finish(text: string, lifecycleId: number): Promise<void> {
    if (this.finalizing || lifecycleId !== this.lifecycleId) return;
    this.finalizing = true;
    const normalized = text.trim();
    this.update({ status: 'transcribing' });
    this.onLiveTranscript?.(null);
    await this.cleanup(this.sessionId, this.transport);
    if (lifecycleId !== this.lifecycleId) return;

    this.finalizing = false;
    if (!normalized) {
      this.update({ errorCode: 'empty-transcript', errorMessage: null, status: 'error', transcript: '' });
      return;
    }
    this.onTranscript(normalized);
    this.update({ ...initialSnapshot() });
  }

  private async fail(errorMessage: string, lifecycleId: number): Promise<void> {
    if (lifecycleId !== this.lifecycleId || this.finalizing) return;
    this.finalizing = true;
    this.onLiveTranscript?.(null);
    await this.cleanup(this.sessionId, this.transport);
    if (lifecycleId !== this.lifecycleId) return;
    this.finalizing = false;
    this.update({ errorCode: 'transcription-failed', errorMessage, status: 'error', transcript: '' });
  }

  private async cleanup(sessionId: string | null, transport: VoiceTransport | null): Promise<void> {
    if (this.transport === transport) this.transport = null;
    if (this.sessionId === sessionId) this.sessionId = null;
    await transport?.disconnect().catch((): void => {});
    if (sessionId) await this.backend.stopSession(sessionId).catch((): void => {});
  }
}
