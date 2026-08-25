import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const preview = vi.hoisted(() => ({ isBrowserFocused: false, setBrowserFocused: vi.fn() }));

vi.mock('@/renderer/pages/conversation/Preview/context', () => ({
  usePreviewContext: () => preview,
}));

vi.mock('@/renderer/components/media/WebviewHost', () => ({
  default: ({ navBarActions }: { navBarActions?: React.ReactNode }) => <div>{navBarActions}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@icon-park/react', () => ({
  FullScreen: () => <span>expand</span>,
  OffScreen: () => <span>collapse</span>,
}));

import BrowserViewer from '@/renderer/pages/conversation/Preview/browser/BrowserViewer';

describe('BrowserViewer focus action', () => {
  beforeEach(() => {
    preview.isBrowserFocused = false;
    vi.clearAllMocks();
  });

  it('enters and exits browser focus mode from the navigation bar', () => {
    const props = {
      url: 'about:blank',
      tabId: 'browser-1',
      isActive: true,
      onUrlChange: vi.fn(),
      onTitleChange: vi.fn(),
      onFaviconChange: vi.fn(),
    };
    const { rerender } = render(<BrowserViewer {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.workspace.panelLayout.focusBrowser' }));
    expect(preview.setBrowserFocused).toHaveBeenCalledWith(true);

    preview.isBrowserFocused = true;
    rerender(<BrowserViewer {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.workspace.panelLayout.exitBrowserFocus' }));
    expect(preview.setBrowserFocused).toHaveBeenCalledWith(false);
  });
});
