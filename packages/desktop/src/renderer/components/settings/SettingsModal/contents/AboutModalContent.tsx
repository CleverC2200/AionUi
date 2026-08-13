/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Typography } from '@arco-design/web-react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../settingsViewContext';

declare const __APP_VERSION__: string;

const AboutModalContent: React.FC = () => {
  const { t } = useTranslation();
  const isPageMode = useSettingsViewMode() === 'page';

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
