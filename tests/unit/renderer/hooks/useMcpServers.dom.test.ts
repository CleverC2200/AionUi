/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { ensureBackendMcpCatalogMock } = vi.hoisted(() => ({
  ensureBackendMcpCatalogMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    extensions: {
      getMcpServers: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@/renderer/hooks/mcp/catalog', () => ({
  ensureBackendMcpCatalog: ensureBackendMcpCatalogMock,
  isInternalMcpServer: (server: { name: string; builtin?: boolean }) =>
    server.builtin === true && server.name === 'gea-gateway',
  visibleMcpServers: (servers: Array<{ name: string; builtin?: boolean }>) =>
    servers.filter((server) => !(server.builtin === true && server.name === 'gea-gateway')),
}));

import { useMcpServers } from '@/renderer/hooks/mcp/useMcpServers';

describe('useMcpServers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureBackendMcpCatalogMock.mockResolvedValue({
      userServers: [],
      builtinServers: [],
      allServers: [],
    });
  });

  it('loads MCP catalog on mount', async () => {
    const { result } = renderHook(() => useMcpServers());

    await waitFor(() => expect(result.current.isMcpServersLoading).toBe(false));

    expect(ensureBackendMcpCatalogMock).toHaveBeenCalledTimes(1);
    expect(result.current.mcpServers).toEqual([]);
  });

  it('does not fall back to configService business data when MCP catalog loading fails', async () => {
    ensureBackendMcpCatalogMock.mockRejectedValue(new Error('catalog failed'));

    const { result } = renderHook(() => useMcpServers());

    await waitFor(() => expect(result.current.isMcpServersLoading).toBe(false));

    expect(result.current.mcpServers).toEqual([]);
  });

  it('keeps the internal GEA bridge visible in settings-facing MCP state', async () => {
    ensureBackendMcpCatalogMock.mockResolvedValue({
      allServers: [
        {
          id: 'gea-gateway',
          name: 'gea-gateway',
          builtin: true,
          enabled: true,
          transport: { type: 'stdio', command: 'aioncore', args: ['mcp-gea-stdio'] },
          created_at: 1,
          updated_at: 1,
          original_json: '{}',
          last_test_status: 'error',
        },
      ],
    });

    const { result } = renderHook(() => useMcpServers());

    await waitFor(() => expect(result.current.isMcpServersLoading).toBe(false));
    expect(result.current.mcpServers).toEqual([
      expect.objectContaining({ id: 'gea-gateway', last_test_status: 'disconnected' }),
    ]);
  });

  it('updates local MCP state without persisting business data outside the backend catalog', async () => {
    const { result } = renderHook(() => useMcpServers());

    await waitFor(() => expect(result.current.isMcpServersLoading).toBe(false));

    act(() => {
      void result.current.saveMcpServers([
        {
          id: 'mcp-1',
          name: 'server-1',
          enabled: true,
          transport: { type: 'stdio', command: 'foo', args: [] },
          created_at: 1,
          updated_at: 1,
          original_json: '{}',
          builtin: false,
        },
      ]);
    });

    await waitFor(() => expect(result.current.mcpServers).toHaveLength(1));
  });

  it('preserves the last good MCP catalog when an explicit refresh fails', async () => {
    const existing = {
      id: 'existing-mcp',
      name: 'Existing MCP',
      enabled: true,
      transport: { type: 'stdio' as const, command: 'existing', args: [] },
      created_at: 1,
      updated_at: 1,
      original_json: '{}',
    };
    ensureBackendMcpCatalogMock.mockResolvedValueOnce({ allServers: [existing] });
    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.mcpServers).toEqual([existing]));

    ensureBackendMcpCatalogMock.mockRejectedValueOnce(new Error('temporary catalog failure'));
    let refreshed = true;
    await act(async () => {
      refreshed = await result.current.refreshMcpServers();
    });

    expect(refreshed).toBe(false);
    expect(result.current.mcpServers).toEqual([existing]);
  });
});
