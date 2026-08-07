/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import { ManagedVoiceDictation } from '@/renderer/services/voice/ManagedVoiceDictation';

type UseManagedVoiceDictationOptions = {
  onLiveTranscript?: (text: string | null) => void;
  onTranscript: (text: string) => void;
};

export const useManagedVoiceDictation = ({ onLiveTranscript, onTranscript }: UseManagedVoiceDictationOptions) => {
  const onLiveTranscriptRef = useLatestRef(onLiveTranscript);
  const onTranscriptRef = useLatestRef(onTranscript);
  const session = useMemo(
    () =>
      new ManagedVoiceDictation(
        (text) => onLiveTranscriptRef.current?.(text),
        (text) => onTranscriptRef.current(text)
      ),
    [onLiveTranscriptRef, onTranscriptRef]
  );
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);

  useEffect(() => {
    if (snapshot.status !== 'recording') {
      if (snapshot.status === 'idle') setRecordingDurationMs(0);
      return;
    }
    const startedAt = Date.now();
    setRecordingDurationMs(0);
    const timer = window.setInterval(() => setRecordingDurationMs(Date.now() - startedAt), 250);
    return () => window.clearInterval(timer);
  }, [snapshot.status]);

  useEffect(
    () => () => {
      void session.stop();
    },
    [session]
  );

  return {
    clearError: () => session.clearError(),
    errorCode: snapshot.errorCode,
    errorMessage: snapshot.errorMessage,
    recordingDurationMs,
    recordingLevels: [] as number[],
    startRecording: () => session.start(),
    status: snapshot.status,
    stopRecording: () => session.stop(),
  };
};
