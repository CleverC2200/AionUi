/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsTabNavigateProvider } from '@/renderer/components/settings/SettingsModal/settingsViewContext';

const hooks = vi.hoisted(() => ({
  modelListWithImage: [] as unknown[],
  mcpServers: [] as unknown[],
  getClientBusinessSetting: vi.fn(() => Promise.resolve(undefined)),
  refreshMcpServers: vi.fn(() => Promise.resolve(true)),
  syncFromGea: vi.fn(),
  catalog: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

vi.mock('@/renderer/components/base/AionScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/base/AionSelect', () => {
  const Select = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { default: Object.assign(Select, { OptGroup: Select, Option: Select }) };
});

vi.mock('@/renderer/pages/settings/components/AddMcpServerModal', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/settings/ToolsSettings/McpServerItem', () => ({
  default: ({
    server,
    isReadOnly,
    isConfigurationReadOnly,
  }: {
    server: { id: string };
    isReadOnly?: boolean;
    isConfigurationReadOnly?: boolean;
  }) => (
    <div
      data-testid={`mcp-server-${server.id}`}
      data-readonly={isReadOnly ? 'true' : 'false'}
      data-configuration-readonly={isConfigurationReadOnly ? 'true' : 'false'}
    />
  ),
}));

vi.mock('@/renderer/hooks/agent/useConfigModelListWithImage', () => ({
  default: () => ({ modelListWithImage: hooks.modelListWithImage }),
}));

vi.mock('@/renderer/hooks/mcp', () => ({
  useMcpServers: () => ({
    mcpServers: hooks.mcpServers,
    extensionMcpServers: [],
    saveMcpServers: vi.fn(() => Promise.resolve()),
    setMcpServers: vi.fn(),
    isMcpServersLoading: false,
    refreshMcpServers: hooks.refreshMcpServers,
  }),
  useMcpConnection: () => ({ testingServers: {}, handleTestMcpConnection: vi.fn(), handleTestMcpConnections: vi.fn() }),
  useMcpModal: () => ({
    showMcpModal: false,
    editingMcpServer: undefined,
    deleteConfirmVisible: false,
    serverToDelete: undefined,
    mcpCollapseKey: [],
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
  }),
  useMcpOAuth: () => ({
    oauthStatus: {},
    loggingIn: {},
    checkOAuthStatus: vi.fn(),
    markLoginRequired: vi.fn(),
    clearLoginRequired: vi.fn(),
    login: vi.fn(),
  }),
  useMountedMessage: (m: unknown) => m,
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: hooks.getClientBusinessSetting,
  setClientBusinessSetting: vi.fn(() => Promise.resolve()),
  removeClientBusinessSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    clientResources: { syncFromGea: { invoke: hooks.syncFromGea } },
    assistants: { catalog: { invoke: hooks.catalog } },
  },
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {},
}));

import ToolsModalContent from '@/renderer/components/settings/SettingsModal/contents/ToolsModalContent';

describe('ToolsModalContent image model guide', () => {
  beforeEach(() => {
    hooks.modelListWithImage = [];
    hooks.mcpServers = [];
    hooks.getClientBusinessSetting.mockClear();
    hooks.refreshMcpServers.mockClear();
    hooks.syncFromGea.mockReset();
    hooks.syncFromGea.mockResolvedValue({ status: 'completed', changed: 1, skipped: 0, failed: 0 });
    hooks.catalog.mockReset();
    hooks.catalog.mockResolvedValue({ assistants: [], mode: 'managed', sync_status: 'fresh' });
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a clickable "go to configure" link that navigates to the model tab', async () => {
    const navigateToTab = vi.fn();
    render(
      <SettingsTabNavigateProvider value={navigateToTab}>
        <ToolsModalContent />
      </SettingsTabNavigateProvider>
    );

    const link = await screen.findByText('settings.goToModelSettings');
    // Rendered as an inline anchor (text link), not a button.
    expect(link.tagName).toBe('A');
    fireEvent.click(link);

    await waitFor(() => expect(navigateToTab).toHaveBeenCalledWith('model'));
  });

  it('renders the guide text as plain text (no link) when no tab navigator is provided', async () => {
    const { container } = render(<ToolsModalContent />);

    // The empty-state hint still shows the go-to-configure wording, but not as a clickable link.
    await waitFor(() => expect(container.textContent).toContain('settings.goToModelSettings'));
    const links = Array.from(container.querySelectorAll('a')).filter(
      (a) => a.textContent === 'settings.goToModelSettings'
    );
    expect(links).toHaveLength(0);
  });

  it('does not advertise unsupported managed MCP catalog synchronization', async () => {
    render(<ToolsModalContent />);

    fireEvent.click(await screen.findByTestId('add-mcp-server-menu'));
    expect(screen.queryByTestId('add-mcp-server-menu-gea')).not.toBeInTheDocument();
  });

  it('renders the builtin GEA gateway as visible read-only configuration', async () => {
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

    render(<ToolsModalContent />);

    expect(await screen.findByTestId('mcp-server-gea-gateway')).toHaveAttribute('data-configuration-readonly', 'true');
    expect(screen.getByTestId('mcp-server-gea-gateway')).toHaveAttribute('data-readonly', 'false');
  });

  it('renders GEA-managed MCP servers without local edit or delete controls', async () => {
    hooks.mcpServers = [
      {
        id: 'mcp-oa-production',
        name: 'OA Production',
        enabled: true,
        source: 'managed',
        production_write: true,
        transport: { type: 'http', url: 'https://managed.invalid/mcp' },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
      },
    ];

    render(<ToolsModalContent />);

    expect(await screen.findByTestId('mcp-server-mcp-oa-production')).toHaveAttribute(
      'data-configuration-readonly',
      'true'
    );
  });
});
