/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'modal',
}));

import AboutModalContent from '@/renderer/components/settings/SettingsModal/contents/AboutModalContent';

const originalElectronAPI = window.electronAPI;

describe('AboutModalContent GEA remote service placeholder', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '2.1.13');
    window.electronAPI = {
      ...window.electronAPI,
      getRuntimeDiagnostics: vi.fn().mockResolvedValue({
        appVersion: '2.1.13',
        buildChannel: 'development',
        buildCommit: '1234567890abcdef',
        coreVersion: 'v0.1.72-aionui.1',
        dataDir: '/tmp/aionui-test-data',
      }),
    } as NonNullable<typeof window.electronAPI>;
  });

  afterEach(() => {
    cleanup();
    window.electronAPI = originalElectronAPI;
    vi.unstubAllGlobals();
  });

  it('keeps app identity and exposes local runtime provenance without external links', async () => {
    const { container } = render(<AboutModalContent />);

    expect(screen.getByText('GEAUi')).toBeInTheDocument();
    expect(screen.getByText('v2.1.13')).toBeInTheDocument();
    expect(screen.getByTestId('gea-remote-services-placeholder')).toHaveTextContent(
      'GEA · settings.channels.comingSoon'
    );
    expect(await screen.findByTestId('runtime-diagnostics')).toHaveTextContent(
      'settings.runtimeDiagnosticsBuildChanneldevelopment'
    );
    expect(screen.getByTestId('runtime-diagnostics')).toHaveTextContent('1234567890abcdef');
    expect(screen.getByTestId('runtime-diagnostics')).toHaveTextContent('v0.1.72-aionui.1');
    expect(screen.getByTestId('runtime-diagnostics')).toHaveTextContent('/tmp/aionui-test-data');
    expect(container.querySelector('a')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.checkForUpdates')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.bugReport')).not.toBeInTheDocument();
  });
});
