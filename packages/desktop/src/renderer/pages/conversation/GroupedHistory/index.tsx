/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { ipcBridge } from '@/common';
import AionModal from '@/renderer/components/base/AionModal';
import { addRecentWorkspace } from '@/renderer/components/workspace';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useCronJobsMap } from '@/renderer/pages/cron';
import { restrictToVerticalAxis } from '@/renderer/utils/ui/dndModifiers';
import { getWorkspaceDisplayName } from '@/renderer/utils/workspace/workspace';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Dropdown, Empty, Input, Menu, Modal, Tooltip } from '@arco-design/web-react';
import { Delete, MoreOne, Plus, Right } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import WorkspaceCollapse from '../components/WorkspaceCollapse';
import ConversationRow from './ConversationRow';
import SortableConversationRow from './SortableConversationRow';
import ConversationDeleteModal from './components/ConversationDeleteModal';
import ProjectSectionActions from './components/ProjectSectionActions';
import { useBatchSelection } from './hooks/useBatchSelection';
import { useConversationActions } from './hooks/useConversationActions';
import { useConversations } from './hooks/useConversations';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useSidebarProjects } from './hooks/useSidebarProjects';
import type { ConversationRowProps, WorkspaceGroupedHistoryProps } from './types';
import { shouldShowSidebarEmptyState } from './utils/sidebarPresentation';
import { conversationNeedsAttention, sortSidebarConversations } from './utils/sidebarSorting';

type ConversationListProps = {
  conversations: TChatConversation[];
  getConversationRowProps: (conversation: TChatConversation) => ConversationRowProps;
  dimIcon?: boolean;
  reorderEnabled?: boolean;
  batchMode: boolean;
  collapsed: boolean;
};

