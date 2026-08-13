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

describe('AboutModalContent GEA remote service placeholder', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '2.1.13');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps app identity while removing official update, feedback and external links', () => {
    const { container } = render(<AboutModalContent />);

    expect(screen.getByText('GEAUi')).toBeInTheDocument();
    expect(screen.getByText('v2.1.13')).toBeInTheDocument();
    expect(screen.getByTestId('gea-remote-services-placeholder')).toHaveTextContent(
      'GEA · settings.channels.comingSoon'
    );
    expect(container.querySelector('a')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.checkForUpdates')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.bugReport')).not.toBeInTheDocument();
  });
});
