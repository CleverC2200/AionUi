/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { VoiceSession } from '@/renderer/services/voice/VoiceSession';

export const useVoiceSession = (conversationId?: string) => {
  const session = useMemo(() => new VoiceSession(conversationId), [conversationId]);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  useEffect(
    () => () => {
      void session.stop().catch((): void => {});
    },
    [session]
  );

  return {
    snapshot,
    start: () => session.start(),
    stop: () => session.stop(),
    setMicrophoneEnabled: (enabled: boolean) => session.setMicrophoneEnabled(enabled),
  };
};