const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  getConversationRowProps,
  dimIcon = false,
  reorderEnabled = false,
  batchMode,
  collapsed,
}) => {
  const { sensors, handleDragEnd, isDragEnabled } = useDragAndDrop({
    sortableConversations: conversations,
    batchMode,
    collapsed,
  });
  const canReorder = reorderEnabled && isDragEnabled;

  if (!canReorder) {
    return (
      <div className='min-w-0'>
        {conversations.map((conversation) => (
          <ConversationRow key={conversation.id} {...getConversationRowProps(conversation)} dimIcon={dimIcon} />
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={conversations.map((conversation) => conversation.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className='min-w-0'>
          {conversations.map((conversation) => (
            <SortableConversationRow
              key={conversation.id}
              {...getConversationRowProps(conversation)}
              dimIcon={dimIcon}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
};

const WorkspaceGroupedHistory: React.FC<WorkspaceGroupedHistoryProps> = ({
  onSessionClick,
  collapsed = false,
  tooltipEnabled = false,
  batchMode = false,
  onBatchModeChange,
  afterPinnedContent,
}) => {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const sidebarProjects = useSidebarProjects();
  const { getJobStatus, markAsRead, setActiveConversation } = useCronJobsMap();

  const {
    conversations,
    isConversationGenerating,
    hasCompletionUnread,
    expandedWorkspaces,
    pinnedConversations,
    timelineSections,
    handleToggleWorkspace,
    collapsedSections,
    toggleSection,
    layoutMode,
    sortMode,
    setLayoutMode,
    setSortMode,
  } = useConversations();

  const SectionLabel = useCallback(
    ({ sectionKey, label, trailing }: { sectionKey: string; label: string; trailing?: React.ReactNode }) => {
      const isCollapsed = collapsedSections.has(sectionKey);
      return (
        <div
          className='group/label sider-section-label flex items-center px-12px h-28px select-none sticky top-0 z-10 mt-8px cursor-pointer'
          onClick={() => toggleSection(sectionKey)}
        >
          <span className='text-14px text-t-tertiary sider-section-title group-hover/label:text-t-primary transition-colors font-[500] leading-none'>
            {label}
          </span>
          <span className='ml-2px flex items-center justify-center opacity-0 group-hover/label:opacity-100 transition-opacity text-t-tertiary shrink-0'>
            <Right
              theme='outline'
              size={12}
              className={classNames('transition-transform duration-150', { 'rotate-90': !isCollapsed })}
            />
          </span>
          {trailing && (
            <div className='ml-auto' onClick={(e) => e.stopPropagation()}>
              {trailing}
            </div>
          )}
        </div>
      );
    },
    [collapsedSections, toggleSection]
  );

  // Sync active conversation ref when route changes (for URL navigation)
  // This doesn't trigger state update, avoiding double render
  useEffect(() => {
    if (id) {
      setActiveConversation(id);
    }
  }, [id, setActiveConversation]);

  const {
    selectedConversationIds,
    setSelectedConversationIds,
    selectedCount,
    allSelected,
    toggleSelectedConversation,
    handleToggleSelectAll,
  } = useBatchSelection(batchMode, conversations);

  const {
    renameModalVisible,
    renameModalName,
    setRenameModalName,
    renameLoading,
    deleteConversationId,
    deleteConversationLoading,
    dropdownVisibleId,
    handleConversationClick,
    handleDeleteClick,
    handleDeleteCancel,
    handleDeleteConfirm,
    handleBatchDelete,
    handleEditStart,
    handleRenameConfirm,
    handleRenameCancel,
    handleTogglePin,
    handleMenuVisibleChange,
    handleOpenMenu,
    handleCreateCronTask,
    handleRemoveProject,
    removeProjectTarget,
    removeProjectLoading,
    handleRemoveProjectCancel,
    handleRemoveProjectConfirm,
  } = useConversationActions({
    batchMode,
    onSessionClick,
    onBatchModeChange,
    selectedConversationIds,
    setSelectedConversationIds,
    toggleSelectedConversation,
    markAsRead,
  });

  // Fork-lineage badge support: resolve a parent conversation's display name
  // from the already-loaded sidebar list (no extra fetch; unresolved = the
  // parent was deleted or not loaded → the badge falls back to a generic tip).
  const conversationNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const conversation of conversations) {
      map.set(conversation.id, conversation.name);
    }
    return map;
  }, [conversations]);
  const resolveConversationName = useCallback(
    (conversationId: string) => conversationNameById.get(conversationId),
    [conversationNameById]
  );

  const getConversationRowProps = useCallback(
    (conversation: TChatConversation): ConversationRowProps => ({
      conversation,
      isGenerating: isConversationGenerating(conversation.id),
      hasCompletionUnread: hasCompletionUnread(conversation.id),
      collapsed,
      tooltipEnabled,
      batchMode,
      checked: selectedConversationIds.has(conversation.id),
      selected: id === conversation.id,
      menuVisible: dropdownVisibleId !== null && dropdownVisibleId === conversation.id,
      onToggleChecked: toggleSelectedConversation,
      onConversationClick: handleConversationClick,
      onOpenMenu: handleOpenMenu,
      onMenuVisibleChange: handleMenuVisibleChange,
      onEditStart: handleEditStart,
      onCreateCronTask: handleCreateCronTask,
      onDelete: handleDeleteClick,
      onTogglePin: handleTogglePin,
      getJobStatus,
      resolveConversationName,
    }),
    [
      collapsed,
      tooltipEnabled,
      batchMode,
      isConversationGenerating,
      hasCompletionUnread,
      selectedConversationIds,
      id,
      dropdownVisibleId,
      toggleSelectedConversation,
      handleConversationClick,
      handleOpenMenu,
      handleMenuVisibleChange,
      handleEditStart,
      handleCreateCronTask,
      handleDeleteClick,
      handleTogglePin,
      getJobStatus,
      resolveConversationName,
    ]
  );

  const sortConversations = useCallback(
    (items: TChatConversation[]) =>
      sortSidebarConversations(items, sortMode, (conversation) =>
        conversationNeedsAttention(conversation, hasCompletionUnread)
      ),
    [hasCompletionUnread, sortMode]
  );

  // Codex-style split: project folders (workspaces) on top, free conversations below.
  // Projects section: collect all workspace groups across timeline sections, ordered by recency.
  const projectGroups = useMemo(() => {
    const seen = new Set<string>();
    const groups: Array<{ workspace: string; displayName: string; conversations: TChatConversation[] }> = [];
    for (const section of timelineSections) {
      for (const item of section.items) {
        if (item.type === 'workspace' && item.workspaceGroup && !seen.has(item.workspaceGroup.workspace)) {
          seen.add(item.workspaceGroup.workspace);
          groups.push({
            workspace: item.workspaceGroup.workspace,
            displayName: item.workspaceGroup.display_name,
            conversations: sortConversations(item.workspaceGroup.conversations),
          });
        }
      }
    }
    const emptyRecentGroups: Array<{
      workspace: string;
      displayName: string;
      conversations: TChatConversation[];
    }> = sidebarProjects
      .filter((workspace) => !seen.has(workspace))
      .map((workspace) => ({
        workspace,
        displayName: getWorkspaceDisplayName(workspace, false, t),
        conversations: [] as TChatConversation[],
      }));
    return [...emptyRecentGroups, ...groups];
  }, [sidebarProjects, sortConversations, t, timelineSections]);

  const standaloneConversations = useMemo(
    () =>
      sortConversations(
        timelineSections.flatMap((section) =>
          section.items.flatMap((item) =>
            item.type === 'conversation' && item.conversation ? [item.conversation] : []
          )
        )
      ),
    [sortConversations, timelineSections]
  );

  const flatConversations = useMemo(
    () => sortConversations([...projectGroups.flatMap((group) => group.conversations), ...standaloneConversations]),
    [projectGroups, sortConversations, standaloneConversations]
  );

  const showEmptyState = shouldShowSidebarEmptyState({
    layoutMode,
    pinnedCount: pinnedConversations.length,
    projectCount: projectGroups.length,
    projectConversationCount: projectGroups.reduce((count, group) => count + group.conversations.length, 0),
    standaloneCount: standaloneConversations.length,
  });

  const handleAddProject = useCallback(async () => {
    try {
      const directories = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory', 'createDirectory'] });
      const workspace = directories?.[0];
      if (!workspace) return;
      addRecentWorkspace(workspace);
      await navigate('/guid', { state: { workspace } });
      onSessionClick?.();
    } catch (error) {
      console.error('[WorkspaceGroupedHistory] Failed to add project:', error);
    }
  }, [navigate, onSessionClick]);

  return (
    <>
      <Modal
        title={t('conversation.history.renameTitle')}
        visible={renameModalVisible}
        onOk={handleRenameConfirm}
        onCancel={handleRenameCancel}
        okText={t('conversation.history.saveName')}
        cancelText={t('conversation.history.cancelEdit')}
        confirmLoading={renameLoading}
        okButtonProps={{ disabled: !renameModalName.trim() }}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
      >
        <Input
          autoFocus
          value={renameModalName}
          onChange={setRenameModalName}
          onPressEnter={handleRenameConfirm}
          placeholder={t('conversation.history.renamePlaceholder')}
          allowClear
        />
      </Modal>

      <ConversationDeleteModal
        visible={deleteConversationId !== null}
        loading={deleteConversationLoading}
        onCancel={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
      />

      {batchMode && !collapsed && (
        <div className='px-12px pb-8px pt-2px sticky top-0 z-20 bg-[var(--bg-2)]'>
          <div className='rd-8px bg-fill-1 p-10px flex flex-col gap-8px border border-solid border-[rgba(var(--primary-6),0.08)]'>
            <div className='text-12px leading-18px text-t-secondary'>
              {t('conversation.history.selectedCount', { count: selectedCount })}
            </div>
            <div className='grid grid-cols-2 gap-6px'>
              <Button
                className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                size='mini'
                type='secondary'
                onClick={handleToggleSelectAll}
              >
                {allSelected ? t('common.cancel') : t('conversation.history.selectAll')}
              </Button>
              <Button
                className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                size='mini'
                status='warning'
                onClick={handleBatchDelete}
              >
                {t('conversation.history.batchDelete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 移除项目确认弹窗 — 使用项目自家 AionModal + 圆角线框按钮（红色危险态） */}
      <AionModal
        visible={removeProjectTarget !== null}
        style={{ width: '400px' }}
        header={{
          title: t('conversation.history.removeProjectTitle'),
          showClose: true,
          style: { borderBottom: 'none' },
        }}
        onCancel={handleRemoveProjectCancel}
        footer={
          <div className='flex justify-end gap-12px pt-16px'>
            <button
              type='button'
              className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
              style={{
                border: '1px solid var(--color-border-2)',
                backgroundColor: 'var(--color-fill-2)',
                color: 'var(--color-text-1)',
                cursor: removeProjectLoading ? 'not-allowed' : 'pointer',
                opacity: removeProjectLoading ? 0.55 : 1,
              }}
              onMouseEnter={(event) => {
                if (!removeProjectLoading) event.currentTarget.style.backgroundColor = 'var(--color-fill-3)';
              }}
              onMouseLeave={(event) => {
                if (!removeProjectLoading) event.currentTarget.style.backgroundColor = 'var(--color-fill-2)';
              }}
              onClick={handleRemoveProjectCancel}
              disabled={removeProjectLoading}
            >
              {t('conversation.history.cancelDelete')}
            </button>
            <button
              type='button'
              className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
              style={{
                border: '1px solid rgb(var(--danger-6))',
                backgroundColor: 'transparent',
                color: 'rgb(var(--danger-6))',
                cursor: removeProjectLoading ? 'not-allowed' : 'pointer',
                opacity: removeProjectLoading ? 0.55 : 1,
              }}
              onMouseEnter={(event) => {
                if (!removeProjectLoading) {
                  event.currentTarget.style.backgroundColor = 'rgba(var(--danger-6), 0.08)';
                }
              }}
              onMouseLeave={(event) => {
                if (!removeProjectLoading) event.currentTarget.style.backgroundColor = 'transparent';
              }}
              onClick={() => void handleRemoveProjectConfirm()}
              disabled={removeProjectLoading}
            >
              {removeProjectLoading ? t('conversation.history.deleting') : t('conversation.history.confirmDelete')}
            </button>
          </div>
        }
      >
        <div className='text-14px leading-22px text-t-secondary'>
          {t('conversation.history.removeProjectConfirm', {
            name: removeProjectTarget?.name ?? '',
            count: removeProjectTarget?.conversations.length ?? 0,
          })}
        </div>
      </AionModal>

      <div>
        {/* L1: Pinned section */}
        {pinnedConversations.length > 0 && (
          <div className='min-w-0'>
            {!collapsed && <SectionLabel sectionKey='pinned' label={t('conversation.history.pinnedSection')} />}
            {!collapsedSections.has('pinned') && (
              <ConversationList
                conversations={pinnedConversations}
                getConversationRowProps={getConversationRowProps}
                reorderEnabled
                batchMode={batchMode}
                collapsed={collapsed}
              />
            )}
          </div>
        )}

        {/* Slot 由父级（Sider）填入：例如 Team / CronJob sections，位于「置顶」之后、「项目」之前 */}
        {afterPinnedContent}

        {/* L1: Projects section — the header also owns sidebar layout and chat sorting. */}
        <div className='min-w-0'>
          {!collapsed && (
            <SectionLabel
              sectionKey='projects'
              label={t('conversation.history.projectsSection')}
              trailing={
                !batchMode ? (
                  <ProjectSectionActions
                    layoutMode={layoutMode}
                    sortMode={sortMode}
                    onLayoutModeChange={setLayoutMode}
                    onSortModeChange={setSortMode}
                    onAddProject={() => void handleAddProject()}
                  />
                ) : undefined
              }
            />
          )}
          {!collapsedSections.has('projects') &&
            (layoutMode === 'list' ? (
              <ConversationList
                conversations={flatConversations}
                getConversationRowProps={getConversationRowProps}
                reorderEnabled={sortMode === 'manual'}
                batchMode={batchMode}
                collapsed={collapsed}
              />
            ) : (
              projectGroups.map((group) => {
                const projectMenu = (
                  <Menu
                    onClickMenuItem={(key) => {
                      if (key === 'remove') {
                        handleRemoveProject(group.displayName, group.workspace, group.conversations);
                      }
                    }}
                  >
                    <Menu.Item key='remove' className='!text-[rgb(var(--danger-6))]'>
                      <span className='flex items-center gap-8px'>
                        <Delete theme='outline' size='14' />
                        {t('conversation.history.removeProject')}
                      </span>
                    </Menu.Item>
                  </Menu>
                );
                return (
                  <div key={group.workspace} className='min-w-0'>
                    <WorkspaceCollapse
                      expanded={expandedWorkspaces.includes(group.workspace)}
                      onToggle={() => handleToggleWorkspace(group.workspace)}
                      siderCollapsed={collapsed}
                      stickyHeader
                      stickyTop={28}
                      header={
                        <span className='text-14px font-[500] truncate flex-1 text-t-primary min-w-0'>
                          {group.displayName}
                        </span>
                      }
                      trailing={
                        <span className='flex items-center gap-6px'>
                          <Tooltip content={t('conversation.history.newConversationInProject')} position='top'>
                            <Button
                              type='text'
                              size='mini'
                              aria-label={t('conversation.history.newConversationInProject')}
                              className={classNames(
                                '!size-20px !min-w-0 !p-0 !text-t-secondary hover:!text-t-primary',
                                isMobile ? 'flex' : 'hidden group-hover:flex'
                              )}
                              icon={<Plus theme='outline' size='14' fill='currentColor' />}
                              onClick={(e) => {
                                e.stopPropagation();
                                void navigate('/guid', { state: { workspace: group.workspace } });
                              }}
                            />
                          </Tooltip>
                          <Dropdown
                            droplist={projectMenu}
                            trigger='click'
                            position='br'
                            getPopupContainer={() => document.body}
                            unmountOnExit={false}
                          >
                            <Button
                              type='text'
                              size='mini'
                              aria-label={t('conversation.history.projectActions', { name: group.displayName })}
                              className={classNames(
                                '!size-20px !min-w-0 !p-0 !text-t-secondary hover:!text-t-primary',
                                isMobile ? 'flex' : 'hidden group-hover:flex'
                              )}
                              icon={<MoreOne theme='outline' size='14' fill='currentColor' />}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </Dropdown>
                        </span>
                      }
                    >
                      <div className={classNames('flex flex-col min-w-0', { 'mt-1px': !collapsed })}>
                        <ConversationList
                          conversations={group.conversations}
                          getConversationRowProps={getConversationRowProps}
                          dimIcon
                          reorderEnabled={sortMode === 'manual'}
                          batchMode={batchMode}
                          collapsed={collapsed}
                        />
                      </div>
                    </WorkspaceCollapse>
                    {group.conversations.length === 0 && !collapsed && (
                      <div className='pl-42px pr-10px pb-6px text-13px leading-20px text-t-tertiary'>
                        {t('conversation.history.noChatsInProject')}
                      </div>
                    )}
                  </div>
                );
              })
            ))}
        </div>

        {/* L1: Conversations section — peer to projects, internally split by timeline */}
        {layoutMode === 'projects' && standaloneConversations.length > 0 && (
          <div className='min-w-0'>
            {!collapsed && (
              <SectionLabel sectionKey='conversations' label={t('conversation.history.conversationsSection')} />
            )}
            {!collapsedSections.has('conversations') && (
              <ConversationList
                conversations={standaloneConversations}
                getConversationRowProps={getConversationRowProps}
                reorderEnabled={sortMode === 'manual'}
                batchMode={batchMode}
                collapsed={collapsed}
              />
            )}
          </div>
        )}

        {showEmptyState && (
          <div className='py-32px flex-center'>
            <Empty description={t('conversation.history.noHistory')} />
          </div>
        )}
      </div>
    </>
  );
};

export default WorkspaceGroupedHistory;
