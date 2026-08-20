/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * lark-cli 内置 MCP 的命令构造、结果归一化与一次子进程调用的薄封装。
 *
 * 单独成文件是为了可测试：larkCliServer.ts 是带顶层副作用的启动脚本（会启动 MCP
 * server），单测无法 import。这里只放纯函数和一次子进程调用的封装。
 *
 * Helpers for building lark-cli invocations, normalizing its output, and running one
 * child-process call. Kept in its own module for testability: larkCliServer.ts is an
 * entry script with top-level side effects, so tests import this module instead.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const LARK_CLI_BINARY = process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli';

/** Cap the result we hand back so one oversized response cannot balloon memory. */
export const LARK_CLI_MAX_OUTPUT_BYTES = 256 * 1024;

/** Hard ceiling for the raw stdout we are willing to buffer before rejecting the call. */
export const LARK_CLI_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export const LARK_CLI_NOT_INSTALLED_TEXT =
  'lark-cli is not installed. Install it once with: npx @larksuite/cli@latest install — then enable and test this MCP in Settings > Tools.';

export type BuildLarkCliInvocationInput = {
  /** Command tokens, e.g. docs +fetch --doc <token> --detail simple. */
  argv: string[];
  /** Append a --dry-run so lark-cli prints the request without executing it. */
  dryRun?: boolean;
  /** Append a --jq expression to filter the JSON output. */
  jq?: string;
};

/**
 * Assemble the final argv passed to lark-cli.
 *
 * Flags that only exist on a subcommand (--dry-run, --jq) are appended after the
 * caller's tokens rather than prepended, because the root command does not accept them.
 */
export function buildLarkCliInvocation(input: BuildLarkCliInvocationInput): string[] {
  const tokens = [...input.argv];
  if (input.dryRun) tokens.push('--dry-run');
  if (input.jq) tokens.push('--jq', input.jq);
  return tokens;
}

export type NormalizeResult = {
  text: string;
  truncated: boolean;
};

/**
 * Turn lark-cli stdout into a compact, readable tool result.
 *
 * lark-cli defaults to JSON output, so pretty-print it when it parses; otherwise pass
 * the raw text through. Truncate to maxBytes with an explicit marker so the agent and
 * the user can see that a result was cut.
 */
export function normalizeLarkCliOutput(raw: string, maxBytes: number = LARK_CLI_MAX_OUTPUT_BYTES): NormalizeResult {
  const trimmed = raw.trim();
  let text = trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === 'object') {
      text = JSON.stringify(parsed, null, 2);
    }
  } catch {
    // Not JSON: keep the raw text.
  }
  return truncateUtf8(text, maxBytes);
}

/**
 * Truncate a UTF-8 string to maxBytes, appending a marker when cut.
 *
 * Walks back one character at a time so a multi-byte codepoint is never split in half.
 */
export function truncateUtf8(text: string, maxBytes: number): NormalizeResult {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return { text, truncated: false };
  }

  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) {
    end -= 1;
  }

  const marker = ' ...[output truncated to ' + maxBytes + ' bytes]';
  return { text: text.slice(0, end) + marker, truncated: true };
}

export type ExecLarkCliResult = {
  ok: boolean;
  text: string;
  truncated: boolean;
};

export type ExecLarkCliOptions = {
  timeoutMs?: number;
  maxBytes?: number;
};

/**
 * Run lark-cli once and collect its stdout as the tool result.
 *
 * Never inject --yes here: lark-cli's own high-risk-write gate stays authoritative, and
 * the agent must only add --yes after the user explicitly confirms the write.
 */
export async function execLarkCli(args: string[], options: ExecLarkCliOptions = {}): Promise<ExecLarkCliResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxBytes = options.maxBytes ?? LARK_CLI_MAX_OUTPUT_BYTES;

  try {
    const { stdout } = await execFileAsync(LARK_CLI_BINARY, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: LARK_CLI_MAX_BUFFER_BYTES,
      windowsHide: true,
    });
    const normalized = normalizeLarkCliOutput(stdout, maxBytes);
    return { ok: true, text: normalized.text, truncated: normalized.truncated };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: NodeJS.Signals | null;
    };

    if (err.code === 'ENOENT') {
      return { ok: false, text: LARK_CLI_NOT_INSTALLED_TEXT, truncated: false };
    }

    if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return {
        ok: false,
        text: 'lark-cli output exceeded the ' + LARK_CLI_MAX_BUFFER_BYTES + ' byte buffer limit.',
        truncated: false,
      };
    }

    if (err.killed && err.signal) {
      return {
        ok: false,
        text: 'lark-cli timed out after ' + timeoutMs + ' ms and was terminated.',
        truncated: false,
      };
    }

    // lark-cli reports structured failures as JSON on stdout even on a non-zero exit.
    if (err.stdout && err.stdout.trim()) {
      const normalized = normalizeLarkCliOutput(err.stdout, maxBytes);
      return { ok: false, text: normalized.text, truncated: normalized.truncated };
    }

    const detail = [err.message, err.stderr && err.stderr.trim()].filter(Boolean).join('; ');
    return { ok: false, text: 'lark-cli failed: ' + (detail || 'unknown error'), truncated: false };
  }
}
