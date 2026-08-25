/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Typography } from '@arco-design/web-react';
import classNames from 'classnames';
import type { RuntimeDiagnostics } from '@/common/types/platform/electron';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../settingsViewContext';

declare const __APP_VERSION__: string;

const AboutModalContent: React.FC = () => {
  const { t } = useTranslation();
  const isPageMode = useSettingsViewMode() === 'page';
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(null);

  useEffect(() => {
    let active = true;
    const getRuntimeDiagnostics = window.electronAPI?.getRuntimeDiagnostics;
    if (!getRuntimeDiagnostics) return () => undefined;

    void getRuntimeDiagnostics()
      .then((diagnostics) => {
        if (active) setRuntimeDiagnostics(diagnostics);
      })
      .catch(() => {
        if (active) setRuntimeDiagnostics(null);
      });

    return () => {
      active = false;
    };
  }, []);

  const unavailable = t('settings.runtimeDiagnosticsUnavailable');
  const diagnosticRows = runtimeDiagnostics
    ? [
        [t('settings.runtimeDiagnosticsBuildChannel'), runtimeDiagnostics.buildChannel],
        [t('settings.runtimeDiagnosticsCommit'), runtimeDiagnostics.buildCommit ?? unavailable],
        [t('settings.runtimeDiagnosticsCoreVersion'), runtimeDiagnostics.coreVersion ?? unavailable],
        [t('settings.runtimeDiagnosticsDataDir'), runtimeDiagnostics.dataDir],
      ]
    : [];

  return (
    <div className='flex h-full w-full flex-col'>
      <div
        className={classNames(
          'min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-24px',
          isPageMode && 'overflow-visible px-0'
        )}
      >
        <div className='mx-auto flex max-w-500px flex-col'>
          <div className='flex flex-col items-center pb-24px'>
            <Typography.Title heading={3} className='mb-8px text-24px font-bold text-t-primary'>
              GEAUi
            </Typography.Title>
            <Typography.Text className='mb-12px text-center text-14px text-t-secondary'>
              {t('settings.appDescription')}
            </Typography.Text>
            <span className='rd-6px bg-fill-2 px-10px py-4px text-13px font-500 text-t-primary'>
              v{__APP_VERSION__}
            </span>
          </div>

          {runtimeDiagnostics && (
            <div
              className='rd-8px border border-[var(--color-border-2)] bg-fill-1 p-16px'
              data-testid='runtime-diagnostics'
            >
              <Typography.Text className='mb-12px block text-14px font-500 text-t-primary'>
                {t('settings.runtimeDiagnosticsTitle')}
              </Typography.Text>
              <div className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-16px gap-y-10px'>
                {diagnosticRows.map(([label, value]) => (
                  <React.Fragment key={label}>
                    <Typography.Text className='text-13px text-t-secondary'>{label}</Typography.Text>
                    <Typography.Text className='min-w-0 break-all text-13px text-t-primary'>{value}</Typography.Text>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          <div
            className='mt-16px flex min-h-96px items-center justify-center border-t border-[var(--color-border-2)]'
            data-testid='gea-remote-services-placeholder'
          >
            <Typography.Text className='text-13px text-t-tertiary'>
              GEA · {t('settings.channels.comingSoon', { defaultValue: '即将上线' })}
            </Typography.Text>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutModalContent;
