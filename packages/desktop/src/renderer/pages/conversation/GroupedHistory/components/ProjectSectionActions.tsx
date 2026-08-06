/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import { Check, MoreOne, Plus } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { SidebarLayoutMode, SidebarSortMode } from '../utils/sidebarSorting';

type ProjectSectionActionsProps = {
  layoutMode: SidebarLayoutMode;
  sortMode: SidebarSortMode;
  onLayoutModeChange: (mode: SidebarLayoutMode) => void;
  onSortModeChange: (mode: SidebarSortMode) => void;
  onAddProject: () => void;
};

const SelectedMark = ({ selected }: { selected: boolean }) => (
  <span className='w-16px shrink-0 flex-center' aria-hidden='true'>
    {selected && <Check theme='outline' size='13' strokeWidth={3} />}
  </span>
);

const ProjectSectionActions: React.FC<ProjectSectionActionsProps> = ({
  layoutMode,
  sortMode,
  onLayoutModeChange,
  onSortModeChange,
  onAddProject,
}) => {
  const { t } = useTranslation();

  const menu = (
    <Menu
      className='min-w-210px'
      onClickMenuItem={(key) => {
        if (key === 'layout-projects' || key === 'layout-list') {
          onLayoutModeChange(key === 'layout-projects' ? 'projects' : 'list');
          return;
        }
        if (key === 'sort-priority' || key === 'sort-recent' || key === 'sort-manual') {
          onSortModeChange(key.replace('sort-', '') as SidebarSortMode);
        }
      }}
    >
      <div className='px-12px pt-6px pb-3px text-12px text-t-tertiary select-none'>
        {t('conversation.history.organizeSidebar')}
      </div>
      <Menu.Item key='layout-projects'>
        <span className='flex items-center gap-6px'>
          <SelectedMark selected={layoutMode === 'projects'} />
          {t('conversation.history.organizeByProject')}
        </span>
      </Menu.Item>
      <Menu.Item key='layout-list'>
        <span className='flex items-center gap-6px'>
          <SelectedMark selected={layoutMode === 'list'} />
          {t('conversation.history.organizeInOneList')}
        </span>
      </Menu.Item>
      <div className='mx-8px my-4px h-1px bg-border-2' />
      <div className='px-12px pt-3px pb-3px text-12px text-t-tertiary select-none'>
        {t('conversation.history.sortChatsBy')}
      </div>
      <Menu.Item key='sort-priority'>
        <Tooltip content={t('conversation.history.sortPriorityDescription')} position='right'>
          <span className='flex items-center gap-6px w-full'>
            <SelectedMark selected={sortMode === 'priority'} />
            {t('conversation.history.sortPriority')}
          </span>
        </Tooltip>
      </Menu.Item>
      <Menu.Item key='sort-recent'>
        <span className='flex items-center gap-6px'>
          <SelectedMark selected={sortMode === 'recent'} />
          {t('conversation.history.sortRecent')}
        </span>
      </Menu.Item>
      <Menu.Item key='sort-manual'>
        <span className='flex items-center gap-6px'>
          <SelectedMark selected={sortMode === 'manual'} />
          {t('conversation.history.sortManual')}
        </span>
      </Menu.Item>
    </Menu>
  );

  return (
    <div className='flex items-center gap-2px'>
      <Dropdown
        droplist={menu}
        trigger='click'
        position='br'
        getPopupContainer={() => document.body}
        unmountOnExit={false}
      >
        <Button
          type='text'
          size='mini'
          aria-label={t('conversation.history.projectManagement')}
          className='!size-24px !min-w-0 !p-0 !text-t-tertiary hover:!text-t-primary'
          icon={<MoreOne theme='outline' size='14' fill='currentColor' />}
        />
      </Dropdown>
      <Tooltip content={t('conversation.history.addProject')} position='top'>
        <Button
          type='text'
          size='mini'
          aria-label={t('conversation.history.addProject')}
          className='!size-24px !min-w-0 !p-0 !text-t-tertiary hover:!text-t-primary'
          icon={<Plus theme='outline' size='14' fill='currentColor' />}
          onClick={onAddProject}
        />
      </Tooltip>
    </div>
  );
};

export default ProjectSectionActions;
