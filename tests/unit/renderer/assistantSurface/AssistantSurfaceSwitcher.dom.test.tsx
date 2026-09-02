import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AssistantSurfaceSwitcher from '@/renderer/pages/assistantSurface/shell/AssistantSurfaceSwitcher';

const switcherStyles = readFileSync(
  resolve(
    process.cwd(),
    'packages/desktop/src/renderer/pages/assistantSurface/shell/AssistantSurfaceSwitcher.module.css'
  ),
  'utf8'
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

describe('AssistantSurfaceSwitcher', () => {
  it('opens below the titlebar while retaining its mask and close behavior', async () => {
    render(
      <MemoryRouter initialEntries={['/assistant-surface/forecast']}>
        <AssistantSurfaceSwitcher />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('assistant-surface-switcher'));

    const dialog = await screen.findByRole('dialog', { name: '切换工作模式' });
    const wrapper = dialog.closest('.arco-drawer-wrapper');
    const drawer = dialog.closest('.arco-drawer');
    expect(wrapper).toBeTruthy();
    expect(wrapper?.className).toMatch(/titlebarSafeWrapper/);
    expect(wrapper?.querySelector('.arco-drawer-mask')).toBeInTheDocument();
    expect(switcherStyles).toMatch(
      /\.titlebarSafeWrapper\s*\{[^}]*top:\s*var\(--titlebar-height\);[^}]*bottom:\s*0;[^}]*height:\s*calc\(100% - var\(--titlebar-height\)\);/s
    );
    const nativeClose = drawer?.querySelector('.arco-drawer-close-icon');
    expect(nativeClose).toBeInstanceOf(HTMLElement);
    expect(drawer?.querySelectorAll('.arco-drawer-close-icon')).toHaveLength(1);
    expect(drawer?.querySelector('.arco-drawer-header-title button')).not.toBeInTheDocument();

    fireEvent.click(nativeClose!);
    await waitFor(() => expect(wrapper).toHaveClass('arco-drawer-wrapper-hide'));
  });
});
