/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message, Modal, Tag } from '@arco-design/web-react';
import { PhoneCall, Voice, VoiceOff } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VoiceAgentState, VoiceConnectionState } from '@/common/types/voice';
import { useVoiceSession } from '@/renderer/hooks/voice/useVoiceSession';
import { getManagedVoiceCapability } from '@/renderer/services/voice/voiceCapability';
import styles from './VoiceConversation.module.css';

type VoiceConversationProps = {
  conversationId?: string;
  disabled?: boolean;
  iconSize?: number;
  iconStrokeWidth?: number;
  triggerClassName?: string;
  unavailableFallback?: React.ReactNode;
};

type VoiceVisualState = VoiceAgentState | 'connecting' | 'muted';

const getConnectionKey = (state: VoiceConnectionState): string => `conversation.chat.realtimeVoice.connection.${state}`;

const getAgentKey = (state: VoiceAgentState): string => `conversation.chat.realtimeVoice.agent.${state}`;

const VoiceConversation: React.FC<VoiceConversationProps> = ({
  conversationId,
  disabled,
  iconSize = 18,
  iconStrokeWidth,
  triggerClassName,
  unavailableFallback,
}) => {
  const { t } = useTranslation();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const { snapshot, setMicrophoneEnabled, start, stop } = useVoiceSession(conversationId);

  useEffect(() => {
    let cancelled = false;
    void getManagedVoiceCapability().then((capability) => {
      if (!cancelled) setAvailable(capability.enabled && capability.provider === 'volcengine-rtc');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleStart = async () => {
    setOpen(true);
    try {
      await start();
    } catch {
      Message.error(t('conversation.chat.realtimeVoice.startFailed'));
    }
  };

  const handleStop = async () => {
    try {
      await stop();
      setOpen(false);
    } catch {
      Message.error(t('conversation.chat.realtimeVoice.stopFailed'));
    }
  };

  if (!available) return <>{unavailableFallback}</>;

  const isConnecting = snapshot.connection === 'connecting';
  const isConnected = snapshot.connection === 'connected' || snapshot.connection === 'reconnecting';
  const visualState: VoiceVisualState = !snapshot.microphoneEnabled
    ? 'muted'
    : !isConnected
      ? 'connecting'
      : snapshot.agent;
  const triggerClasses = [styles.trigger, triggerClassName, isConnecting || isConnected ? styles.triggerActive : '']
    .filter(Boolean)
    .join(' ');
  const activityBars = Array.from({ length: 7 }, (_, index) => index);

  return (
    <>
      <button
        type='button'
        className={triggerClasses}
        disabled={disabled || isConnecting || isConnected}
        onClick={() => void handleStart()}
        aria-label={t('conversation.chat.realtimeVoice.startTooltip')}
        title={t('conversation.chat.realtimeVoice.startTooltip')}
        data-testid='realtime-voice-button'
      >
        <PhoneCall
          theme='outline'
          size={iconSize}
          fill='currentColor'
          strokeWidth={iconStrokeWidth}
          className={styles.triggerIcon}
        />
      </button>

      <Modal
        title={t('conversation.chat.realtimeVoice.title')}
        visible={open}
        footer={null}
        unmountOnExit
        maskClosable={false}
        onCancel={() => void handleStop()}
        className={styles.modal}
      >
        <div className={styles.content}>
          <div
            className={styles.visualizer}
            data-state={visualState}
            data-testid='voice-activity-visualizer'
            aria-hidden='true'
          >
            <span className={styles.visualizerRing} />
            <div className={styles.visualizerCore}>
              {visualState === 'muted' ? <VoiceOff size='24' /> : <Voice size='24' />}
            </div>
            <div className={styles.visualizerWaveform}>
              {activityBars.map((bar) => (
                <span
                  key={bar}
                  className={styles.visualizerBar}
                  style={{ '--voice-bar-index': bar } as React.CSSProperties}
                />
              ))}
            </div>
          </div>

          <div className={styles.statusRow}>
            <Tag>{t(getConnectionKey(snapshot.connection))}</Tag>
            <Tag color='arcoblue'>{t(getAgentKey(snapshot.agent))}</Tag>
          </div>

          <section className={styles.transcript} aria-live='polite'>
            <div>
              <span className={styles.speaker}>{t('conversation.chat.realtimeVoice.you')}</span>
              <p>{snapshot.userTranscript || t('conversation.chat.realtimeVoice.waitingForSpeech')}</p>
            </div>
            <div>
              <span className={styles.speaker}>{t('conversation.chat.realtimeVoice.ai')}</span>
              <p>{snapshot.agentTranscript || t('conversation.chat.realtimeVoice.waitingForReply')}</p>
            </div>
          </section>

          {snapshot.connection === 'error' && (
            <div className={styles.error} role='alert'>
              {t('conversation.chat.realtimeVoice.sessionError')}
              {snapshot.errorCode ? ` (${snapshot.errorCode})` : ''}
            </div>
          )}

          <div className={styles.actions}>
            <Button
              disabled={!isConnected}
              onClick={() => void setMicrophoneEnabled(!snapshot.microphoneEnabled)}
              icon={snapshot.microphoneEnabled ? <VoiceOff /> : <Voice />}
            >
              {snapshot.microphoneEnabled
                ? t('conversation.chat.realtimeVoice.mute')
                : t('conversation.chat.realtimeVoice.unmute')}
            </Button>
            <Button type='primary' status='danger' onClick={() => void handleStop()}>
              {t('conversation.chat.realtimeVoice.end')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default VoiceConversation;
