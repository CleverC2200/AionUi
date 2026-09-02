import React from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { getAssistantSurface, isAssistantSurfaceAvailable } from './registry';
import { getAssistantSurfaceStateScope } from './storage';
import AssistantSurfaceErrorBoundary from './shell/AssistantSurfaceErrorBoundary';
import ForecastAssistantSurface from './ForecastAssistantSurface';

const AssistantSurfacePage: React.FC = () => {
  const { user } = useAuth();
  const { surfaceId, businessView } = useParams<{ surfaceId: string; businessView?: string }>();
  const surface = getAssistantSurface(surfaceId);

  if (!surface || surface.id === 'general' || !isAssistantSurfaceAvailable(surface)) {
    return <Navigate to='/guid' replace />;
  }

  if (businessView !== undefined && businessView !== 'messages') {
    return <Navigate to={surface.route} replace />;
  }

  const userId = user?.id ?? (window.__aionuiE2ETest ? 'e2e-user' : 'anonymous');
  const stateScope = getAssistantSurfaceStateScope(
    userId,
    surface.id,
    window.__aionuiAssistantSurfaceFixtures === true
  );

  return (
    <AssistantSurfaceErrorBoundary fallback={<Navigate to='/guid' replace />}>
      <ForecastAssistantSurface stateScope={stateScope} businessView={businessView} />
    </AssistantSurfaceErrorBoundary>
  );
};

export default AssistantSurfacePage;
