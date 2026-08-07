/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  decodeVoiceTlv,
  encodeVoiceTlv,
  encodeVoiceToolResult,
  parseVoiceProtocolEvent,
} from '@/renderer/services/voice/voiceProtocol';

describe('voiceProtocol', () => {
  it('decodes agent state and subtitle events', () => {
    expect(parseVoiceProtocolEvent(encodeVoiceTlv('conv', { Stage: { Code: 2 } }))).toEqual({
      type: 'agent-state',
      state: 'thinking',
    });
    expect(
      parseVoiceProtocolEvent(encodeVoiceTlv('subv', { data: [{ userId: 'user-1', text: 'hello', definite: true }] }))
    ).toEqual({ type: 'transcript', speakerId: 'user-1', text: 'hello', final: true });
  });

  it('parses function call arguments', () => {
    expect(
      parseVoiceProtocolEvent(
        encodeVoiceTlv('tool', {
          tool_calls: [{ id: 'call-1', function: { name: 'lookup_order', arguments: '{"id":"42"}' } }],
        })
      )
    ).toEqual({
      type: 'tool-call',
      callId: 'call-1',
      name: 'lookup_order',
      arguments: { id: '42' },
    });
  });

  it('rejects malformed TLV frames', () => {
    expect(decodeVoiceTlv(new Uint8Array([1, 2, 3]).buffer)).toBeNull();
    const malformed = encodeVoiceTlv('tool', { ok: true });
    new DataView(malformed).setUint32(4, 9999, false);
    expect(decodeVoiceTlv(malformed)).toBeNull();
  });

  it('encodes function results using the provider func envelope', () => {
    const decoded = decodeVoiceTlv(encodeVoiceToolResult('call-1', { status: 'completed', output: 42 }));
    expect(decoded).toEqual({
      type: 'func',
      value: {
        ToolCallID: 'call-1',
        Content: '{"status":"completed","output":42}',
      },
    });
  });
});
