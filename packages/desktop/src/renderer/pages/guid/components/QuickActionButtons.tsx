/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { webui } from '@/common/adapter/ipcBridge';
import { Button } from '@arco-design/web-react';
import { Earth } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import styles from '../index.module.css';

type QuickActionButtonsProps = {
  inactiveBorderColor: string;
  activeShadow: string;
};

type WebuiQuickStatus = 'checking' | 'running' | 'stopped' | 'error';

const WEBUI_STATUS_CACHE_TTL_MS = 3000;
let webuiStatusCache: { quickStatus: WebuiQuickStatus; at: number } | null = null;

const QuickActionButtons: React.FC<QuickActionButtonsProps> = ({ inactiveBorderColor, activeShadow }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const [status, setStatus] = useState<WebuiQuickStatus>('checking');

  useEffect(() => {
    let alive = true;
    const loadStatus = async () => {
      const now = Date.now();
      if (webuiStatusCache && now - webuiStatusCache.at < WEBUI_STATUS_CACHE_TTL_MS) {
        setStatus(webuiStatusCache.quickStatus);
        return;
      }

      try {
        const result = await webui.getStatus.invoke();
        if (!alive) return;
        const nextStatus: WebuiQuickStatus = result ? (result.running ? 'running' : 'stopped') : 'error';
        setStatus(nextStatus);
        webuiStatusCache = { quickStatus: nextStatus, at: Date.now() };
      } catch {
        if (!alive) return;
        setStatus('error');
        webuiStatusCache = { quickStatus: 'error', at: Date.now() };
      }
    };

    void loadStatus();
    const unsubscribe = webui.statusChanged.on((payload) => {
      const nextStatus: WebuiQuickStatus = payload.running ? 'running' : 'stopped';
      setStatus(nextStatus);
      webuiStatusCache = { quickStatus: nextStatus, at: Date.now() };
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const openWebUI = useCallback(() => {
    void navigate('/settings/webui');
  }, [navigate]);

  const statusLabel =
    status === 'running'
      ? t('settings.webui.running', { defaultValue: 'Running' })
      : status === 'checking'
        ? t('settings.webui.starting', { defaultValue: 'Checking' })
        : status === 'error'
          ? t('settings.webui.operationFailed', { defaultValue: 'Unavailable' })
          : t('settings.webui.enable', { defaultValue: 'Start' });
  const iconColor =
    status === 'running'
      ? 'rgb(var(--success-6))'
      : status === 'checking'
        ? 'rgb(var(--primary-6))'
        : status === 'error'
          ? 'var(--color-text-3)'
          : 'var(--color-text-4)';

  return (
    <div
      className={`absolute left-50% flex -translate-x-1/2 flex-col items-center justify-center ${styles.guidQuickActions}`}
    >
      <Button
        type='text'
        className='group !inline-flex !h-36px !min-w-36px !max-w-36px !items-center !justify-center !overflow-hidden !whitespace-nowrap !rd-999px !border-solid !bg-fill-0 !px-0 transition-[max-width,padding,border-radius,box-shadow] duration-420 ease-in-out hover:!max-w-200px hover:!justify-start hover:!gap-8px hover:!px-14px'
        style={{
          borderWidth: '1px',
          borderColor: inactiveBorderColor,
          boxShadow: hovered ? activeShadow : 'none',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={openWebUI}
      >
        <span className='relative h-20px w-20px flex-shrink-0 leading-none'>
          <span className='absolute inset-0 flex items-center justify-center'>
            <Earth
              theme='outline'
              size={20}
              fill='currentColor'
              className='block transition-colors duration-360'
              style={{ color: iconColor }}
            />
          </span>
        </span>
        <span className='max-w-0 overflow-hidden text-14px text-[var(--color-text-2)] opacity-0 transition-all duration-360 ease-in-out group-hover:max-w-160px group-hover:opacity-100'>
          {t('settings.webui', { defaultValue: 'WebUI' })} · {statusLabel}
        </span>
      </Button>
    </div>
  );
};

export default QuickActionButtons;
