import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import SiderItem from '@/renderer/components/layout/Sider/SiderItem';

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@arco-design/web-react', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  return {
    Tooltip: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    Dropdown: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    Menu: Object.assign(
      ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('div', null, children),
      {
        Item: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('div', null, children),
      }
    ),
  };
});

vi.mock('@icon-park/react', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  const icon = (name: string) =>
    function MockIcon() {
      return ReactModule.createElement('span', { 'data-mock-icon': name });
    };
  return { MoreOne: icon('MoreOne'), Pushpin: icon('Pushpin') };
});

describe('SiderItem keyboard behavior', () => {
  it('activates the row from the keyboard and exposes a stable selector', () => {
    const onClick = vi.fn();
    render(<SiderItem icon={<span />} name='Operations team' testId='team-sider-item-team-1' onClick={onClick} />);

    const row = screen.getByTestId('team-sider-item-team-1');
    const activation = within(row).getByRole('button', { name: 'Operations team' });
    expect(activation).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(activation, { key: 'Enter' });

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('opens the row action menu from the keyboard without activating the row', () => {
    const onClick = vi.fn();
    render(
      <SiderItem
        icon={<span />}
        name='Operations team'
        testId='team-sider-item-team-1'
        menuItems={[{ key: 'rename', icon: <span />, label: 'Rename' }]}
        onMenuAction={vi.fn()}
        onClick={onClick}
      />
    );

    const trigger = screen.getByTestId('sider-item-menu-trigger');
    expect(trigger).toHaveAttribute('role', 'button');
    expect(trigger).toHaveAttribute('tabindex', '0');
    expect(trigger).toHaveAttribute('aria-label', 'common.more');
    expect(
      within(screen.getByTestId('team-sider-item-team-1')).getByRole('button', { name: 'Operations team' })
    ).not.toContainElement(trigger);

    fireEvent.keyDown(trigger, { key: ' ' });

    expect(onClick).not.toHaveBeenCalled();
  });
});
