/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { SidebarTeamItem } from '@/common/types/sidebar';
import { emitter } from '@renderer/utils/emitter';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { cleanupSiderTooltips } from '@renderer/utils/ui/siderTooltip';
import { Message, Modal } from '@arco-design/web-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSWRConfig } from 'swr';

import { useSiderTeamBadges } from '@renderer/pages/team/hooks/useSiderTeamBadges';
import { useTeamList } from '@renderer/pages/team/hooks/useTeamList';
import { useSiderTeamRunning } from '@renderer/components/layout/Sider/useSiderTeamRunning';

export type TeamRowData = {
  team_id: string;
  name: string;
  pinned: boolean;
  selected: boolean;
  badgeCount: number;
  isRunning: boolean;
  onClick: () => void;
  onPin: () => void;
  onRename: () => void;
  onDelete: () => void;
};

type UseTeamRowsArgs = {
  /** Current route path, to derive per-row `selected`. */
  pathname: string;
  onSessionClick?: () => void;
  /** Older AionCore has team.list but not the grouped sidebar/order routes. */
  legacyMode?: boolean;
};

const LEGACY_TEAM_PINNED_KEY = 'team-pinned-ids';

/**
 * Team data + actions for the folded-in sidebar team rows. Grouping / order /
 * pinned state come from the sidebar read model (each `SidebarTeamItem`), but
 * badge counts and the running spinner still need the full `TTeam` (with
 * `assistants`), so `useTeamList` remains the data source, joined by `team_id`.
 *
 * `resolveTeamRow` turns a sidebar team item into the flat props `TeamRow`
 * needs; the rename modal state lives here as a single instance (mirroring the
 * conversation rename modal), exposed as `renameModal` for the caller to mount.
 */
export const useTeamRows = ({ pathname, onSessionClick, legacyMode = false }: UseTeamRowsArgs) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { teams, mutate: refreshTeams, removeTeam } = useTeamList();
  const teamBadgeCounts = useSiderTeamBadges(teams);
  const isTeamRunning = useSiderTeamRunning(teams);
  const { mutate: globalMutate } = useSWRConfig();

  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [legacyPinnedIds, setLegacyPinnedIds] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(LEGACY_TEAM_PINNED_KEY) ?? '[]') as unknown;
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });

  const handleTeamClick = useCallback(
    (team_id: string) => {
      cleanupSiderTooltips();
      blurActiveElement();
      Promise.resolve(navigate(`/team/${team_id}`)).catch(console.error);
      if (onSessionClick) onSessionClick();
    },
    [navigate, onSessionClick]
  );

  // Pin truth is the backend `user_order` row's existence (item_type='team');
  // toggling insert/deletes it (idempotent, no body) and a sidebar refresh
  // re-groups server-side. Mirrors the conversation `handleTogglePin`.
  const handleTogglePin = useCallback(
    async (team_id: string, pinned: boolean) => {
      if (legacyMode) {
        setLegacyPinnedIds((current) => {
          const next = pinned ? current.filter((id) => id !== team_id) : [...current, team_id];
          localStorage.setItem(LEGACY_TEAM_PINNED_KEY, JSON.stringify(next));
          return next;
        });
        return;
      }
      try {
        if (pinned) {
          await ipcBridge.order.pinned.delete.invoke({ item_type: 'team', item_id: team_id });
        } else {
          await ipcBridge.order.pinned.put.invoke({ item_type: 'team', item_id: team_id });
        }
        emitter.emit('chat.history.refresh');
      } catch (error) {
        console.error('Failed to toggle pin team:', error);
        Message.error(t('team.sider.pin'));
      }
    },
    [legacyMode, t]
  );

  const legacyTeamItems = useMemo<SidebarTeamItem[]>(() => {
    if (!legacyMode) return [];
    return teams
      .map((team) => ({
        team_id: team.id,
        name: team.name,
        updated_at: team.updated_at,
        pinned: legacyPinnedIds.includes(team.id),
        member_conversation_ids: team.assistants.map((assistant) => assistant.conversation_id).filter(Boolean),
      }))
      .toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at - a.updated_at);
  }, [legacyMode, legacyPinnedIds, teams]);

  const openRename = useCallback((team_id: string, name: string) => {
    setRenameId(team_id);
    setRenameName(name);
  }, []);

  const closeRename = useCallback(() => {
    setRenameId(null);
    setRenameName('');
  }, []);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameId || !renameName.trim()) return;
    setRenameLoading(true);
    try {
      await ipcBridge.team.renameTeam.invoke({ id: renameId, name: renameName.trim() });
      await refreshTeams();
      await globalMutate(`team/${renameId}`);
      Message.success(t('team.sider.renameSuccess'));
      closeRename();
    } catch (err) {
      console.error('Failed to rename team:', err);
      Message.error(t('team.sider.rename'));
    } finally {
      setRenameLoading(false);
    }
  }, [closeRename, globalMutate, refreshTeams, renameId, renameName, t]);

  const handleDelete = useCallback(
    (team_id: string) => {
      Modal.confirm({
        title: t('team.sider.deleteConfirm'),
        content: t('team.sider.deleteConfirmContent'),
        okText: t('team.sider.deleteOk'),
        cancelText: t('team.sider.deleteCancel'),
        okButtonProps: { status: 'warning' },
        onOk: async () => {
          await removeTeam(team_id);
          Message.success(t('team.sider.deleteSuccess'));
          if (window.location.hash.includes(`/team/${team_id}`)) {
            window.location.hash = '#/';
          }
        },
        style: { borderRadius: '12px' },
        alignCenter: true,
        getPopupContainer: () => document.body,
      });
    },
    [removeTeam, t]
  );

  const resolveTeamRow = useCallback(
    (item: SidebarTeamItem): TeamRowData => ({
      team_id: item.team_id,
      name: item.name,
      pinned: item.pinned,
      selected: pathname.startsWith(`/team/${item.team_id}`),
      badgeCount: teamBadgeCounts.get(item.team_id) ?? 0,
      isRunning: isTeamRunning(item.team_id),
      onClick: () => handleTeamClick(item.team_id),
      onPin: () => void handleTogglePin(item.team_id, item.pinned),
      onRename: () => openRename(item.team_id, item.name),
      onDelete: () => handleDelete(item.team_id),
    }),
    [pathname, teamBadgeCounts, isTeamRunning, handleTeamClick, handleTogglePin, openRename, handleDelete]
  );

  const renameModal = useMemo(
    () => ({
      visible: renameId !== null,
      name: renameName,
      loading: renameLoading,
      setName: setRenameName,
      confirm: (): void => {
        void handleRenameConfirm();
      },
      cancel: closeRename,
    }),
    [renameId, renameName, renameLoading, handleRenameConfirm, closeRename]
  );

  return { resolveTeamRow, renameModal, legacyTeamItems };
};
