/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message, Button, Tooltip } from '@arco-design/web-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SPEECH_TO_TEXT_CONFIG_CHANGED_EVENT } from '@/renderer/services/SpeechToTextService';
import { getClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import {
  getSpeechInputErrorMessageKey,
  useSpeechInput,
  type SpeechInputAvailability,
} from '@/renderer/hooks/system/useSpeechInput';
import { useManagedVoiceDictation } from '@/renderer/hooks/voice/useManagedVoiceDictation';
import { getManagedVoiceCapability } from '@/renderer/services/voice/voiceCapability';
import { preloadVolcengineVoiceTransport } from '@/renderer/services/voice/VolcengineVoiceTransport';

type SpeechInputButtonProps = {
  /** Live transcript of the active streaming session; `null` clears it. */
  onLiveTranscript?: (text: string | null) => void;
  onTranscript: (transcript: string) => void;
};

let activeSpeechInputOwner: symbol | null = null;

const SpeechMicIcon = () => (
  <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
    <path d='M12 3a3 3 0 0 1 3 3v6a3 3 0 1 1-6 0V6a3 3 0 0 1 3-3Z' />
    <path d='M19 10v2a7 7 0 0 1-14 0v-2' />
    <path d='M12 19v3' />
  </svg>
);

const SpeechStopIcon = () => (
  <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
    <rect x='6' y='6' width='12' height='12' rx='2.5' />
  </svg>
);

const SpeechLoaderIcon = () => <span className='speech-loader-spinner' aria-hidden='true' />;

const getAvailabilityMessageKey = (availability: SpeechInputAvailability) => {
  switch (availability) {
    case 'file':
      return 'conversation.chat.speech.pickFileTooltip';
    case 'unsupported':
      return 'conversation.chat.speech.unsupported';
    default:
      return 'conversation.chat.speech.recordTooltip';
  }
};

const formatSpeechDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const getTooltipKey = (
  availability: SpeechInputAvailability,
  isListening: boolean,
  isConnecting: boolean,
  isProcessing: boolean
) => {
  if (isProcessing) {
    return 'conversation.chat.speech.processing';
  }
  if (isConnecting) {
    return 'conversation.chat.speech.connecting';
  }
  if (isListening) {
    return 'conversation.chat.speech.stopTooltip';
  }
  if (availability === 'record') {
    return 'conversation.chat.speech.recordTooltip';
  }
  return getAvailabilityMessageKey(availability);
};

const isSpeechShortcut = (event: KeyboardEvent) =>
  event.code === 'KeyM' && !event.shiftKey && (event.metaKey || event.ctrlKey);

const SpeechInputButton: React.FC<SpeechInputButtonProps> = ({ onLiveTranscript, onTranscript }) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const ownerIdRef = useRef(Symbol('speech-input'));
  const [isSpeechToTextEnabled, setIsSpeechToTextEnabled] = useState(false);
  const [isManagedDictationEnabled, setIsManagedDictationEnabled] = useState(false);
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const legacySpeechInput = useSpeechInput({
    onLiveTranscript,
    onTranscript,
  });
  const managedSpeechInput = useManagedVoiceDictation({
    onLiveTranscript,
    onTranscript,
  });
  const speechInput = isSpeechToTextEnabled ? legacySpeechInput : managedSpeechInput;
  const {
    availability,
    clearError,
    errorCode,
    errorMessage,
    recordingDurationMs,
    recordingLevels,
    startRecording,
    status,
    stopRecording,
    transcribeFile,
  } = {
    availability: isSpeechToTextEnabled ? legacySpeechInput.availability : ('record' as const),
    clearError: speechInput.clearError,
    errorCode: speechInput.errorCode,
    errorMessage: speechInput.errorMessage,
    recordingDurationMs: speechInput.recordingDurationMs,
    recordingLevels: speechInput.recordingLevels,
    startRecording: speechInput.startRecording,
    status: speechInput.status,
    stopRecording: speechInput.stopRecording,
    transcribeFile: legacySpeechInput.transcribeFile,
  };

  const isRecording = status === 'recording';
  const isConnecting = status === 'connecting';
  const isProcessing = status === 'transcribing';
  const speechStatusRef = useRef(status);
  speechStatusRef.current = status;
  const showSpeechFeedback = isConnecting || isRecording;
  const displayedWaveformLevels = useMemo(() => {
    if (recordingLevels.length > 0) {
      return recordingLevels;
    }
    return [0.08, 0.12, 0.1, 0.16, 0.09, 0.14];
  }, [recordingLevels]);

  useEffect(() => {
    let cancelled = false;

    const syncSpeechToTextEnabled = async () => {
      try {
        const [config, capability] = await Promise.all([
          getClientBusinessSetting('tools.speechToText'),
          getManagedVoiceCapability(),
        ]);
        if (cancelled) {
          return;
        }
        setIsSpeechToTextEnabled(Boolean(config?.enabled));
        setIsManagedDictationEnabled(capability.enabled);
        if (capability.enabled) {
          void preloadVolcengineVoiceTransport();
        }
      } catch {
        if (cancelled) {
          return;
        }
        setIsSpeechToTextEnabled(false);
        setIsManagedDictationEnabled(false);
      } finally {
        if (!cancelled) {
          setIsConfigLoaded(true);
        }
      }
    };

    const handleConfigChanged = () => {
      void syncSpeechToTextEnabled();
    };

    void syncSpeechToTextEnabled();
    window.addEventListener(SPEECH_TO_TEXT_CONFIG_CHANGED_EVENT, handleConfigChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(SPEECH_TO_TEXT_CONFIG_CHANGED_EVENT, handleConfigChanged);
    };
  }, []);

  useEffect(() => {
    if (!errorCode) {
      return;
    }

    const baseMessage = t(getSpeechInputErrorMessageKey(errorCode));
    const detail = errorMessage?.trim();
    if (errorCode === 'empty-transcript') {
      Message.warning(baseMessage);
      clearError();
      return;
    }
    Message.error(detail ? `${baseMessage}: ${detail}` : baseMessage);
    clearError();
  }, [clearError, errorCode, errorMessage, t]);

  useEffect(() => {
    if (!isConfigLoaded || (!isSpeechToTextEnabled && !isManagedDictationEnabled) || availability !== 'record') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSpeechShortcut(event) || event.repeat || speechStatusRef.current === 'transcribing') {
        return;
      }
      const sendBox = controlRef.current?.closest('.sendbox-panel');
      const focusedSendBox =
        document.activeElement instanceof Element ? document.activeElement.closest('.sendbox-panel') : null;
      if (focusedSendBox ? focusedSendBox !== sendBox : activeSpeechInputOwner !== ownerIdRef.current) {
        return;
      }
      activeSpeechInputOwner = ownerIdRef.current;
      event.preventDefault();
      if (speechStatusRef.current === 'connecting' || speechStatusRef.current === 'recording') {
        stopRecording();
        return;
      }
      void startRecording();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (activeSpeechInputOwner === ownerIdRef.current) {
        activeSpeechInputOwner = null;
      }
    };
  }, [availability, isConfigLoaded, isManagedDictationEnabled, isSpeechToTextEnabled, startRecording, stopRecording]);

  const handleClick = () => {
    if (!isSpeechToTextEnabled && !isManagedDictationEnabled) {
      Message.warning(t('conversation.chat.speech.notConfigured'));
      return;
    }

    if (isSpeechToTextEnabled && availability === 'unsupported') {
      Message.warning(t(getAvailabilityMessageKey(availability)));
      return;
    }

    if (isConnecting || isRecording) {
      stopRecording();
      return;
    }

    if (isSpeechToTextEnabled && availability === 'file') {
      fileInputRef.current?.click();
      return;
    }

    void startRecording();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    void transcribeFile(file);
  };

  if (!isConfigLoaded) {
    return null;
  }

  const isConfigured = isSpeechToTextEnabled || isManagedDictationEnabled;
  const tooltipKey = isConfigured
    ? getTooltipKey(availability, isRecording, isConnecting, isProcessing)
    : 'conversation.chat.speech.notConfigured';
  const ariaLabel =
    isConfigured && availability === 'record' && !isConnecting && !isRecording && !isProcessing
      ? t('conversation.chat.speech.recordTooltipWithShortcut')
      : t(tooltipKey);
  const icon =
    isConnecting || isRecording ? <SpeechStopIcon /> : isProcessing ? <SpeechLoaderIcon /> : <SpeechMicIcon />;

  return (
    <>
      <input
        ref={fileInputRef}
        type='file'
        accept='audio/*'
        capture='user'
        className='hidden'
        onChange={handleFileChange}
      />
      <div
        ref={controlRef}
        className={`speech-input-control ${showSpeechFeedback ? 'speech-input-control--active' : ''}`}
        onMouseEnter={() => {
          activeSpeechInputOwner = ownerIdRef.current;
        }}
        onFocusCapture={() => {
          activeSpeechInputOwner = ownerIdRef.current;
        }}
      >
        {showSpeechFeedback && (
          <div
            className={`speech-input-feedback ${isRecording ? 'speech-input-feedback--recording' : ''}`}
            role='status'
            aria-live='polite'
          >
            <div className='speech-input-feedback__waveform' aria-hidden='true'>
              {displayedWaveformLevels.map((level, index) => (
                <span
                  key={`speech-wave-${index}`}
                  className='speech-input-feedback__bar'
                  style={{
                    height: `${Math.max(1.5, 1 + level * 18)}px`,
                    animationDelay: `${index * 40}ms`,
                  }}
                />
              ))}
            </div>
            <span className='speech-input-feedback__label'>
              {isConnecting ? t('conversation.chat.speech.connectingShort') : formatSpeechDuration(recordingDurationMs)}
            </span>
          </div>
        )}
        {isProcessing ? (
          <Button
            type='text'
            size='small'
            shape='circle'
            className='speech-input-button speech-input-button--processing'
            disabled
            aria-label={ariaLabel}
            icon={icon}
          />
        ) : (
          <Tooltip content={ariaLabel} position='top'>
            <Button
              type='text'
              size='small'
              shape='circle'
              className={`speech-input-button ${isRecording ? 'speech-input-button--listening' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                activeSpeechInputOwner = ownerIdRef.current;
                handleClick();
              }}
              aria-label={ariaLabel}
              icon={icon}
            />
          </Tooltip>
        )}
      </div>
    </>
  );
};

export default SpeechInputButton;
