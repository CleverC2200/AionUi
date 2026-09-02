import { Alert, Button, Drawer, Tag } from '@arco-design/web-react';
import { IconClose } from '@arco-design/web-react/icon';
import { CheckOne, Data, Right, Robot } from '@icon-park/react';
import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import styles from './AssistantSurfaceSwitcher.module.css';
import {
  BUSINESS_ASSISTANT_SURFACES,
  DEFAULT_ASSISTANT_SURFACE,
  getAssistantSurfaceFromPath,
  isAssistantSurfaceAvailable,
} from '../registry';

type ProductMode = 'general' | 'business';

const LAST_BUSINESS_ROUTE_KEY = 'aionui:assistant-surface:last-business-route';

const availableBusinessSurfaces = () => BUSINESS_ASSISTANT_SURFACES.filter(isAssistantSurfaceAvailable);

const readLastBusinessRoute = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  const route = window.sessionStorage.getItem(LAST_BUSINESS_ROUTE_KEY);
  return availableBusinessSurfaces().some((surface) => surface.route === route) ? (route ?? undefined) : undefined;
};

const ModeIcon: React.FC<{ mode: ProductMode }> = ({ mode }) => (
  <span className={mode === 'business' ? styles.businessIcon : styles.generalIcon} aria-hidden='true'>
    {mode === 'business' ? <Data size={15} /> : <Robot size={15} />}
  </span>
);

const AssistantSurfaceSwitcher: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const drawerTitleId = useId();
  const activeSurface = getAssistantSurfaceFromPath(location.pathname);
  const activeMode: ProductMode = activeSurface.id === 'general' ? 'general' : 'business';
  const availableBusiness = availableBusinessSurfaces();
  const businessAvailable = availableBusiness.length > 0;
  const fixtureEnvironment = typeof window !== 'undefined' && window.__aionuiAssistantSurfaceFixtures === true;
  const businessRoute =
    activeMode === 'business'
      ? activeSurface.route
      : (readLastBusinessRoute() ?? availableBusiness[0]?.route ?? DEFAULT_ASSISTANT_SURFACE.route);
  const activeName =
    activeMode === 'business'
      ? t('common.assistantSurface.business.name', { defaultValue: 'GEA 业务版' })
      : t(`common.${DEFAULT_ASSISTANT_SURFACE.nameKey}`, { defaultValue: DEFAULT_ASSISTANT_SURFACE.nameFallback });

  useEffect(() => {
    if (activeMode !== 'business' || !isAssistantSurfaceAvailable(activeSurface)) return;
    window.sessionStorage.setItem(LAST_BUSINESS_ROUTE_KEY, activeSurface.route);
  }, [activeMode, activeSurface]);

  const selectMode = (mode: ProductMode) => {
    setVisible(false);
    void navigate(mode === 'business' ? businessRoute : DEFAULT_ASSISTANT_SURFACE.route);
  };

  return (
    <>
      <Button
        type='text'
        className='collapsed-hidden !h-32px !min-w-0 !justify-start !px-0 !text-16px !font-semibold !text-t-primary'
        aria-label={t('common.assistantSurface.open', { defaultValue: '切换工作模式' })}
        aria-haspopup='dialog'
        data-testid='assistant-surface-switcher'
        onClick={() => setVisible(true)}
      >
        <span className='min-w-0 truncate'>{activeName}</span>
        <Right className='ml-4px shrink-0 text-t-tertiary' size={12} />
      </Button>
      <Drawer
        wrapClassName={styles.titlebarSafeWrapper}
        className={styles.drawer}
        placement='left'
        width={368}
        title={<span id={drawerTitleId}>{t('common.assistantSurface.title', { defaultValue: '切换工作模式' })}</span>}
        visible={visible}
        footer={null}
        closable
        closeIcon={<IconClose />}
        escToExit
        focusLock
        autoFocus
        onCancel={() => setVisible(false)}
      >
        <div className={styles.dialogBody} role='dialog' aria-modal='true' aria-labelledby={drawerTitleId}>
          <p className={styles.description}>
            {t('common.assistantSurface.description', {
              defaultValue: '通用版保持现有界面；业务版在左侧菜单切换不同业务 Agent。',
            })}
          </p>
          <div className={styles.options} data-testid='assistant-surface-mode-options'>
            <Button
              type='text'
              long
              className={styles.option}
              data-active={activeMode === 'general'}
              aria-pressed={activeMode === 'general'}
              data-testid='assistant-surface-option-general'
              onClick={() => selectMode('general')}
            >
              <ModeIcon mode='general' />
              <span className={styles.optionCopy}>
                <span className={styles.optionTitle}>
                  {t(`common.${DEFAULT_ASSISTANT_SURFACE.nameKey}`, {
                    defaultValue: DEFAULT_ASSISTANT_SURFACE.nameFallback,
                  })}
                </span>
                <span className={styles.optionSummary}>
                  {t(`common.${DEFAULT_ASSISTANT_SURFACE.descriptionKey}`, {
                    defaultValue: DEFAULT_ASSISTANT_SURFACE.descriptionFallback,
                  })}
                </span>
              </span>
              <CheckOne
                className={activeMode === 'general' ? styles.optionCheck : styles.optionCheckHidden}
                size={17}
              />
            </Button>

            <Button
              type='text'
              long
              className={styles.option}
              data-active={activeMode === 'business'}
              aria-pressed={activeMode === 'business'}
              disabled={!businessAvailable}
              data-testid='assistant-surface-option-business'
              onClick={() => selectMode('business')}
            >
              <ModeIcon mode='business' />
              <span className={styles.optionCopy}>
                <span className={styles.optionTitleLine}>
                  <span className={styles.optionTitle}>
                    {t('common.assistantSurface.business.name', { defaultValue: 'GEA 业务版' })}
                  </span>
                  {businessAvailable ? (
                    <Tag size='small'>{t('common.assistantSurface.managed', { defaultValue: '企业受管' })}</Tag>
                  ) : (
                    <Tag size='small'>{t('common.assistantSurface.unavailable', { defaultValue: '待接入' })}</Tag>
                  )}
                </span>
                <span className={styles.optionSummary}>
                  {t('common.assistantSurface.business.description', {
                    defaultValue: '企业业务工作区；从左侧菜单切换 Agent。',
                  })}
                </span>
              </span>
              <CheckOne
                className={activeMode === 'business' ? styles.optionCheck : styles.optionCheckHidden}
                size={17}
              />
            </Button>
          </div>
          {fixtureEnvironment ? (
            <Alert
              className={styles.fixtureNotice}
              type='info'
              showIcon
              data-testid='assistant-surface-fixture-boundary'
              content={t('common.assistantSurface.fixtureBoundary', {
                defaultValue: 'Fixture 环境：不连接 GEA，不执行真实业务操作。',
              })}
            />
          ) : null}
        </div>
      </Drawer>
    </>
  );
};

export default AssistantSurfaceSwitcher;
