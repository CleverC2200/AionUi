/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';

const mocks = vi.hoisted(() => ({
  listVoiceConfigurations: vi.fn(),
  providers: [] as IProvider[],
  mutate: vi.fn(),
  syncPersonalModels: vi.fn(),
  updateVoiceConfiguration: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { checkProviderHealth: { invoke: vi.fn() } },
    larkAuth: { syncPersonalModels: { invoke: mocks.syncPersonalModels } },
    mode: {
      createProvider: { invoke: vi.fn() },
      deleteProvider: { invoke: vi.fn() },
      listProviders: { invoke: vi.fn() },
      updateProvider: { invoke: vi.fn() },
    },
    voice: {
      listConfigurations: { invoke: mocks.listVoiceConfigurations },
      createConfiguration: { invoke: vi.fn() },
      updateConfiguration: { invoke: mocks.updateVoiceConfiguration },
      setConfigurationEnabled: { invoke: vi.fn() },
      deleteConfiguration: { invoke: vi.fn() },
      checkConfigurationHealth: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: mocks.providers, mutate: mocks.mutate }),
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'page',
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageHeader', () => ({
  default: ({
    title,
    actions,
    tabs,
    onTabChange,
  }: {
    title: React.ReactNode;
    actions: React.ReactNode;
    tabs?: Array<{ key: string; label: React.ReactNode }>;
    onTabChange?: (key: string) => void;
  }) => (
    <div>
      <span>{title}</span>
      {actions}
      {tabs?.map((tab) => (
        <button key={tab.key} onClick={() => onTabChange?.(tab.key)}>
          {tab.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@/renderer/components/base/AionScrollArea', () => ({
  default: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({ visible, children }: React.PropsWithChildren<{ visible: boolean }>) =>
    visible ? <div role='dialog'>{children}</div> : null,
}));

vi.mock('@/renderer/hooks/assistant/useTalkToButler', () => ({ useTalkToButler: () => vi.fn() }));

vi.mock('@/renderer/hooks/system/useDeepLink', () => ({ consumePendingDeepLink: () => null }));

vi.mock('@/renderer/pages/settings/components/AddModelModal', () => ({
  default: { useModal: () => [{ close: vi.fn(), open: vi.fn() }, null] },
}));
vi.mock('@/renderer/pages/settings/components/AddPlatformModal', () => ({
  default: { useModal: () => [{ close: vi.fn(), open: vi.fn() }, null] },
}));
vi.mock('@/renderer/pages/settings/components/EditModeModal', () => ({
  default: { useModal: () => [{ close: vi.fn(), open: vi.fn() }, null] },
}));

import ModelModalContent from '@/renderer/components/settings/SettingsModal/contents/ModelModalContent';

const provider = (id: string): IProvider => ({
  id,
  platform: 'openai',
  name: 'GEA · sales-forecast',
  base_url: 'http://127.0.0.1:1234/personal/provider',
  api_key: 'local-key',
  models: ['deepseek-v4-flash'],
  enabled: true,
  model_enabled: { 'deepseek-v4-flash': true },
});

const expandProvider = () => {
  const header = screen.getByText('GEA · sales-forecast').closest('[role="button"]');
  expect(header).not.toBeNull();
  fireEvent.click(header!);
};

const triggerGeaSync = async () => {
  fireEvent.click(screen.getByTestId('add-model-menu'));
  const item = await screen.findByTestId('add-model-menu-gea');
  fireEvent.click((item.closest('[role="menuitem"]') ?? item) as HTMLElement);
};

describe('ModelModalContent managed personal model controls', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  beforeEach(() => {
    mocks.mutate.mockReset();
    mocks.syncPersonalModels.mockReset();
    mocks.syncPersonalModels.mockResolvedValue({
      success: true,
      data: { configured: 1, failed: 0, skipped: 0, status: 'completed' },
    });
    mocks.listVoiceConfigurations.mockResolvedValue([
      {
        id: 'environment',
        name: 'Production voice',
        enabled: true,
        provider: 'volcengine-rtc',
        source: 'environment',
        rtc_app_id: 'rtc-app-id',
        access_key_configured: true,
        secret_key_configured: true,
        rtc_app_key_configured: true,
        agent_user_id: 'voice-agent',
        welcome_message: '你好',
        asr_app_id: 'asr-app-id',
        asr_cluster: 'asr-cluster',
        tts_app_id: 'tts-app-id',
        tts_cluster: 'tts-cluster',
        tts_voice_type: 'BV001_streaming',
        llm_url: 'https://api.example.com',
        llm_api_key_configured: true,
        llm_model_name: 'voice-llm',
        system_message: '系统提示词',
        created_at: 0,
        updated_at: 0,
      },
    ]);
  });

  it('offers a GEA refresh action and reloads providers after syncing', async () => {
    mocks.providers = [];
    render(<ModelModalContent />);

    await triggerGeaSync();

    await waitFor(() => expect(mocks.syncPersonalModels).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalled());
  });

  it('keeps visible feedback on the add-model button while GEA sync is pending', async () => {
    let resolveSync!: (value: Awaited<ReturnType<typeof mocks.syncPersonalModels>>) => void;
    mocks.syncPersonalModels.mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      })
    );
    mocks.providers = [];
    render(<ModelModalContent />);

    await triggerGeaSync();

    await waitFor(() => {
      const button = screen.getByTestId('add-model-menu');
      expect(button).toHaveTextContent('settings.personalModelFetching');
      expect(button).toHaveClass('arco-btn-loading');
    });

    resolveSync({
      success: true,
      data: { configured: 0, failed: 0, skipped: 0, status: 'completed' },
    });
  });

  it('keeps only enable switches for an automatically managed provider', () => {
    mocks.providers = [provider('gea-personal-1234567890abcdef12345678')];
    render(<ModelModalContent />);
    expandProvider();

    expect(screen.getByText('settings.personalModelManaged')).toBeInTheDocument();
    expect(screen.getByTestId('provider-toggle-gea-personal-1234567890abcdef12345678')).toBeInTheDocument();
    expect(
      screen.getByTestId('model-toggle-gea-personal-1234567890abcdef12345678-deepseek-v4-flash')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('provider-actions-gea-personal-1234567890abcdef12345678')).toBeNull();
    expect(screen.queryByTestId('model-actions-gea-personal-1234567890abcdef12345678-deepseek-v4-flash')).toBeNull();
  });

  it('leaves edit and delete actions available for a user-managed provider', () => {
    mocks.providers = [provider('user-provider')];
    render(<ModelModalContent />);
    expandProvider();

    expect(screen.getByTestId('provider-actions-user-provider')).toBeInTheDocument();
    expect(screen.getByTestId('model-actions-user-provider-deepseek-v4-flash')).toBeInTheDocument();
  });

  it('keeps the environment voice configuration managed while allowing user additions', async () => {
    mocks.providers = [provider('user-provider')];
    render(<ModelModalContent />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.modelCategoryVoice' }));

    expect(await screen.findByText('settings.voiceModelVolcengine')).toBeInTheDocument();
    expect(await screen.findByText('Production voice')).toBeInTheDocument();
    expect(mocks.listVoiceConfigurations).toHaveBeenCalledOnce();
    expect(screen.queryByDisplayValue('rtc-app-id')).toBeNull();
    expect(screen.getByText('settings.voiceConfigurationManaged')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'settings.voiceConfigurationEdit' })).toBeNull();
    expect(screen.getByTestId('voice-configuration-environment').querySelector('[role="switch"]')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'settings.voiceConfigurationAdd' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/secret/i)).toBeNull();
  });

  it('keeps user-added voice configurations editable', async () => {
    mocks.listVoiceConfigurations.mockResolvedValueOnce([
      {
        id: 'voice-user-1',
        name: 'User voice',
        enabled: true,
        provider: 'volcengine-rtc',
        source: 'saved',
        rtc_app_id: 'user-rtc-app-id',
        access_key_configured: true,
        secret_key_configured: true,
        rtc_app_key_configured: true,
        agent_user_id: 'voice-agent',
        welcome_message: '你好',
        asr_app_id: 'asr-app-id',
        asr_cluster: 'asr-cluster',
        tts_app_id: 'tts-app-id',
        tts_cluster: 'tts-cluster',
        tts_voice_type: 'BV001_streaming',
        llm_url: 'https://api.example.com',
        llm_api_key_configured: true,
        llm_model_name: 'voice-llm',
        system_message: '系统提示词',
        created_at: 1,
        updated_at: 1,
      },
    ]);
    render(<ModelModalContent />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.modelCategoryVoice' }));
    await screen.findByText('User voice');
    fireEvent.click(screen.getByRole('button', { name: 'settings.voiceConfigurationEdit' }));

    expect(await screen.findByDisplayValue('user-rtc-app-id')).toBeInTheDocument();
  });
});
