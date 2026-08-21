import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  mcpServers: [] as unknown[],
  testMcpConnection: vi.fn(() => Promise.resolve()),
  syncFromGea: vi.fn(() => Promise.resolve()),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/pages/settings/components/AddMcpServerModal', () => ({ default: () => null }));
vi.mock('@/renderer/pages/settings/ToolsSettings/McpServerItem', () => ({ default: () => null }));

vi.mock('@/renderer/hooks/mcp', () => ({
  useMcpServers: () => ({
    mcpServers: hooks.mcpServers,
    extensionMcpServers: [],
    saveMcpServers: vi.fn(() => Promise.resolve()),
    setMcpServers: vi.fn(),
    refreshMcpServers: vi.fn(() => Promise.resolve(true)),
  }),
  useMcpConnection: () => ({
    testingServers: {},
    handleTestMcpConnection: hooks.testMcpConnection,
    handleTestMcpConnections: vi.fn(),
  }),
  useMcpModal: () => ({
    showMcpModal: false,
    editingMcpServer: undefined,
    deleteConfirmVisible: false,
    serverToDelete: undefined,
    mcpCollapseKey: {},
    showAddMcpModal: vi.fn(),
    showEditMcpModal: vi.fn(),
    hideMcpModal: vi.fn(),
    showDeleteConfirm: vi.fn(),
    hideDeleteConfirm: vi.fn(),
    toggleServerCollapse: vi.fn(),
  }),
  useMcpServerCRUD: () => ({
    handleAddMcpServer: vi.fn(),
    handleBatchImportMcpServers: vi.fn(),
    handleEditMcpServer: vi.fn(),
    handleDeleteMcpServer: vi.fn(),
    handleToggleMcpServerEnabled: vi.fn(),
  }),
  useMcpOAuth: () => ({
    oauthStatus: {},
    loggingIn: {},
    checkOAuthStatus: vi.fn(),
    markLoginRequired: vi.fn(),
    clearLoginRequired: vi.fn(),
    login: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/system/useGeaResourceSync', () => ({
  useGeaResourceSync: () => ({ syncing: false, syncFromGea: hooks.syncFromGea }),
}));

import McpManagement from '@/renderer/pages/settings/ToolsSettings/McpManagement';

describe('McpManagement GEA action', () => {
  beforeEach(() => {
    hooks.testMcpConnection.mockClear();
    hooks.syncFromGea.mockClear();
    hooks.mcpServers = [
      {
        id: 'gea-gateway',
        name: 'gea-gateway',
        enabled: true,
        builtin: true,
        transport: { type: 'stdio', command: 'aioncore', args: ['mcp-gea-stdio'] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
      },
    ];
  });

  afterEach(cleanup);

  it('shows a fetch-from-GEA action and syncs managed MCP resources', async () => {
    render(<McpManagement message={{} as never} />);

    fireEvent.click(screen.getByTestId('add-mcp-server-dropdown'));
    const action = await screen.findByTestId('fetch-gea-mcp-menu-item');
    fireEvent.click(action);

    await waitFor(() => expect(hooks.syncFromGea).toHaveBeenCalledTimes(1));
    expect(hooks.testMcpConnection).not.toHaveBeenCalled();
  });
});
