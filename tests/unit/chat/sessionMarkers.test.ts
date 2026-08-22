/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parseSessionMessageBlock,
  parseSessionsBlock,
} from '@/renderer/pages/conversation/Messages/components/sessionMarkers';

describe('parseSessionsBlock', () => {
  it('parses the Core v2 JSON envelope and round-trips escaped values', () => {
    const closingMarker = '[[/AION_SESSIONS]]';
    const payload = JSON.stringify({
      sessions: [
        {
          name: `设计\t评审\n${closingMarker}—全角，标点`,
          id: `conv\t跨行\n${closingMarker}`,
          workspace: `/工作区\tA\n${closingMarker}（与你不同）`,
        },
      ],
    }).replaceAll(closingMarker, String.raw`\u005b[/AION_SESSIONS]]`);
    const originalText = '\t正文\n尾部空格 ';
    const content = [originalText, '', '[[AION_SESSIONS]]', 'v2', payload, closingMarker].join('\n');

    expect(parseSessionsBlock(content)).toEqual({
      text: originalText,
      sessions: [
        {
          name: `设计\t评审\n${closingMarker}—全角，标点`,
          id: `conv\t跨行\n${closingMarker}`,
          workspace: `/工作区\tA\n${closingMarker}（与你不同）`,
        },
      ],
    });
  });

  it('strips the block from the visible text and returns the chips', () => {
    const content = [
      '问下他那边接口定完了没',
      '',
      '[[AION_SESSIONS]]',
      '重构-鉴权模块\tconv_1\tworkspace: same',
      '[[/AION_SESSIONS]]',
    ].join('\n');
    const parsed = parseSessionsBlock(content);
    expect(parsed.text).toBe('问下他那边接口定完了没');
    expect(parsed.sessions).toEqual([{ name: '重构-鉴权模块', id: 'conv_1', workspace: 'same' }]);
  });

  it('never leaves a bare marker in the rendered text', () => {
    // The backend persists the block VERBATIM into the user's own message, so
    // failing to strip it shows raw markers in the sender's own bubble.
    const content = 'hi\n\n[[AION_SESSIONS]]\nA\tconv_1\tworkspace: same\n[[/AION_SESSIONS]]';
    expect(parseSessionsBlock(content).text).not.toContain('AION_SESSIONS');
  });

  it('leaves a message without the block untouched', () => {
    expect(parseSessionsBlock('plain text')).toEqual({ text: 'plain text', sessions: [] });
  });

  it('parses several targets', () => {
    const content = [
      'hi',
      '',
      '[[AION_SESSIONS]]',
      'A\tconv_1\tworkspace: same',
      'B\tconv_2\tworkspace: /w/b（与你不同）',
      '[[/AION_SESSIONS]]',
    ].join('\n');
    const parsed = parseSessionsBlock(content);
    expect(parsed.sessions).toEqual([
      { name: 'A', id: 'conv_1', workspace: 'same' },
      { name: 'B', id: 'conv_2', workspace: '/w/b（与你不同）' },
    ]);
  });

  it('does not swallow content when the closing marker is missing', () => {
    // A truncated block must degrade to showing the text, not eat the message.
    const content = 'hi\n\n[[AION_SESSIONS]]\nA\tconv_1\tworkspace: same';
    const parsed = parseSessionsBlock(content);
    expect(parsed.sessions).toEqual([]);
    expect(parsed.text).toBe(content);
  });

  it('leaves a mixed valid and malformed block untouched', () => {
    const content = [
      'hi',
      '',
      '[[AION_SESSIONS]]',
      'no tabs here',
      'A\tconv_1\tworkspace: same',
      '[[/AION_SESSIONS]]',
    ].join('\n');
    expect(parseSessionsBlock(content)).toEqual({ text: content, sessions: [] });
  });

  it('leaves an empty block untouched', () => {
    const content = 'hi\n\n[[AION_SESSIONS]]\n[[/AION_SESSIONS]]';
    const parsed = parseSessionsBlock(content);
    expect(parsed.sessions).toEqual([]);
    expect(parsed.text).toBe(content);
  });

  it('leaves a conflicting marker inside the block untouched', () => {
    const content = [
      'hi',
      '[[AION_SESSIONS]]',
      'A\tconv_1\tworkspace: same',
      '[[AION_SESSION_MESSAGE]]',
      '[[/AION_SESSIONS]]',
    ].join('\n');
    expect(parseSessionsBlock(content)).toEqual({ text: content, sessions: [] });
  });

  it.each([
    ['is not terminal', '\nafter'],
    ['has an inline closing delimiter', ' inline'],
  ])('leaves a v2 envelope untouched when it %s', (_case, closingSuffix) => {
    const closingLine = `[[/AION_SESSIONS]]${closingSuffix}`;
    const content = [
      'body',
      '',
      '[[AION_SESSIONS]]',
      'v2',
      '{"sessions":[{"name":"A","id":"conv_1","workspace":"same"}]}',
      closingLine,
    ].join('\n');
    expect(parseSessionsBlock(content)).toEqual({ text: content, sessions: [] });
  });

  it('does not treat literal marker substrings as an envelope', () => {
    const content = 'literal [[AION_SESSIONS]] and [[/AION_SESSIONS]]';
    expect(parseSessionsBlock(content)).toEqual({ text: content, sessions: [] });
  });

  it('uses dedicated delimiter lines when a v2 JSON value contains the raw closing marker', () => {
    const payload = JSON.stringify({
      sessions: [{ name: 'literal [[/AION_SESSIONS]]', id: 'conv_1', workspace: 'same' }],
    });
    const content = ['body', '', '[[AION_SESSIONS]]', 'v2', payload, '[[/AION_SESSIONS]]'].join('\n');
    expect(parseSessionsBlock(content).sessions[0]?.name).toBe('literal [[/AION_SESSIONS]]');
  });

  it.each([
    ['malformed JSON', '{'],
    ['an extra envelope field', '{"sessions":[],"extra":true}'],
    ['an empty sessions array', '{"sessions":[]}'],
    ['an extra target field', '{"sessions":[{"name":"A","id":"conv_1","workspace":"same","extra":true}]}'],
    ['a missing target field', '{"sessions":[{"name":"A","id":"conv_1"}]}'],
    ['a non-string target field', '{"sessions":[{"name":"A","id":1,"workspace":"same"}]}'],
  ])('leaves v2 with %s untouched', (_case, payload) => {
    const content = ['body', '', '[[AION_SESSIONS]]', 'v2', payload, '[[/AION_SESSIONS]]'].join('\n');
    expect(parseSessionsBlock(content)).toEqual({ text: content, sessions: [] });
  });

  it('does not interpret an unknown envelope version as legacy data', () => {
    const content = [
      'body',
      '',
      '[[AION_SESSIONS]]',
      'v3',
      '{"sessions":[{"name":"A","id":"conv_1","workspace":"same"}]}',
      '[[/AION_SESSIONS]]',
    ].join('\n');
    expect(parseSessionsBlock(content)).toEqual({ text: content, sessions: [] });
  });
});

