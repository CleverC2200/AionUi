import React from 'react';

type Props = React.PropsWithChildren<{ fallback: React.ReactNode }>;
type State = { failed: boolean };

class AssistantSurfaceErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    console.error('[AssistantSurface] Failed to render specialized surface:', error);
  }

  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default AssistantSurfaceErrorBoundary;
