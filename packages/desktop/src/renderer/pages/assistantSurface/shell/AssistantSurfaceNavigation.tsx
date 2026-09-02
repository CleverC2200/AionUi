import { Badge, Menu } from '@arco-design/web-react';
import { Data, Remind } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { fetchActiveNotifications, notificationInboxKey } from '@/renderer/services/notificationInbox';
import {
  BUSINESS_ASSISTANT_GROUPS,
  BUSINESS_ASSISTANT_SURFACES,
  isAssistantSurfaceAvailable,
  type AssistantSurfaceId,
  type BusinessAssistantIcon,
} from '../registry';
import styles from './AssistantSurfaceNavigation.module.css';

const NavigationIcon: React.FC<{ icon: BusinessAssistantIcon; size?: number }> = ({ size = 16 }) => {
  const props = { theme: 'outline' as const, size, strokeWidth: 3 };
  return <Data {...props} />;
};

const AssistantSurfaceNavigation: React.FC<{
  surfaceId: Exclude<AssistantSurfaceId, 'general'>;
  collapsed: boolean;
}> = ({ surfaceId, collapsed }) => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { status, user } = useAuth();
  const { data: notifications } = useSWR(
    status === 'authenticated' && user ? notificationInboxKey(user.id) : null,
    () => fetchActiveNotifications()
  );
  const unreadCount = notifications?.items.filter((item) => item.status === 'unread').length ?? 0;
  const messageInboxSelected = pathname.endsWith('/messages');
  const activeSurface = BUSINESS_ASSISTANT_SURFACES.find((surface) => surface.id === surfaceId);
  const activeGroupId = activeSurface?.businessMenu.groupId;
  const [openKeys, setOpenKeys] = useState<string[]>(() => BUSINESS_ASSISTANT_GROUPS.map((group) => group.id));

  useEffect(() => {
    if (!activeGroupId) return;
    setOpenKeys((current) => (current.includes(activeGroupId) ? current : [...current, activeGroupId]));
  }, [activeGroupId]);

  const groups = useMemo(
    () =>
      BUSINESS_ASSISTANT_GROUPS.map((group) => ({
        definition: group,
        surfaces: BUSINESS_ASSISTANT_SURFACES.filter((surface) => surface.businessMenu.groupId === group.id),
      })).filter((group) => group.surfaces.length > 0),
    []
  );

  return (
    <nav
      className={styles.root}
      data-collapsed={collapsed}
      data-testid='assistant-surface-navigation'
      aria-label={t('common.assistantSurface.navigation.label', { defaultValue: '业务 Agent 菜单' })}
    >
      <div className={styles.sectionLabel} aria-hidden='true'>
        {t('common.assistantSurface.navigation.businessFeatures', { defaultValue: '业务功能' })}
      </div>
      <Menu
        className={styles.menu}
        mode='vertical'
        collapse={collapsed}
        selectedKeys={[messageInboxSelected ? 'messages' : surfaceId]}
        openKeys={openKeys}
        autoOpen
        onClickSubMenu={(_key, nextOpenKeys) => setOpenKeys(nextOpenKeys)}
        onClickMenuItem={(key) => {
          if (key === 'messages') {
            void navigate(`/assistant-surface/${surfaceId}/messages`);
            return;
          }
          const surface = BUSINESS_ASSISTANT_SURFACES.find((candidate) => candidate.id === key);
          if (surface && isAssistantSurfaceAvailable(surface)) void navigate(surface.route);
        }}
      >
        <Menu.Item key='messages' data-testid='assistant-surface-navigation-messages'>
          <span className={styles.sharedToolRow}>
            <Remind theme='outline' size={16} strokeWidth={3} />
            <span className={styles.agentName}>
              {t('common.assistantSurface.messages.title', { defaultValue: '消息待办' })}
            </span>
            {unreadCount > 0 ? (
              <Badge
                className={styles.badge}
                count={unreadCount}
                maxCount={99}
                data-testid='business-message-unread-count'
              />
            ) : null}
          </span>
        </Menu.Item>
        {groups.map((group) => {
          const groupLabel = t(`common.${group.definition.labelKey}`, {
            defaultValue: group.definition.labelFallback,
          });
          return (
            <Menu.SubMenu
              key={group.definition.id}
              selectable={false}
              title={
                <span
                  className={styles.groupTitle}
                  data-testid={`assistant-surface-navigation-group-${group.definition.id}`}
                >
                  <NavigationIcon icon={group.definition.icon} />
                  <span>{groupLabel}</span>
                </span>
              }
            >
              {group.surfaces.map((surface) => {
                const name = t(`common.${surface.nameKey}`, { defaultValue: surface.nameFallback });
                const description = t(`common.${surface.descriptionKey}`, {
                  defaultValue: surface.descriptionFallback,
                });
                return (
                  <Menu.Item
                    key={surface.id}
                    disabled={!isAssistantSurfaceAvailable(surface)}
                    data-testid={`assistant-surface-navigation-${surface.id}`}
                    aria-label={`${name}：${description}`}
                  >
                    <span className={styles.agentRow}>
                      <span className={styles.agentName}>{name}</span>
                      {surface.businessMenu.badge ? (
                        <Badge className={styles.badge} count={surface.businessMenu.badge} maxCount={99} />
                      ) : null}
                    </span>
                  </Menu.Item>
                );
              })}
            </Menu.SubMenu>
          );
        })}
      </Menu>
    </nav>
  );
};

export default AssistantSurfaceNavigation;
