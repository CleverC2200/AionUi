/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAcpImagePath } from '@/common/chat/acpToolCallOutput';
import type { TMessage } from '@/common/chat/chatLib';
import {
  parseFileMarker,
  resolveMessageFilePath,
  type ParsedFileMarker,
} from '@/renderer/pages/conversation/Messages/components/fileMarker';

export type ConversationFileResourceItem = {
  kind: 'file';
  path: string;
  name: string;
  provenance?: ConversationResourceProvenance;
};

export type ConversationUrlResourceItem = {
  kind: 'url';
  url: string;
  name: string;
  provenance?: ConversationResourceProvenance;
};

export type ConversationResourceProvenance = {
  recordId: string;
  revision: number;
  producer: string;
  turnId?: string;
  taskId?: string;
  replacesRecordId?: string;
};

export type ConversationResourceItem = ConversationFileResourceItem | ConversationUrlResourceItem;

export type ConversationResources = {
  outputs: ConversationFileResourceItem[];
  sources: ConversationResourceItem[];
};

export type ParsedMessageFileMarker = ParsedFileMarker;

// Preserve the ConversationResources model API while keeping marker parsing
// and workspace path resolution authoritative in MessageText's fileMarker.ts.
export { parseFileMarker as parseMessageFileMarker, resolveMessageFilePath as resolveConversationResourcePath };

const IMAGE_PATH_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/gi;

export const conversationResourcesSlotId = (conversationId: string): string =>
  `conversation-resources-${conversationId}`;

const resourceName = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/').replace(/\/$/, '');
  return normalized.split('/').pop() || filePath;
};

