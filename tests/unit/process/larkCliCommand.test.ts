/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  buildLarkCliInvocation,
  normalizeLarkCliOutput,
  truncateUtf8,
} from '@/process/resources/builtinMcp/larkCliCommand';

describe('buildLarkCliInvocation', () => {
  it('appends dry-run and jq after the command tokens', () => {
    expect(buildLarkCliInvocation({ argv: ['docs', '+fetch', '--doc', 'abc'], dryRun: true, jq: '.ok' })).toEqual([
      'docs',
      '+fetch',
      '--doc',
      'abc',
      '--dry-run',
      '--jq',
      '.ok',
    ]);
  });

  it('passes argv through unchanged when no options are set', () => {
    expect(buildLarkCliInvocation({ argv: ['calendar', '+agenda'] })).toEqual(['calendar', '+agenda']);
  });

  it('does not mutate the input argv array', () => {
    const argv = ['docs', '+fetch'];
    buildLarkCliInvocation({ argv, dryRun: true });
    expect(argv).toEqual(['docs', '+fetch']);
  });
});

describe('truncateUtf8', () => {
  it('returns the text unchanged when under the limit', () => {
    expect(truncateUtf8('hello', 100)).toEqual({ text: 'hello', truncated: false });
  });

  it('truncates and marks when over the limit', () => {
    const result = truncateUtf8('abcdef', 3);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('[output truncated to 3 bytes]');
  });

  it('never splits a multi-byte codepoint', () => {
    const result = truncateUtf8('你好', 3);
    expect(result.text.startsWith('你')).toBe(true);
  });
});

describe('normalizeLarkCliOutput', () => {
  it('pretty-prints a JSON object', () => {
    const value = { ok: true, data: [1, 2] };
    const result = normalizeLarkCliOutput(JSON.stringify(value), 1024);
    expect(result.text).toBe(JSON.stringify(value, null, 2));
  });

  it('passes through non-JSON text', () => {
    const result = normalizeLarkCliOutput('plain help text', 1024);
    expect(result.text).toBe('plain help text');
  });
});
