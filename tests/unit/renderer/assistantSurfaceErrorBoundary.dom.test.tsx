import { render, screen } from '@testing-library/react';
import React from 'react';
import AssistantSurfaceErrorBoundary from '@renderer/pages/assistantSurface/shell/AssistantSurfaceErrorBoundary';

const BrokenSurface = (): React.ReactNode => {
  throw new Error('fixture render failure');
};

describe('AssistantSurfaceErrorBoundary', () => {
  it('renders the safe fallback instead of a blank page', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AssistantSurfaceErrorBoundary fallback={<div>General fallback</div>}>
        <BrokenSurface />
      </AssistantSurfaceErrorBoundary>
    );

    expect(screen.getByText('General fallback')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
