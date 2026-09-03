import { render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentSurfaceVariantA,
  SpecializedAgentSurface,
} from '@/renderer/pages/assistantSurface/fixtures/FixtureWorkbenches';
import styles from '@/renderer/pages/assistantSurface/fixtures/FixtureWorkbenches.module.css';

const t = ((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key) as TFunction;

describe('FixtureWorkbenches CSS module mapping', () => {
  it('keeps the root plus General and Business shell classes mapped locally', () => {
    const onAgentChange = vi.fn();
    const { container, rerender } = render(
      <MemoryRouter>
        <AgentSurfaceVariantA agentId='general' onAgentChange={onAgentChange} t={t} />
      </MemoryRouter>
    );

    const generalRoot = container.querySelector('[data-agent="general"]');
    expect(generalRoot).toHaveClass(styles['agent-surface-prototype']);
    expect(generalRoot?.querySelector('aside')).toHaveClass(styles['asp-general-sidebar']);

    rerender(
      <MemoryRouter>
        <SpecializedAgentSurface
          agentId='forecast'
          onAgentChange={onAgentChange}
          stateScope='fixture-css-module-test'
          t={t}
        />
      </MemoryRouter>
    );

    const businessRoot = screen.getByTestId('assistant-surface-forecast');
    expect(businessRoot).toHaveClass(styles['agent-surface-prototype']);
    expect(businessRoot.querySelector(`.${styles['asp-forecast-surface']}`)).toBeInTheDocument();
  });
});
