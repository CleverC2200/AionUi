import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ desktop: true, mac: false }));
const layout = vi.hoisted(() => ({ mobile: false }));
const preview = vi.hoisted(() => ({
  activeTab: null as null | { id: string; content_type: string },
  closePreview: vi.fn(),
  isBrowserFocused: false,
  isOpen: false,
  openBrowserTab: vi.fn(),
  showPreview: vi.fn(),
  tabs: [] as Array<{ id: string; content_type: string }>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/conversation/test', search: '', hash: '' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: { conversation: { get: { invoke: vi.fn().mockResolvedValue(null) } } },
}));
vi.mock('@/common/config/constants', () => ({ TEAM_MODE_ENABLED: false }));
vi.mock('@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Titlebar/MobileConversationBrand', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/VoiceConversation', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/WindowControls', () => ({
  default: () => <div data-testid='window-controls' />,
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: layout.mobile }),
}));
vi.mock('@/renderer/hooks/context/NavigationHistoryContext', () => ({
  useNavigationHistory: () => null,
}));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => platform.desktop,
  isMacOS: () => platform.mac,
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => preview,
}));

import Titlebar from '@/renderer/components/layout/Titlebar';
import { dispatchWorkspaceStateEvent } from '@/renderer/utils/workspace/workspaceEvents';

