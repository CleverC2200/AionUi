/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { VoiceSessionCreateResponse, VoiceSessionSnapshot, VoiceTurnResponse } from '@/common/types/voice';
import {
  VolcengineVoiceTransport,
  type VoiceTransport,
  type VoiceTransportCallbacks,
} from './VolcengineVoiceTransport';

type VoiceSessionBackend = {
  createSession(params: { conversation_id?: string }): Promise<VoiceSessionCreateResponse>;
  startSession(sessionId: string): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  runTurn(sessionId: string, text: string): Promise<VoiceTurnResponse>;
};

type VoiceTransportFactory = (
  credentials: VoiceSessionCreateResponse['rtc'],
  callbacks: VoiceTransportCallbacks
) => VoiceTransport;

const initialSnapshot = (): VoiceSessionSnapshot => ({
  connection: 'idle',
  agent: 'idle',
  microphoneEnabled: true,
  userTranscript: '',
  agentTranscript: '',
});

const defaultBackend: VoiceSessionBackend = {
  createSession: (params) => ipcBridge.voice.createSession.invoke(params),
  startSession: (sessionId) => ipcBridge.voice.startSession.invoke({ session_id: sessionId }),
  stopSession: (sessionId) => ipcBridge.voice.stopSession.invoke({ session_id: sessionId }),
  runTurn: (sessionId, text) => ipcBridge.voice.runTurn.invoke({ session_id: sessionId, text }),
};

const defaultTransportFactory: VoiceTransportFactory = (credentials, callbacks) =>
  new VolcengineVoiceTransport(credentials, callbacks);

const assertSessionResponse = (response: VoiceSessionCreateResponse): void => {
  if (
    !response.session_id ||
    !response.rtc?.app_id ||
    !response.rtc.room_id ||
    !response.rtc.user_id ||
    !response.rtc.token
  ) {
    throw new Error('VOICE_SESSION_INVALID_RESPONSE');
  }
};

export class VoiceSession {
  private static readonly DUPLICATE_TRANSCRIPT_WINDOW_MS = 1_500;

  private snapshot = initialSnapshot();
  private readonly listeners = new Set<(snapshot: VoiceSessionSnapshot) => void>();
  private sessionId: string | null = null;
  private transport: VoiceTransport | null = null;
  private lifecycleId = 0;
  private lastFinalUserTranscript = '';
  private lastFinalUserTranscriptAt = 0;
  private queuedUserTranscripts: string[] = [];
  private voiceTurnRunning = false;

  constructor(
    private readonly conversationId?: string,
    private readonly backend: VoiceSessionBackend = defaultBackend,
    private readonly transportFactory: VoiceTransportFactory = defaultTransportFactory
  ) {}

  getSnapshot = (): VoiceSessionSnapshot => this.snapshot;

