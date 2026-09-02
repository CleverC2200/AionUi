import type { TFunction } from 'i18next';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BusinessSurfaceShell from './components/BusinessSurfaceShell';
import BusinessMessageInbox from './components/BusinessMessageInbox';
import RegionalApprovalWorkbench, {
  type RegionalApprovalWorkbenchContext,
} from './workbenches/regionalApproval/RegionalApprovalWorkbench';
import { getAssistantSurfaceWorkbenchScope, readAssistantSurfaceState, writeAssistantSurfaceState } from './storage';
import {
  resolveSurfaceContextRevision,
  type SurfaceContextRevisionState,
  type SurfaceContextSnapshot,
} from './surfaceContext';

const CURRENT_WORKBENCH_FOCUS = {
  target: 'current-workbench',
  priority: ['selectedEntities', 'visibleEntities', 'metrics', 'scope'],
  constrainToSnapshot: true,
} as const;

const contextSummary = (context: RegionalApprovalWorkbenchContext, t: TFunction) => {
  const authority = context.authority;
  if (!authority) return '';
  return t('common.assistantSurface.regionalApproval.authorityContextSummary', {
    source: t(`common.assistantSurface.regionalApproval.contextSources.${authority.source}`),
    stage: t(`common.assistantSurface.regionalApproval.stages.${authority.filterSummary.approvalStage}`),
    planId: authority.planId ?? '—',
    status: authority.status ?? '—',
  });
};

export const shouldDisableFixtureSalesPlanQuery = ({
  fixtureEnvironment,
  e2eEnvironment,
  e2eSalesPlanQuery,
}: {
  fixtureEnvironment: boolean;
  e2eEnvironment: boolean;
  e2eSalesPlanQuery: boolean;
}) => fixtureEnvironment && !(e2eEnvironment && e2eSalesPlanQuery);

const ForecastAssistantSurface: React.FC<{ stateScope: string; businessView?: string }> = ({
  stateScope,
  businessView,
}) => {
  const { t } = useTranslation();
  const [surfaceContext, setSurfaceContext] = useState<SurfaceContextSnapshot>();
  const [surfaceContextConversationId, setSurfaceContextConversationId] = useState<string | null>();

  const handleBoardContextChange = useCallback(
    (context: RegionalApprovalWorkbenchContext, conversationId: string | null) => {
      if (!context.authority) {
        setSurfaceContext(undefined);
        setSurfaceContextConversationId(conversationId);
        return;
      }
      const payload = {
        focus: CURRENT_WORKBENCH_FOCUS,
        ...context,
      };
      const serialized = JSON.stringify(payload);
      const candidateKey = `${getAssistantSurfaceWorkbenchScope(stateScope)}:context-candidate`;
      const previousCandidate = readAssistantSurfaceState<SurfaceContextRevisionState | null>(
        'forecast',
        candidateKey,
        null
      );
      const candidate = resolveSurfaceContextRevision(previousCandidate, serialized, new Date().toISOString());
      if (candidate !== previousCandidate) {
        writeAssistantSurfaceState('forecast', candidateKey, candidate);
      }
      setSurfaceContextConversationId(conversationId);
      setSurfaceContext({
        schemaVersion: 1,
        surfaceId: 'forecast',
        revision: candidate.revision,
        capturedAt: candidate.capturedAt,
        label: t('common.assistantSurface.forecastBoardLabel'),
        summary: contextSummary(context, t),
        payload,
      });
    },
    [stateScope, t]
  );

  const showingMessages = businessView === 'messages';
  const fixtureEnvironment = typeof window !== 'undefined' && window.__aionuiAssistantSurfaceFixtures === true;
  const queryClient: null | undefined = shouldDisableFixtureSalesPlanQuery({
    fixtureEnvironment,
    e2eEnvironment: typeof window !== 'undefined' && window.__aionuiE2ETest === true,
    e2eSalesPlanQuery: typeof window !== 'undefined' && window.__aionuiE2ESalesPlanQuery === true,
  })
    ? null
    : undefined;
  // The ordinary list contract does not expose responsibility node, workflow
  // node, task state or actionability. Keep production actions fail-closed
  // until those authoritative fields are available from GEA.
  const liveActionsEnabled = false;

  return (
    <BusinessSurfaceShell
      surfaceId='forecast'
      stateScope={stateScope}
      surfaceContext={showingMessages ? undefined : surfaceContext}
      surfaceContextConversationId={showingMessages ? undefined : surfaceContextConversationId}
      agentName={t('common.assistantSurface.forecast.name')}
      conversationTitle={t('common.assistantSurface.forecastConversation')}
      selectConversationLabel={t('common.assistantSurface.selectConversation')}
      boardLabel={
        showingMessages
          ? t('common.assistantSurface.messages.title')
          : t('common.assistantSurface.regionalApproval.ariaLabel')
      }
      {...(showingMessages ? { fixtureBoundary: t('common.assistantSurface.messages.boundary') } : {})}
      workflowCurrent={0}
      workflowSteps={[]}
    >
      {showingMessages ? (
        <BusinessMessageInbox />
      ) : (
        <RegionalApprovalWorkbench
          stateScope={stateScope}
          t={t}
          onContextChange={handleBoardContextChange}
          queryClient={queryClient}
          liveActionsEnabled={liveActionsEnabled}
        />
      )}
    </BusinessSurfaceShell>
  );
};

export default ForecastAssistantSurface;