describe('Titlebar workspace toggle', () => {
  beforeEach(() => {
    platform.desktop = true;
    platform.mac = false;
    layout.mobile = false;
    preview.activeTab = null;
    preview.isBrowserFocused = false;
    preview.isOpen = false;
    preview.tabs = [];
    localStorage.clear();
    dispatchWorkspaceStateEvent(true);
    vi.clearAllMocks();
  });

  it('omits feedback and places Windows controls after the workspace toggle', () => {
    render(<Titlebar workspaceAvailable />);

    const files = screen.getByRole('button', { name: 'conversation.workspace.panelLayout.files' });

    expect(screen.queryByRole('button', { name: 'conversation.welcome.quickActionFeedback' })).not.toBeInTheDocument();
    expect(files).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'conversation.workspace.panelLayout.browser' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'conversation.workspace.panelLayout.conversationLeft' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('window-controls')).toBeInTheDocument();
  });

  it.each([
    { runtime: 'macOS desktop', desktop: true, mac: true },
    { runtime: 'WebUI', desktop: false, mac: false },
  ])('keeps only the workspace action on $runtime', ({ desktop, mac }) => {
    platform.desktop = desktop;
    platform.mac = mac;
    render(<Titlebar workspaceAvailable />);

    const workspace = screen.getByRole('button', { name: 'conversation.workspace.panelLayout.files' });

    expect(screen.queryByRole('button', { name: 'conversation.welcome.quickActionFeedback' })).not.toBeInTheDocument();
    expect(workspace).toBeInTheDocument();
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument();
  });

  it('updates the workspace action when the panel becomes expanded', () => {
    render(<Titlebar workspaceAvailable />);

    act(() => dispatchWorkspaceStateEvent(false));

    expect(screen.getByRole('button', { name: 'conversation.workspace.panelLayout.files' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'conversation.workspace.panelLayout.files' })).toHaveClass(
      'app-titlebar__button--selected'
    );
  });

  it('reads the current workspace state when the titlebar mounts late', () => {
    dispatchWorkspaceStateEvent(false);
    render(<Titlebar workspaceAvailable />);

    expect(screen.getByRole('button', { name: 'conversation.workspace.panelLayout.files' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('omits the workspace toggle when no workspace is available', () => {
    render(<Titlebar workspaceAvailable={false} />);

    expect(screen.queryByRole('button', { name: 'conversation.workspace.panelLayout.files' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'conversation.workspace.panelLayout.browser' })
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-layout-toggle')).not.toBeInTheDocument();
  });

  it('opens a browser tab and closes the visible browser from the titlebar', () => {
    const { rerender } = render(<Titlebar workspaceAvailable />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.workspace.panelLayout.browser' }));
    expect(preview.openBrowserTab).toHaveBeenCalledOnce();

    preview.activeTab = { id: 'browser-1', content_type: 'browser' };
    preview.isOpen = true;
    preview.tabs = [preview.activeTab];
    rerender(<Titlebar workspaceAvailable />);
    expect(screen.getByRole('button', { name: 'conversation.workspace.panelLayout.browser' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'conversation.workspace.panelLayout.browser' })).toHaveClass(
      'app-titlebar__button--selected'
    );
    fireEvent.click(screen.getByRole('button', { name: 'conversation.workspace.panelLayout.browser' }));
    expect(preview.closePreview).toHaveBeenCalledOnce();
  });

  it('switches the conversation side directly and persists the layout', () => {
    render(<Titlebar workspaceAvailable />);

    const layoutToggle = screen.getByTestId('workspace-layout-toggle');
    expect(layoutToggle).toHaveAttribute('data-conversation-side', 'left');
    expect(layoutToggle).toHaveAccessibleName('conversation.workspace.panelLayout.conversationLeft');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(layoutToggle);

    expect(localStorage.getItem('conversation-extension-panel-side')).toBe('left');
    expect(layoutToggle).toHaveAttribute('data-conversation-side', 'right');
    expect(layoutToggle).toHaveAccessibleName('conversation.workspace.panelLayout.conversationRight');
  });

  it.each([
    {
      name: 'closed extension panels',
      workspaceCollapsed: true,
      browserOpen: false,
      browserFocused: false,
      storedPanelSide: null,
      mobile: false,
      expectedConversationSide: 'left',
    },
    {
      name: 'selected files panel',
      workspaceCollapsed: false,
      browserOpen: false,
      browserFocused: false,
      storedPanelSide: null,
      mobile: false,
      expectedConversationSide: 'left',
    },
    {
      name: 'selected browser panel',
      workspaceCollapsed: true,
      browserOpen: true,
      browserFocused: false,
      storedPanelSide: null,
      mobile: false,
      expectedConversationSide: 'left',
    },
    {
      name: 'focused full-width browser',
      workspaceCollapsed: true,
      browserOpen: true,
      browserFocused: true,
      storedPanelSide: null,
      mobile: false,
      expectedConversationSide: 'left',
    },
    {
      name: 'conversation on the right',
      workspaceCollapsed: true,
      browserOpen: false,
      browserFocused: false,
      storedPanelSide: 'left',
      mobile: false,
      expectedConversationSide: 'right',
    },
    {
      name: 'narrow mobile layout',
      workspaceCollapsed: false,
      browserOpen: true,
      browserFocused: false,
      storedPanelSide: 'left',
      mobile: true,
      expectedConversationSide: 'right',
    },
  ])(
    'keeps persistent button state for $name',
    ({ workspaceCollapsed, browserOpen, browserFocused, storedPanelSide, mobile, expectedConversationSide }) => {
      layout.mobile = mobile;
      preview.isBrowserFocused = browserFocused;
      if (browserOpen) {
        preview.activeTab = { id: 'browser-state-matrix', content_type: 'browser' };
        preview.isOpen = true;
        preview.tabs = [preview.activeTab];
      }
      if (storedPanelSide) localStorage.setItem('conversation-extension-panel-side', storedPanelSide);
      dispatchWorkspaceStateEvent(workspaceCollapsed);

      render(<Titlebar workspaceAvailable />);

      const files = screen.getByTestId('workspace-files-toggle');
      const browser = screen.getByTestId('workspace-browser-toggle');
      const panelLayout = screen.getByTestId('workspace-layout-toggle');
      expect(files).toHaveAttribute('aria-pressed', String(!workspaceCollapsed));
      if (workspaceCollapsed) expect(files).not.toHaveClass('app-titlebar__button--selected');
      else expect(files).toHaveClass('app-titlebar__button--selected');
      expect(browser).toHaveAttribute('aria-pressed', String(browserOpen));
      if (browserOpen) expect(browser).toHaveClass('app-titlebar__button--selected');
      else expect(browser).not.toHaveClass('app-titlebar__button--selected');
      expect(panelLayout).toHaveAttribute('data-conversation-side', expectedConversationSide);
      expect(files).toHaveClass(mobile ? 'app-titlebar__button--mobile' : 'app-titlebar__button');
      expect(screen.queryByTestId('window-controls')).toBeInTheDocument();
    }
  );
});
