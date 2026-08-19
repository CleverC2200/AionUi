/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';

const { getClientBusinessSettingMock, mcpServiceMock } = vi.hoisted(() => ({
  getClientBusinessSettingMock: vi.fn(),
  mcpServiceMock: {
    listServers: { invoke: vi.fn() },
    toggleServer: { invoke: vi.fn() },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: getClientBusinessSettingMock,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: mcpServiceMock,
}));

import {
  ensureBackendMcpCatalog,
  selectableConversationMcpServers,
  visibleMcpServers,
} from '@/renderer/hooks/mcp/catalog';
import { useMcpServerCRUD } from '@/renderer/hooks/mcp/useMcpServerCRUD';

describe('ensureBackendMcpCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientBusinessSettingMock.mockResolvedValue([]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([
      {
        id: 'user-1',
        name: 'user one',
        enabled: true,
        transport: { type: 'stdio', command: 'user', args: [] },
        created_at: 2,
        updated_at: 2,
        original_json: '{}',
        builtin: false,
      },
    ]);
  });

  it('reads MCP catalog from backend settings without falling back to configService', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'builtin-1',
        name: 'builtin one',
        enabled: true,
        transport: { type: 'stdio', command: 'builtin', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: true,
      },
    ]);

    const result = await ensureBackendMcpCatalog();

    expect(result.userServers).toHaveLength(1);
    expect(result.builtinServers).toHaveLength(1);
    expect(result.allServers).toHaveLength(2);
  });

  it('does not re-import legacy user MCP rows from backend client settings at runtime', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'legacy-user-1',
        name: 'legacy user server',
        enabled: true,
        transport: { type: 'stdio', command: 'legacy-user', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: false,
      },
    ]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([]);

    const result = await ensureBackendMcpCatalog();

    expect(result.userServers).toEqual([]);
    expect(result.builtinServers).toEqual([]);
    expect(result.allServers).toEqual([]);
  });

  it('keeps the internal GEA bridge out of user-visible MCP lists', () => {
    expect(
      visibleMcpServers([
        {
          id: 'gea-gateway',
          name: 'gea-gateway',
          enabled: true,
          transport: { type: 'stdio', command: 'aioncore', args: ['mcp-gea-stdio'] },
          created_at: 1,
          updated_at: 1,
          original_json: '{}',
          builtin: true,
        },
        {
          id: 'chrome-devtools',
          name: 'chrome-devtools',
          enabled: true,
          transport: { type: 'stdio', command: 'npx', args: [] },
          created_at: 1,
          updated_at: 1,
          original_json: '{}',
          builtin: true,
        },
      ])
    ).toEqual([expect.objectContaining({ id: 'chrome-devtools' })]);
  });

  it('hides only the retired no-session GEA endpoint from user-visible MCP lists', () => {
    expect(
      visibleMcpServers([
        {
          id: 'legacy-gea',
          name: 'gea',
          enabled: false,
          transport: {
            type: 'sse',
            url: 'https://gea.synear.cn/gea-boot/ai/gateway/mcp/proxy/sse/',
          },
          created_at: 1,
          updated_at: 1,
          original_json: '{}',
          builtin: false,
        },
        {
          id: 'user-gea',
          name: 'gea',
          enabled: true,
          transport: { type: 'sse', url: 'https://example.com/mcp/sse' },
          created_at: 1,
          updated_at: 1,
          original_json: '{}',
          builtin: false,
        },
      ])
    ).toEqual([expect.objectContaining({ id: 'user-gea' })]);
  });

  it('shows only enabled conversation MCP servers, including the internal GEA gateway', () => {
    expect(
      selectableConversationMcpServers([
        {
          id: 'gea-gateway',
          name: 'gea-gateway',
          enabled: true,
          transport: { type: 'stdio', command: 'aioncore', args: ['mcp-gea-stdio'] },
          created_at: 1,
          updated_at: 1,
          original_json: '{}',
          builtin: true,
        },
        {
          id: 'disabled-user',
          name: 'disabled-user',
          enabled: false,
          transport: { type: 'stdio', command: 'disabled', args: [] },
          created_at: 1,
          updated_at: 1,
          original_json: '{}',
          builtin: false,
        },
        {
          id: 'legacy-gea',
          name: 'gea',
          enabled: true,
          transport: { type: 'sse', url: 'https://gea.synear.cn/gea-boot/ai/gateway/mcp/proxy/sse' },
          created_at: 1,
          updated_at: 1,
          original_json: '{}',
          builtin: false,
        },
      ])
    ).toEqual([expect.objectContaining({ id: 'gea-gateway' })]);
  });

  it('persists the settings switch and notifies the open conversation catalog', async () => {
    const server = {
      id: 'gea-gateway',
      name: 'gea-gateway',
      enabled: true,
      transport: { type: 'stdio' as const, command: 'aioncore', args: ['mcp-gea-stdio'] },
      created_at: 1,
      updated_at: 1,
      original_json: '{}',
      builtin: true,
    };
    const disabledServer = { ...server, enabled: false };
    const saveMcpServers = vi.fn(async (updater: IMcpServer[] | ((servers: IMcpServer[]) => IMcpServer[])) => {
      expect(typeof updater).toBe('function');
      expect((updater as (servers: IMcpServer[]) => IMcpServer[])([server])).toEqual([disabledServer]);
    });
    const catalogChanged = vi.fn();
    window.addEventListener('aionui:mcp-catalog-changed', catalogChanged);
    mcpServiceMock.toggleServer.invoke.mockResolvedValue(disabledServer);
    const { result } = renderHook(() => useMcpServerCRUD(saveMcpServers));

    await act(async () => {
      await result.current.handleToggleMcpServerEnabled(server, false);
    });

    expect(mcpServiceMock.toggleServer.invoke).toHaveBeenCalledWith({ id: 'gea-gateway' });
    expect(catalogChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener('aionui:mcp-catalog-changed', catalogChanged);
  });
});
