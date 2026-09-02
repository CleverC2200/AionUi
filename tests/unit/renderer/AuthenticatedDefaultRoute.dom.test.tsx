import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PanelRoute from '@/renderer/components/layout/Router';

vi.mock('@/renderer/hooks/system/useCrossSessionRateLimitNotice', () => ({
  useCrossSessionRateLimitNotice: () => undefined,
}));

vi.mock('@renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated' }),
}));

vi.mock('@renderer/components/layout/DocumentTitle', () => ({
  default: () => null,
}));

vi.mock('@renderer/pages/assistantSurface', () => ({
  default: () => <div data-testid='forecast-workbench' />,
}));

describe('authenticated default route', () => {
  beforeEach(() => {
    window.__aionuiE2EAuthBypass = true;
  });

  afterEach(() => {
    cleanup();
    window.location.hash = '';
    delete window.__aionuiE2EAuthBypass;
  });

  it.each(['/login', '/', '/unknown-route'])('opens the forecast workbench from %s', async (initialRoute) => {
    window.location.hash = `#${initialRoute}`;

    render(<PanelRoute layout={<Outlet />} />);

    await waitFor(() => {
      expect(window.location.hash).toBe('#/assistant-surface/forecast');
    });
  });
});
