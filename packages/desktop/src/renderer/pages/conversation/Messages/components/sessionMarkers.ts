/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AIONUI_SESSION_MARKER_ENVELOPE_VERSION,
  AIONUI_SESSION_MESSAGE_END_MARKER,
  AIONUI_SESSION_MESSAGE_MARKER,
  AIONUI_SESSIONS_END_MARKER,
  AIONUI_SESSIONS_MARKER,
} from '@/common/config/constants';

export type SessionMentionChip = {
  name: string;
  id: string;
  workspace: string;
};

export type SessionDeliverySource = {
  fromName: string;
  fromId: string;
  workspace: string;
  replyTo: string;
};

type ContentLine = {
  text: string;
  start: number;
  end: number;
};

type ExtractedBlock = {
  body: string[];
  text: string;
};

const REPLY_INSTRUCTION = 'session send-message, to=reply_to';

function contentLines(content: string): ContentLine[] {
  let start = 0;
  return content.split('\n').map((text) => {
    const line = { text, start, end: start + text.length };
    start = line.end + 1;
    return line;
  });
}

/** Sender envelopes are backend-appended and must be the terminal block. */
function extractTerminalBlock(content: string, startMarker: string, endMarker: string): ExtractedBlock | null {
  const lines = contentLines(content);
  const endIndex = lines.length - 1;
  if (lines[endIndex]?.text !== endMarker) return null;

  let startIndex = -1;
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    if (lines[index].text === startMarker) {
      startIndex = index;
      break;
    }
  }
  if (startIndex === -1) return null;

  const markerOffset = lines[startIndex].start;
  if (markerOffset < 2 || content.slice(markerOffset - 2, markerOffset) !== '\n\n') return null;

  return {
    body: lines.slice(startIndex + 1, endIndex).map((line) => line.text),
    text: content.slice(0, markerOffset - 2),
  };
}

/** Recipient envelopes are backend-prepended and must be the leading block. */
function extractLeadingBlock(content: string, startMarker: string, endMarker: string): ExtractedBlock | null {
  const lines = contentLines(content);
  if (lines[0]?.text !== startMarker) return null;

  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].text === endMarker) {
      endIndex = index;
      break;
    }
  }
  if (endIndex === -1) return null;

  const markerEndOffset = lines[endIndex].end;
  if (content.slice(markerEndOffset, markerEndOffset + 2) !== '\n\n') return null;

  return {
    body: lines.slice(1, endIndex).map((line) => line.text),
    text: content.slice(markerEndOffset + 2),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function parseV2Sessions(body: string[]): SessionMentionChip[] | null {
  if (body.length !== 2 || body[0] !== AIONUI_SESSION_MARKER_ENVELOPE_VERSION) return null;
  const payload = parseJsonLine(body[1]);
  if (!hasExactKeys(payload, ['sessions']) || !Array.isArray(payload.sessions) || payload.sessions.length === 0) {
    return null;
  }

  const sessions: SessionMentionChip[] = [];
  for (const target of payload.sessions) {
    if (!hasExactKeys(target, ['name', 'id', 'workspace'])) return null;
    if (!isNonEmptyString(target.name) || !isNonEmptyString(target.id) || !isNonEmptyString(target.workspace)) {
      return null;
    }
    sessions.push({ name: target.name, id: target.id, workspace: target.workspace });
  }
  return sessions;
}

function parseLegacySessions(body: string[]): SessionMentionChip[] | null {
  const sessions: SessionMentionChip[] = [];
  for (const line of body.map((value) => value.trim()).filter((value) => value.length > 0)) {
    const parts = line.split('\t');
    if (parts.length !== 3) return null;
    const [name, id, workspaceField] = parts;
    if (!name || !id || !workspaceField.startsWith('workspace: ')) return null;
    const workspace = workspaceField.slice('workspace: '.length);
    if (!workspace) return null;
    sessions.push({ name, id, workspace });
  }
  return sessions.length > 0 ? sessions : null;
}

/**
 * Sender side: reverse the `[[AION_SESSIONS]]` block the backend appended to the
 * user's own message so the bubble shows chips instead of raw markers.
 */
export function parseSessionsBlock(content: string): { text: string; sessions: SessionMentionChip[] } {
  const block = extractTerminalBlock(content, AIONUI_SESSIONS_MARKER, AIONUI_SESSIONS_END_MARKER);
  if (!block) return { text: content, sessions: [] };

  const sessions =
    block.body[0] === AIONUI_SESSION_MARKER_ENVELOPE_VERSION
      ? parseV2Sessions(block.body)
      : parseLegacySessions(block.body);
  if (!sessions) return { text: content, sessions: [] };
  return { text: block.text, sessions };
}

/**
 * Recipient side: reverse the `[[AION_SESSION_MESSAGE]]` block so the bubble can
 * show a "from conversation X" badge. Same content the agent read — one source
 * of truth, no artifact (spec §5.6).
 */
export function parseSessionMessageBlock(content: string): { text: string; source: SessionDeliverySource | null } {
  const block = extractLeadingBlock(content, AIONUI_SESSION_MESSAGE_MARKER, AIONUI_SESSION_MESSAGE_END_MARKER);
  if (!block) return { text: content, source: null };

  if (block.body[0] === AIONUI_SESSION_MARKER_ENVELOPE_VERSION) {
    if (block.body.length !== 2) return { text: content, source: null };
    const payload = parseJsonLine(block.body[1]);
    if (
      !hasExactKeys(payload, ['from', 'workspace', 'reply_to', 'reply_instruction']) ||
      !hasExactKeys(payload.from, ['name', 'id']) ||
      !isNonEmptyString(payload.from.name) ||
      !isNonEmptyString(payload.from.id) ||
      !isNonEmptyString(payload.workspace) ||
      !isNonEmptyString(payload.reply_to) ||
      payload.reply_instruction !== REPLY_INSTRUCTION
    ) {
      return { text: content, source: null };
    }
    return {
      text: block.text,
      source: {
        fromName: payload.from.name,
        fromId: payload.from.id,
        workspace: payload.workspace,
        replyTo: payload.reply_to,
      },
    };
  }

  let fromName = '';
  let fromId = '';
  let workspace = '';
  let replyTo = '';
  let hasFrom = false;
  let hasWorkspace = false;
  let hasReplyTo = false;
  let invalid = false;
  for (const line of block.body.map((value) => value.trim()).filter((value) => value.length > 0)) {
    if (line.startsWith('from: ')) {
      const fromParts = line.slice('from: '.length).split('\t');
      if (hasFrom || fromParts.length !== 2) {
        invalid = true;
        continue;
      }
      hasFrom = true;
      const [name, id] = fromParts;
      fromName = name ?? '';
      fromId = id ?? '';
    } else if (line.startsWith('workspace: ')) {
      if (hasWorkspace) {
        invalid = true;
        continue;
      }
      hasWorkspace = true;
      workspace = line.slice('workspace: '.length);
    } else if (line.startsWith('reply_to: ')) {
      if (hasReplyTo) {
        invalid = true;
        continue;
      }
      hasReplyTo = true;
      // The value is followed by a tab and the short reply hint meant for the
      // agent; the UI only needs the address.
      replyTo = line.slice('reply_to: '.length).split('\t')[0] ?? '';
    } else {
      invalid = true;
    }
  }

  if (invalid || !fromName || !fromId || !workspace || !replyTo) {
    // Present but unparseable — treat as an ordinary message rather than
    // rendering an empty badge.
    return { text: content, source: null };
  }

  return { text: block.text, source: { fromName, fromId, workspace, replyTo } };
}