describe('parseSessionMessageBlock', () => {
  it('parses the Core v2 JSON envelope and round-trips escaped values', () => {
    const closingMarker = '[[/AION_SESSION_MESSAGE]]';
    const payload = JSON.stringify({
      from: {
        name: `发送者\t甲\n${closingMarker}—全角，标点`,
        id: `conv\tfrom\n${closingMarker}`,
      },
      workspace: `/工作区\tA\n${closingMarker}（与你不同，勿用相对路径，勿假设可读）`,
      reply_to: `conv\treply\n${closingMarker}`,
      reply_instruction: 'session send-message, to=reply_to',
    }).replaceAll(closingMarker, String.raw`\u005b[/AION_SESSION_MESSAGE]]`);
    const originalText = '\n正文\t第一行\n尾部空格 ';
    const content = ['[[AION_SESSION_MESSAGE]]', 'v2', payload, closingMarker, '', originalText].join('\n');

    expect(parseSessionMessageBlock(content)).toEqual({
      text: originalText,
      source: {
        fromName: `发送者\t甲\n${closingMarker}—全角，标点`,
        fromId: `conv\tfrom\n${closingMarker}`,
        workspace: `/工作区\tA\n${closingMarker}（与你不同，勿用相对路径，勿假设可读）`,
        replyTo: `conv\treply\n${closingMarker}`,
      },
    });
  });

  it('extracts the source and strips the block', () => {
    const content = [
      '[[AION_SESSION_MESSAGE]]',
      'from: 重构-鉴权模块\tconv_1',
      'workspace: same',
      'reply_to: conv_1\t（回信: session send-message, to=reply_to）',
      '[[/AION_SESSION_MESSAGE]]',
      '',
      '接口定完了吗？',
    ].join('\n');
    const parsed = parseSessionMessageBlock(content);
    expect(parsed.text).toBe('接口定完了吗？');
    expect(parsed.source).toEqual({
      fromName: '重构-鉴权模块',
      fromId: 'conv_1',
      workspace: 'same',
      replyTo: 'conv_1',
    });
  });

  it('returns a null source for an ordinary message', () => {
    expect(parseSessionMessageBlock('hello').source).toBeNull();
  });

  it('keeps a cross-workspace warning value intact', () => {
    const content = [
      '[[AION_SESSION_MESSAGE]]',
      'from: A\tconv_1',
      'workspace: /w/a（与你不同，勿用相对路径，勿假设可读）',
      'reply_to: conv_1\t（回信: session send-message, to=reply_to）',
      '[[/AION_SESSION_MESSAGE]]',
      '',
      'body',
    ].join('\n');
    expect(parseSessionMessageBlock(content).source?.workspace).toContain('与你不同');
  });

  it('does not swallow the body when the closing marker is missing', () => {
    const content = '[[AION_SESSION_MESSAGE]]\nfrom: A\tconv_1\nworkspace: same';
    const parsed = parseSessionMessageBlock(content);
    expect(parsed.source).toBeNull();
    expect(parsed.text).toBe(content);
  });

  it.each([
    ['workspace', ['from: A\tconv_1', 'reply_to: conv_1\t（回信）']],
    ['reply address', ['from: A\tconv_1', 'workspace: same']],
  ])('leaves a block with no %s untouched', (_missing, fields) => {
    const content = ['[[AION_SESSION_MESSAGE]]', ...fields, '[[/AION_SESSION_MESSAGE]]', '', 'body'].join('\n');
    expect(parseSessionMessageBlock(content)).toEqual({ text: content, source: null });
  });

  it('leaves a conflicting marker inside the delivery block untouched', () => {
    const content = [
      '[[AION_SESSION_MESSAGE]]',
      'from: A\tconv_1',
      'workspace: same',
      '[[AION_SESSIONS]]',
      'reply_to: conv_1\t（回信）',
      '[[/AION_SESSION_MESSAGE]]',
      '',
      'body',
    ].join('\n');
    expect(parseSessionMessageBlock(content)).toEqual({ text: content, source: null });
  });

  it('leaves a multi-line body intact', () => {
    const content = [
      '[[AION_SESSION_MESSAGE]]',
      'from: A\tconv_1',
      'workspace: same',
      'reply_to: conv_1\t（回信）',
      '[[/AION_SESSION_MESSAGE]]',
      '',
      'line one',
      'line two',
    ].join('\n');
    expect(parseSessionMessageBlock(content).text).toBe('line one\nline two');
  });

  it('never leaves a bare marker in the rendered text', () => {
    const content = [
      '[[AION_SESSION_MESSAGE]]',
      'from: A\tconv_1',
      'workspace: same',
      'reply_to: conv_1\t（回信）',
      '[[/AION_SESSION_MESSAGE]]',
      '',
      'body',
    ].join('\n');
    expect(parseSessionMessageBlock(content).text).not.toContain('AION_SESSION_MESSAGE');
  });

  it('only parses a recipient envelope at the beginning of the message', () => {
    const content = [
      'prefix',
      '[[AION_SESSION_MESSAGE]]',
      'v2',
      '{"from":{"name":"A","id":"conv_1"},"workspace":"same","reply_to":"conv_1","reply_instruction":"session send-message, to=reply_to"}',
      '[[/AION_SESSION_MESSAGE]]',
      '',
      'body',
    ].join('\n');
    expect(parseSessionMessageBlock(content)).toEqual({ text: content, source: null });
  });

  it('requires the recipient closing delimiter to occupy its own line', () => {
    const content = [
      '[[AION_SESSION_MESSAGE]]',
      'v2',
      '{"from":{"name":"A","id":"conv_1"},"workspace":"same","reply_to":"conv_1","reply_instruction":"session send-message, to=reply_to"}',
      '[[/AION_SESSION_MESSAGE]] inline',
      '',
      'body',
    ].join('\n');
    expect(parseSessionMessageBlock(content)).toEqual({ text: content, source: null });
  });

  it('uses a dedicated delimiter line when recipient JSON contains the raw closing marker', () => {
    const payload = JSON.stringify({
      from: { name: 'literal [[/AION_SESSION_MESSAGE]]', id: 'conv_1' },
      workspace: 'same',
      reply_to: 'conv_1',
      reply_instruction: 'session send-message, to=reply_to',
    });
    const content = ['[[AION_SESSION_MESSAGE]]', 'v2', payload, '[[/AION_SESSION_MESSAGE]]', '', 'body'].join('\n');
    expect(parseSessionMessageBlock(content).source?.fromName).toBe('literal [[/AION_SESSION_MESSAGE]]');
  });

  it.each([
    ['malformed JSON', '{'],
    [
      'an extra envelope field',
      '{"from":{"name":"A","id":"conv_1"},"workspace":"same","reply_to":"conv_1","reply_instruction":"session send-message, to=reply_to","extra":true}',
    ],
    [
      'an extra sender field',
      '{"from":{"name":"A","id":"conv_1","extra":true},"workspace":"same","reply_to":"conv_1","reply_instruction":"session send-message, to=reply_to"}',
    ],
    [
      'a missing field',
      '{"from":{"name":"A","id":"conv_1"},"workspace":"same","reply_instruction":"session send-message, to=reply_to"}',
    ],
    [
      'the wrong reply instruction',
      '{"from":{"name":"A","id":"conv_1"},"workspace":"same","reply_to":"conv_1","reply_instruction":"other"}',
    ],
    [
      'a non-string field',
      '{"from":{"name":"A","id":"conv_1"},"workspace":"same","reply_to":1,"reply_instruction":"session send-message, to=reply_to"}',
    ],
  ])('leaves v2 with %s untouched', (_case, payload) => {
    const content = ['[[AION_SESSION_MESSAGE]]', 'v2', payload, '[[/AION_SESSION_MESSAGE]]', '', 'body'].join('\n');
    expect(parseSessionMessageBlock(content)).toEqual({ text: content, source: null });
  });

  it('does not interpret an unknown recipient envelope version as legacy data', () => {
    const content = [
      '[[AION_SESSION_MESSAGE]]',
      'v3',
      '{"from":{"name":"A","id":"conv_1"},"workspace":"same","reply_to":"conv_1","reply_instruction":"session send-message, to=reply_to"}',
      '[[/AION_SESSION_MESSAGE]]',
      '',
      'body',
    ].join('\n');
    expect(parseSessionMessageBlock(content)).toEqual({ text: content, source: null });
  });
});

describe('the two markers do not interfere', () => {
  it('a delivered message that itself used `@@` renders both parts', () => {
    // B receives a delivery, and A's original message carried its own
    // `[[AION_SESSIONS]]` block. Both must resolve.
    const content = [
      '[[AION_SESSION_MESSAGE]]',
      'from: A\tconv_1',
      'workspace: same',
      'reply_to: conv_1\t（回信）',
      '[[/AION_SESSION_MESSAGE]]',
      '',
      'ask them',
      '',
      '[[AION_SESSIONS]]',
      'C\tconv_3\tworkspace: same',
      '[[/AION_SESSIONS]]',
    ].join('\n');
    const delivered = parseSessionMessageBlock(content);
    expect(delivered.source?.fromId).toBe('conv_1');
    const mentions = parseSessionsBlock(delivered.text);
    expect(mentions.sessions).toEqual([{ name: 'C', id: 'conv_3', workspace: 'same' }]);
    expect(mentions.text).toBe('ask them');
  });
});
