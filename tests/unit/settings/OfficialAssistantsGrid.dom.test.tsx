import type { AssistantListItem } from '@/renderer/pages/settings/AssistantSettings/types';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue || _key,
  }),
}));

vi.mock('@/renderer/pages/settings/AssistantSettings/AssistantAvatar', () => ({
  default: ({ assistant }: { assistant: AssistantListItem }) => <div data-testid={`avatar-${assistant.id}`} />,
}));

vi.mock('@/renderer/pages/settings/AssistantSettings/home/RuntimeBadge', () => ({
  default: ({ assistant }: { assistant: AssistantListItem }) => <div data-testid={`runtime-${assistant.id}`} />,
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Dropdown: ({ children, droplist }: { children?: React.ReactNode; droplist?: React.ReactNode }) => (
      <div>
        {children}
        {droplist}
      </div>
    ),
  };
});

import OfficialAssistantsGrid from '@/renderer/pages/settings/AssistantSettings/home/OfficialAssistantsGrid';

const managedAssistant: AssistantListItem = {
  id: 'enterprise-finance',
  source: 'managed',
  name: 'Finance Close',
  name_i18n: { 'zh-CN': '财务关账助手' },
  description: 'Governed finance close',
  description_i18n: {},
  enabled: true,
  sort_order: 0,
  agent_id: 'finance-agent',
  enabled_skills: ['finance-close'],
  custom_skill_names: [],
  disabled_builtin_skills: [],
  context_i18n: {},
  prompts: [],
  prompts_i18n: {},
  models: [],
  agent_status: 'online',
  team_selectable: true,
  deletable: false,
  managed: {
    assignment_id: 'assignment-finance',
    template_id: 'finance-close',
    template_version: '1.0.0',
    catalog_revision: 'catalog-r1',
    activation: 'required',
    state: 'active',
    minimum_client_version: '2.1.53',
    sync_status: 'fresh',
    required_skill_ids: ['finance-close'],
    required_mcp_ids: ['finance-production'],
    user_extensions: { mode: 'additive', allow_skills: true, allow_mcps: true },
    extensions: { revision: 'catalog-r1', skill_ids: [], mcp_ids: [], status: 'active', violations: [] },
  },
};

const renderGrid = (assistant = managedAssistant) => {
  const handlers = {
    onOpenSettings: vi.fn(),
    onDuplicate: vi.fn(),
    onToggleEnabled: vi.fn(),
    onStartChat: vi.fn(),
    onRetry: vi.fn(),
  };
  render(
    <OfficialAssistantsGrid
      assistants={[assistant]}
      catalogMode='managed'
      catalogSyncStatus='fresh'
      localeKey='zh-CN'
      {...handlers}
    />
  );
  return handlers;
};

describe('OfficialAssistantsGrid managed mode', () => {
  it('shows enterprise state and locks a required assistant', () => {
    renderGrid();
    expect(screen.getByText('财务关账助手')).toBeInTheDocument();
    expect(screen.getByText('Enterprise managed')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByTestId('switch-enabled-enterprise-finance')).toBeDisabled();
    expect(screen.queryByTestId('menu-duplicate-enterprise-finance')).not.toBeInTheDocument();
  });

  it('opens the governed settings surface without offering duplication', () => {
    const { onOpenSettings, onDuplicate } = renderGrid();
    fireEvent.click(screen.getByTestId('official-card-enterprise-finance'));
    expect(onOpenSettings).toHaveBeenCalledWith(expect.objectContaining({ id: 'enterprise-finance' }));
    expect(onDuplicate).not.toHaveBeenCalled();
  });

  it('supports opening a governed assistant with the keyboard', () => {
    const { onOpenSettings } = renderGrid();
    fireEvent.keyDown(screen.getByTestId('official-card-enterprise-finance'), { key: 'Enter' });
    expect(onOpenSettings).toHaveBeenCalledWith(expect.objectContaining({ id: 'enterprise-finance' }));
  });

  it('disables chat and activation for a suspended assignment', () => {
    renderGrid({
      ...managedAssistant,
      enabled: false,
      team_selectable: false,
      managed: { ...managedAssistant.managed!, activation: 'optional', state: 'suspended' },
    });
    expect(screen.getByText('Suspended')).toBeInTheDocument();
    expect(screen.queryByTestId('btn-chat-enterprise-finance')).not.toBeInTheDocument();
    expect(screen.getByTestId('switch-enabled-enterprise-finance')).toBeDisabled();
  });

  it('shows last-good status inline and retries in place', () => {
    const onRetry = vi.fn();
    render(
      <OfficialAssistantsGrid
        assistants={[managedAssistant]}
        catalogMode='managed'
        catalogSyncStatus='stale'
        catalogError='CATALOG_OFFLINE'
        localeKey='zh-CN'
        onOpenSettings={vi.fn()}
        onDuplicate={vi.fn()}
        onToggleEnabled={vi.fn()}
        onStartChat={vi.fn()}
        onRetry={onRetry}
      />
    );

    expect(screen.getByText(/Showing the last synced enterprise catalog/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('catalog-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
