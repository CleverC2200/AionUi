import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AssistantSurfaceNavigation from '@/renderer/pages/assistantSurface/shell/AssistantSurfaceNavigation';
import styles from '@/renderer/pages/assistantSurface/shell/AssistantSurfaceNavigation.module.css';

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'unauthenticated', user: null }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('AssistantSurfaceNavigation', () => {
  it('owns its static accent token through the root CSS module class', () => {
    render(
      <MemoryRouter>
        <AssistantSurfaceNavigation surfaceId='forecast' collapsed={false} />
      </MemoryRouter>
    );

    const navigation = screen.getByTestId('assistant-surface-navigation');
    expect(navigation).toHaveClass(styles.root);
    expect(navigation).not.toHaveAttribute('style');
    expect(screen.getByTestId('assistant-surface-navigation-forecast').querySelector(`.${styles.badge}`)).toBeNull();
  });
});
