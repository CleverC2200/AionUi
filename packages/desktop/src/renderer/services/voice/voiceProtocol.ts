/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type VoiceProtocolEvent =
  | { type: 'agent-state'; state: 'listening' | 'thinking' | 'speaking' }
  | { type: 'transcript'; speakerId: string; text: string; final: boolean }
  | { type: 'tool-call'; callId: string; name: string; arguments: unknown }
  | { type: 'unknown' };

const MESSAGE_TYPE = {
  agentState: 'conv',
  subtitle: 'subv',
  toolCall: 'tool',
} as const;

const AGENT_STAGE = {
  listening: 1,
  thinking: 2,
  speaking: 3,
  interrupted: 4,
  finished: 5,
} as const;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const encodeVoiceTlv = (type: string, value: unknown): ArrayBuffer => {
  const typeBytes = new Uint8Array(4);
  for (let index = 0; index < Math.min(type.length, typeBytes.length); index += 1) {
    typeBytes[index] = type.charCodeAt(index);
  }

  const valueBytes = new TextEncoder().encode(JSON.stringify(value));
  const frame = new Uint8Array(typeBytes.length + 4 + valueBytes.length);
  frame.set(typeBytes, 0);
  const view = new DataView(frame.buffer);
  view.setUint32(4, valueBytes.length, false);
  frame.set(valueBytes, 8);
  return frame.buffer;
};

export const decodeVoiceTlv = (frame: ArrayBuffer): { type: string; value: unknown } | null => {
  if (frame.byteLength < 8) return null;

  const bytes = new Uint8Array(frame);
  const type = String.fromCharCode(...bytes.subarray(0, 4)).replaceAll('\0', '');
  const valueLength = new DataView(frame).getUint32(4, false);
  if (valueLength > frame.byteLength - 8) return null;

  try {
    const text = new TextDecoder().decode(bytes.subarray(8, 8 + valueLength));
    return { type, value: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
};

const parseArguments = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

export const parseVoiceProtocolEvent = (frame: ArrayBuffer): VoiceProtocolEvent => {
  const decoded = decodeVoiceTlv(frame);
  if (!decoded || !isRecord(decoded.value)) return { type: 'unknown' };

  if (decoded.type === MESSAGE_TYPE.agentState) {
    const stage = decoded.value.Stage;
    const code = isRecord(stage) ? stage.Code : undefined;
    if (code === AGENT_STAGE.thinking) return { type: 'agent-state', state: 'thinking' };
    if (code === AGENT_STAGE.speaking) return { type: 'agent-state', state: 'speaking' };
    if (code === AGENT_STAGE.listening || code === AGENT_STAGE.interrupted || code === AGENT_STAGE.finished) {
      return { type: 'agent-state', state: 'listening' };
    }
    return { type: 'unknown' };
  }

  if (decoded.type === MESSAGE_TYPE.subtitle) {
    const first = Array.isArray(decoded.value.data) ? decoded.value.data[0] : undefined;
    if (!isRecord(first) || typeof first.text !== 'string' || typeof first.userId !== 'string') {
      return { type: 'unknown' };
    }
    return {
      type: 'transcript',
      speakerId: first.userId,
      text: first.text,
      final: first.definite === true || first.paragraph === true,
    };
  }

  if (decoded.type === MESSAGE_TYPE.toolCall) {
    const first = Array.isArray(decoded.value.tool_calls) ? decoded.value.tool_calls[0] : undefined;
    const fn = isRecord(first) ? first.function : undefined;
    if (!isRecord(first) || typeof first.id !== 'string' || !isRecord(fn) || typeof fn.name !== 'string') {
      return { type: 'unknown' };
    }
    return {
      type: 'tool-call',
      callId: first.id,
      name: fn.name,
      arguments: parseArguments(fn.arguments),
    };
  }

  return { type: 'unknown' };
};

export const encodeVoiceToolResult = (callId: string, content: unknown): ArrayBuffer =>
  encodeVoiceTlv('func', {
    ToolCallID: callId,
    Content: typeof content === 'string' ? content : JSON.stringify(content),
  });