const firstString = (record: Record<string, unknown> | undefined, keys: string[]): string | undefined => {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

const addFileResource = (items: Map<string, ConversationResourceItem>, filePath: string, workspace?: string): void => {
  const resolvedPath = resolveMessageFilePath(filePath.trim(), workspace);
  if (!resolvedPath) return;
  const key = resolvedPath.replace(/\\/g, '/');
  items.delete(key);
  items.set(key, { kind: 'file', path: resolvedPath, name: resourceName(resolvedPath) });
};

const normalizeHttpUrl = (value: string): string | undefined => {
  const candidate = value.trim().replace(/[.,;:!?]+$/, '');
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
};

const extractHttpUrls = (value: string): string[] =>
  Array.from(value.matchAll(HTTP_URL_PATTERN), (match) => normalizeHttpUrl(match[0])).filter((url): url is string =>
    Boolean(url)
  );

const recordHttpUrls = (record: Record<string, unknown> | undefined): string[] => {
  if (!record) return [];
  const values: string[] = [];
  for (const key of ['url', 'source_url']) {
    if (typeof record[key] === 'string') values.push(record[key]);
  }
  for (const key of ['urls', 'source_urls']) {
    const candidates = record[key];
    if (Array.isArray(candidates)) {
      values.push(...candidates.filter((value): value is string => typeof value === 'string'));
    }
  }
  return values.flatMap(extractHttpUrls);
};

const addUrlResource = (items: Map<string, ConversationResourceItem>, value: string): void => {
  const url = normalizeHttpUrl(value);
  if (!url) return;
  const parsed = new URL(url);
  items.delete(url);
  items.set(url, { kind: 'url', url, name: parsed.hostname.replace(/^www\./i, '') });
};

const collectAcpOutputPaths = (message: Extract<TMessage, { type: 'acp_tool_call' }>): string[] => {
  const update = message.content?.update;
  if (!update || update.status !== 'completed') return [];

  const paths: string[] = [];
  const imagePath = getAcpImagePath(update);
  if (imagePath) paths.push(imagePath);

  if (update.kind === 'edit') {
    const rawInput = (update.rawInput ?? (update as { raw_input?: Record<string, unknown> }).raw_input) as
      | Record<string, unknown>
      | undefined;
    const inputPath = firstString(rawInput, ['file_path', 'path', 'file_name']);
    if (inputPath) paths.push(inputPath);
    for (const item of update.content ?? []) {
      if (item.type === 'diff' && item.path) paths.push(item.path);
    }
    for (const location of update.locations ?? []) {
      if (location.path) paths.push(location.path);
    }
  }

  const rawOutput = update.rawOutput ?? update.raw_output;
  if (typeof rawOutput?.saved_path === 'string' && rawOutput.saved_path) {
    paths.push(rawOutput.saved_path);
  }
  return paths;
};

const WRITE_TOOL_NAMES = new Set([
  'apply_patch',
  'create',
  'create_file',
  'edit',
  'edit_file',
  'patch',
  'replace',
  'write',
  'write_file',
  'writefile',
]);

const collectToolCallOutputPaths = (message: Extract<TMessage, { type: 'tool_call' }>): string[] => {
  if (message.content.status !== 'completed') return [];
  const toolName = message.content.name.trim().toLowerCase();
  if (!WRITE_TOOL_NAMES.has(toolName)) return [];

  const args = message.content.args as Record<string, unknown> | undefined;
  const input = message.content.input as Record<string, unknown> | undefined;
  const filePath =
    firstString(input, ['file_path', 'path', 'file_name']) ?? firstString(args, ['file_path', 'path', 'file_name']);
  return filePath ? [filePath] : [];
};

const collectAcpSourceUrls = (message: Extract<TMessage, { type: 'acp_tool_call' }>): string[] => {
  const update = message.content?.update;
  if (!update || update.status !== 'completed') return [];
  const rawInput = update.rawInput ?? (update as { raw_input?: Record<string, unknown> }).raw_input;
  const rawOutput = update.rawOutput ?? update.raw_output;
  return [...recordHttpUrls(rawInput), ...recordHttpUrls(rawOutput)];
};

const collectToolCallSourceUrls = (message: Extract<TMessage, { type: 'tool_call' }>): string[] => {
  if (message.content.status !== 'completed') return [];
  return [
    ...recordHttpUrls(message.content.input as Record<string, unknown> | undefined),
    ...recordHttpUrls(message.content.args as Record<string, unknown> | undefined),
  ];
};

const collectToolGroupSourceUrls = (message: Extract<TMessage, { type: 'tool_group' }>): string[] => {
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap((tool) =>
    tool.status === 'Success' && tool.confirmationDetails?.type === 'info'
      ? (tool.confirmationDetails.urls ?? []).flatMap(extractHttpUrls)
      : []
  );
};

const collectToolGroupOutputPaths = (message: Extract<TMessage, { type: 'tool_group' }>): string[] => {
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap((tool) => {
    if (tool.status !== 'Success') return [];
    const paths: string[] = [];
    if (tool.confirmationDetails?.type === 'edit') paths.push(tool.confirmationDetails.file_name);
    if (tool.result_display && typeof tool.result_display !== 'string') {
      if ('file_name' in tool.result_display) paths.push(tool.result_display.file_name);
      if ('relative_path' in tool.result_display) paths.push(tool.result_display.relative_path);
    }
    return paths;
  });
};

export const isImageResource = (filePath: string): boolean => IMAGE_PATH_PATTERN.test(filePath);

export const collectConversationResources = (messages: TMessage[], workspace?: string): ConversationResources => {
  const sourceItems = new Map<string, ConversationResourceItem>();
  const outputItems = new Map<string, ConversationResourceItem>();

  for (const message of messages) {
    if (message.type === 'text') {
      if (message.position === 'right') {
        const { files } = parseFileMarker(message.content.content, true);
        for (const filePath of files) addFileResource(sourceItems, filePath, workspace);
      } else if (message.position === 'left') {
        for (const url of extractHttpUrls(message.content.content)) addUrlResource(sourceItems, url);
      }
      continue;
    }

    const sourceUrls =
      message.type === 'acp_tool_call'
        ? collectAcpSourceUrls(message)
        : message.type === 'tool_call'
          ? collectToolCallSourceUrls(message)
          : message.type === 'tool_group'
            ? collectToolGroupSourceUrls(message)
            : [];
    for (const url of sourceUrls) addUrlResource(sourceItems, url);

    const outputPaths =
      message.type === 'acp_tool_call'
        ? collectAcpOutputPaths(message)
        : message.type === 'tool_call'
          ? collectToolCallOutputPaths(message)
          : message.type === 'tool_group'
            ? collectToolGroupOutputPaths(message)
            : [];
    for (const filePath of outputPaths) addFileResource(outputItems, filePath, workspace);
  }

  return {
    sources: Array.from(sourceItems.values()),
    outputs: Array.from(outputItems.values())
      .filter((item): item is ConversationFileResourceItem => item.kind === 'file')
      .toReversed(),
  };
};
