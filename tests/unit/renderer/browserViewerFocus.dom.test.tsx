import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import PreviewTabs from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewTabs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const tabs = [{ id: 'browser-1', title: 'New Tab' }];

describe('Browser focus action placement', () => {
  it('keeps browser focus and panel collapse controls in the same toolbar row', () => {
    const onToggle = vi.fn();
    const onClosePanel = vi.fn();
    const tabsContainerRef = React.createRef<HTMLDivElement>();
    const props = {
      tabs,
      activeTabId: 'browser-1',
      tabFadeState: { left: false, right: false },
      tabsContainerRef,
      onSwitchTab: vi.fn(),
      onCloseTab: vi.fn(),
      onContextMenu: vi.fn(),
      onClosePanel,
    };
    const { rerender } = render(<PreviewTabs {...props} browserFocus={{ active: false, onToggle }} />);
    const focus = screen.getByRole('button', { name: 'conversation.workspace.panelLayout.focusBrowser' });
    const collapse = screen.getByRole('button', { name: 'preview.collapsePanel' });

    expect(focus.parentElement).toBe(collapse.parentElement);
    expect(collapse.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(focus).toHaveClass('!w-24px', '!h-24px');
    expect(collapse).toHaveClass('!w-24px', '!h-24px');

    fireEvent.click(focus);
    fireEvent.click(collapse);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onClosePanel).toHaveBeenCalledTimes(1);

    rerender(<PreviewTabs {...props} browserFocus={{ active: true, onToggle }} />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.workspace.panelLayout.exitBrowserFocus' }));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
