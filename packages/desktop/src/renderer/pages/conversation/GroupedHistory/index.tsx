/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import AionModal from '@/renderer/components/base/AionModal';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useCronJobsMap } from '@/renderer/pages/cron';
import { restrictToVerticalAxis } from '@/renderer/utils/ui/dndModifiers';
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
import { useBatchSelection } from './hooks/useBatchSelection';
import { useConversationActions } from './hooks/useConversationActions';
import { useConversations } from './hooks/useConversations';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import type { ConversationRowProps, WorkspaceGroupedHistoryProps } from './types';
import { getProjectConversations } from './utils/groupingHelpers';

type ConversationListProps = {
  conversations: TChatConversation[];
  getConversationRowProps: (conversation: TChatConversation) => ConversationRowProps;
  dimIcon?: boolean;
};

const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  getConversationRowProps,
  dimIcon = false,
}) => {
  return (
    <div className='min-w-0'>
      {conversations.map((conversation) => (
        <ConversationRow key={conversation.id} {...getConversationRowProps(conversation)} dimIcon={dimIcon} />
      ))}
    </div>
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
  } = useConversations();

  const SectionLabel = useCallback(
    ({ sectionKey, label }: { sectionKey: string; label: string }) => {
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

  const { sensors, handleDragEnd, isDragEnabled } = useDragAndDrop({
    pinnedConversations,
    batchMode,
    collapsed,
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

  // Project identity comes from the conversation workspace metadata. This keeps
  // the sidebar aligned with the backend conversation list and avoids a second
  // local project registry that can drift or create empty projects.
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
            conversations: item.workspaceGroup.conversations,
          });
        }
      }
    }
    return groups;
  }, [timelineSections]);

  const standaloneConversations = useMemo(
    () =>
      timelineSections.flatMap((section) =>
        section.items.flatMap((item) => (item.type === 'conversation' && item.conversation ? [item.conversation] : []))
      ),
    [timelineSections]
  );

  const pinnedIds = useMemo(() => pinnedConversations.map((conversation) => conversation.id), [pinnedConversations]);

  const showEmptyState = timelineSections.length === 0 && pinnedConversations.length === 0;

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

      {/* Removing a project deletes the conversations that currently define it. */}
      <AionModal
        visible={removeProjectTarget !== null}
        variant='standard'
        className='!w-440px'
        alignCenter
        maskClosable={!removeProjectLoading}
        escToExit={!removeProjectLoading}
        header={{
          title: t('conversation.history.removeProjectTitle'),
          showClose: true,
        }}
        onCancel={handleRemoveProjectCancel}
        footer={{
          divider: true,
          render: () => (
            <div className='flex justify-end gap-10px'>
              <Button
                className='!h-36px !min-w-88px !rd-8px'
                disabled={removeProjectLoading}
                onClick={handleRemoveProjectCancel}
              >
                {t('conversation.history.cancelDelete')}
              </Button>
              <Button
                type='primary'
                status='danger'
                className='!h-36px !min-w-88px !rd-8px'
                loading={removeProjectLoading}
                onClick={() => void handleRemoveProjectConfirm()}
              >
                {t('conversation.history.confirmDelete')}
              </Button>
            </div>
          ),
        }}
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
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis]}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
                  <div className='min-w-0'>
                    {pinnedConversations.map((conversation) =>
                      isDragEnabled ? (
                        <SortableConversationRow key={conversation.id} {...getConversationRowProps(conversation)} />
                      ) : (
                        <ConversationRow key={conversation.id} {...getConversationRowProps(conversation)} />
                      )
                    )}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        )}

        {/* Slot 由父级（Sider）填入：例如 Team / CronJob sections，位于「置顶」之后、「项目」之前 */}
        {afterPinnedContent}

        {/* L1: Projects section — projects are derived from conversation workspaces. */}
        {projectGroups.length > 0 && (
          <div className='min-w-0'>
            {!collapsed && <SectionLabel sectionKey='projects' label={t('conversation.history.projectsSection')} />}
            {!collapsedSections.has('projects') &&
              projectGroups.map((group) => {
                const projectMenu = (
                  <Menu
                    onClickMenuItem={(key) => {
                      if (key === 'remove') {
                        handleRemoveProject(group.displayName, getProjectConversations(conversations, group.workspace));
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
                        />
                      </div>
                    </WorkspaceCollapse>
                  </div>
                );
              })}
          </div>
        )}

        {/* L1: Conversations section — peer to projects, internally split by timeline */}
        {standaloneConversations.length > 0 && (
          <div className='min-w-0'>
            {!collapsed && (
              <SectionLabel sectionKey='conversations' label={t('conversation.history.conversationsSection')} />
            )}
            {!collapsedSections.has('conversations') && (
              <ConversationList
                conversations={standaloneConversations}
                getConversationRowProps={getConversationRowProps}
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