  subscribe = (listener: (snapshot: VoiceSessionSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<VoiceSessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  async start(): Promise<void> {
    if (this.snapshot.connection === 'connecting' || this.snapshot.connection === 'connected') return;

    const lifecycleId = ++this.lifecycleId;
    this.lastFinalUserTranscript = '';
    this.lastFinalUserTranscriptAt = 0;
    this.queuedUserTranscripts = [];
    this.voiceTurnRunning = false;
    this.update({ ...initialSnapshot(), connection: 'connecting' });

    let response: VoiceSessionCreateResponse | null = null;
    let transport: VoiceTransport | null = null;
    try {
      response = await this.backend.createSession({ conversation_id: this.conversationId });
      assertSessionResponse(response);
      if (lifecycleId !== this.lifecycleId) {
        await this.backend.stopSession(response.session_id).catch((): void => {});
        return;
      }
      this.sessionId = response.session_id;
      transport = this.transportFactory(response.rtc, this.createTransportCallbacks(lifecycleId));
      this.transport = transport;
      await transport.connect();
      if (lifecycleId !== this.lifecycleId) {
        await transport.disconnect().catch((): void => {});
        await this.backend.stopSession(response.session_id).catch((): void => {});
        if (this.transport === transport) this.transport = null;
        if (this.sessionId === response.session_id) this.sessionId = null;
        return;
      }
      await this.backend.startSession(response.session_id);
      if (lifecycleId !== this.lifecycleId) {
        await transport.disconnect().catch((): void => {});
        await this.backend.stopSession(response.session_id).catch((): void => {});
        if (this.transport === transport) this.transport = null;
        if (this.sessionId === response.session_id) this.sessionId = null;
        return;
      }
      this.update({ connection: 'connected', agent: 'listening', microphoneEnabled: true });
    } catch (error) {
      await transport?.disconnect().catch((): void => {});
      let backendStopped = true;
      if (response?.session_id) {
        try {
          await this.backend.stopSession(response.session_id);
        } catch {
          backendStopped = false;
        }
      }
      if (lifecycleId !== this.lifecycleId) return;
      if (this.transport === transport) this.transport = null;
      if (backendStopped && this.sessionId === response?.session_id) this.sessionId = null;
      this.update({
        connection: 'error',
        agent: 'idle',
        microphoneEnabled: false,
        errorCode: error instanceof Error ? error.message : 'VOICE_SESSION_START_FAILED',
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.lifecycleId += 1;
    const transport = this.transport;
    const sessionId = this.sessionId;
    this.transport = null;
    this.queuedUserTranscripts = [];

    await transport?.disconnect().catch((): void => {});
    if (sessionId) {
      try {
        await this.backend.stopSession(sessionId);
      } catch {
        this.update({
          connection: 'error',
          agent: 'idle',
          microphoneEnabled: false,
          errorCode: 'VOICE_SESSION_STOP_FAILED',
        });
        throw new Error('VOICE_SESSION_STOP_FAILED');
      }
    }
    if (this.sessionId === sessionId) this.sessionId = null;
    this.update({
      connection: 'ended',
      agent: 'idle',
      microphoneEnabled: false,
      errorCode: undefined,
    });
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (!this.transport || this.snapshot.connection !== 'connected') return;
    await this.transport.setMicrophoneEnabled(enabled);
    this.update({ microphoneEnabled: enabled });
  }

  private createTransportCallbacks(lifecycleId: number): VoiceTransportCallbacks {
    return {
      onConnectionChange: (connection) => {
        if (lifecycleId !== this.lifecycleId) return;
        if (connection === 'error') {
          void this.fail('VOICE_RTC_DISCONNECTED', lifecycleId);
          return;
        }
        this.update({
          connection,
          microphoneEnabled: this.snapshot.microphoneEnabled,
        });
      },
      onAgentStateChange: (agent) => {
        if (lifecycleId === this.lifecycleId) this.update({ agent });
      },
      onTranscript: (speaker, text, final) => {
        if (lifecycleId !== this.lifecycleId) return;
        if (speaker === 'user') {
          this.update({ userTranscript: text });
          if (final) this.enqueueUserTurn(text);
        } else if (!this.voiceTurnRunning) {
          this.update({ agentTranscript: text });
        }
      },
      onError: (errorCode) => void this.fail(errorCode, lifecycleId),
    };
  }

  private async fail(errorCode: string, lifecycleId: number): Promise<void> {
    if (lifecycleId !== this.lifecycleId) return;
    this.lifecycleId += 1;
    const transport = this.transport;
    const sessionId = this.sessionId;
    this.transport = null;
    this.queuedUserTranscripts = [];
    await transport?.disconnect().catch((): void => {});
    if (sessionId) {
      try {
        await this.backend.stopSession(sessionId);
        if (this.sessionId === sessionId) this.sessionId = null;
      } catch {
        // Keep the session id so the user can retry cleanup through stop().
      }
    }
    this.update({ connection: 'error', agent: 'idle', microphoneEnabled: false, errorCode });
  }

  private enqueueUserTurn(text: string): void {
    const normalized = text.trim();
    const now = Date.now();
    if (
      !normalized ||
      (normalized === this.lastFinalUserTranscript &&
        now - this.lastFinalUserTranscriptAt < VoiceSession.DUPLICATE_TRANSCRIPT_WINDOW_MS)
    )
      return;
    this.lastFinalUserTranscript = normalized;
    this.lastFinalUserTranscriptAt = now;
    this.queuedUserTranscripts.push(normalized);
    if (!this.voiceTurnRunning) void this.drainUserTurns();
  }

  private async drainUserTurns(): Promise<void> {
    this.voiceTurnRunning = true;
    try {
      while (this.queuedUserTranscripts.length > 0) {
        const text = this.queuedUserTranscripts.shift();
        if (!text) continue;
        const sessionId = this.sessionId;
        const lifecycleId = this.lifecycleId;
        if (!sessionId || this.snapshot.connection !== 'connected') return;

        this.update({ agent: 'thinking', errorCode: undefined });
        try {
          // Voice turns must stay ordered so later speech cannot overtake the active agent turn.
          // eslint-disable-next-line no-await-in-loop
          const response = await this.backend.runTurn(sessionId, text);
          if (this.sessionId !== sessionId || this.lifecycleId !== lifecycleId) return;
          this.update({ agent: 'speaking', agentTranscript: response.text, errorCode: undefined });
        } catch {
          if (this.sessionId !== sessionId || this.lifecycleId !== lifecycleId) return;
          this.update({ agent: 'listening', errorCode: 'VOICE_AGENT_TURN_FAILED' });
        }
      }
    } finally {
      this.voiceTurnRunning = false;
    }
  }
}
