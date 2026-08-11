/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useLocalFilePreview } from '@/renderer/pages/conversation/Preview/hooks/useLocalFilePreview';
import { ipcBridge } from '@/common';
import { useMessageList } from '@/renderer/pages/conversation/Messages/hooks';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import type { TMessage } from '@/common/chat/chatLib';
import { ConversationRecords } from '@/common/adapter/conversationRecords';
import type { ConversationRecord, ConversationRecordEvent } from '@/common/types/conversationRecord';
import { iconColors } from '@/renderer/styles/colors';
import { loadAllConversationMessagesPaged } from '@/renderer/utils/chat/messagePagination';
import { Button, Popover, Tag, Tooltip, Typography } from '@arco-design/web-react';
import { ApplicationMenu, Attention, CheckOne, Earth, FileText, Pic, Send } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import styles from './ConversationResources.module.css';
import {
  collectConversationResources,
  conversationResourcesSlotId,
  isImageResource,
  type ConversationResourceItem,
} from './model';

const ResourceIcon: React.FC<{ item: ConversationResourceItem }> = ({ item }) =>
  item.kind === 'url' ? (
    <Earth size={16} fill={iconColors.secondary} />
  ) : isImageResource(item.path) ? (
    <Pic size={16} fill={iconColors.secondary} />
  ) : (
    <FileText size={16} fill={iconColors.secondary} />
  );

const resourceLocation = (item: ConversationResourceItem): string => (item.kind === 'url' ? item.url : item.path);

type ConversationFactItem = {
  id: string;
  title: string;
  description?: string;
  status: 'danger' | 'neutral' | 'success' | 'warning';
  resource?: ConversationResourceItem;
};

const recordResource = (record: ConversationRecord): ConversationResourceItem | undefined => {
  if (!('resource' in record)) return undefined;
  return record.resource.kind === 'url' || /^https?:\/\//i.test(record.resource.uri)
    ? { kind: 'url', url: record.resource.uri, name: record.resource.name }
    : { kind: 'file', path: record.resource.uri, name: record.resource.name };
};

const recordFacts = (records: ConversationRecord[]) => ({
  sources: records
    .filter((record) => record.record_type === 'context_evidence')
    .flatMap((record) => {
      const resource = recordResource(record);
      return resource ? [resource] : [];
    }),
  outputs: records
    .filter((record) => record.record_type === 'output')
    .flatMap((record) => {
      const resource = recordResource(record);
      return resource ? [resource] : [];
    }),
  deliverables: records
    .filter((record) => record.record_type === 'deliverable_revision')
    .map<ConversationFactItem>((record) => ({
      id: record.id,
      title: record.resource.name,
      description: `${record.status} · r${record.revision}`,
      status: record.status === 'ready' ? 'success' : record.status === 'withdrawn' ? 'danger' : 'neutral',
      resource: recordResource(record),
    })),
  receipts: records
    .filter(
      (record) =>
        record.record_type === 'external_result' ||
        record.record_type === 'verification_evidence' ||
        record.record_type === 'completion_receipt'
    )
    .map<ConversationFactItem>((record) => {
      if (record.record_type === 'external_result') {
        return {
          id: record.id,
          title: record.system,
          description: record.reference,
          status: record.outcome === 'success' ? 'success' : record.outcome === 'failure' ? 'danger' : 'warning',
        };
      }
      if (record.record_type === 'verification_evidence') {
        return {
          id: record.id,
          title: record.summary,
          status: record.outcome === 'pass' ? 'success' : record.outcome === 'fail' ? 'danger' : 'warning',
        };
      }
      return {
        id: record.id,
        title: record.definition,
        description: record.owner,
        status: record.status === 'verified' ? 'success' : 'danger',
      };
    }),
});

const ResourceSection: React.FC<{
  title: string;
  emptyText: string;
  items: ConversationResourceItem[];
  testId: string;
  onOpen: (item: ConversationResourceItem) => void;
}> = ({ title, emptyText, items, testId, onOpen }) => {
  return (
    <section className='flex min-h-0 flex-col gap-4px'>
      <div className='h-28px flex items-center px-4px text-13px font-500 text-t-secondary'>{title}</div>
      <div className='max-h-170px min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain' data-testid={testId}>
        {items.map((item) => (
          <Button
            key={`${item.kind}:${resourceLocation(item)}`}
            type='text'
            long
            className={`${styles.resourceButton} !h-34px !px-4px !text-t-primary hover:!bg-2 active:!bg-3`}
            icon={<ResourceIcon item={item} />}
            onClick={() => onOpen(item)}
            title={resourceLocation(item)}
          >
            <span className='min-w-0 flex-1 truncate text-left text-13px'>{item.name}</span>
          </Button>
        ))}
      </div>
      {items.length === 0 && <div className='px-6px py-5px text-13px text-t-tertiary'>{emptyText}</div>}
    </section>
  );
};

const FactSection: React.FC<{
  title: string;
  items: ConversationFactItem[];
  onOpen: (item: ConversationResourceItem) => void;
}> = ({ title, items, onOpen }) => {
  if (items.length === 0) return null;
  return (
    <section className='flex min-h-0 flex-col gap-4px'>
      <div className='h-28px flex items-center px-4px text-13px font-500 text-t-secondary'>{title}</div>
      <div className='max-h-170px min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain'>
        {items.map((item) => {
          const icon =
            item.status === 'success' ? (
              <CheckOne size={16} />
            ) : item.status === 'warning' ? (
              <Attention size={16} />
            ) : item.status === 'danger' ? (
              <Attention size={16} />
            ) : (
              <Send size={16} />
            );
          return item.resource ? (
            <Button
              key={item.id}
              type='text'
              long
              className={`${styles.resourceButton} !h-auto !min-h-34px !px-4px !py-5px !text-t-primary hover:!bg-2`}
              icon={icon}
              onClick={() => onOpen(item.resource!)}
            >
              <span className='min-w-0 flex-1 text-left'>
                <Typography.Text className='block truncate text-13px'>{item.title}</Typography.Text>
                {item.description ? (
                  <Typography.Text className='block truncate text-12px text-t-tertiary'>
                    {item.description}
                  </Typography.Text>
                ) : null}
              </span>
            </Button>
          ) : (
            <div key={item.id} className='min-h-34px px-4px py-5px flex items-start gap-8px text-t-primary'>
              <span className='mt-2px shrink-0'>{icon}</span>
              <span className='min-w-0'>
                <Typography.Text className='block text-13px'>{item.title}</Typography.Text>
                {item.description ? (
                  <Typography.Text className='block text-12px text-t-tertiary'>{item.description}</Typography.Text>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export const ConversationResourcesButton: React.FC<{
  outputs: ConversationResourceItem[];
  sources: ConversationResourceItem[];
  deliverables?: ConversationFactItem[];
  receipts?: ConversationFactItem[];
  inferred?: boolean;
  onOpen: (item: ConversationResourceItem) => void;
  onRequestOpen?: () => void;
}> = ({ outputs, sources, deliverables = [], receipts = [], inferred = false, onOpen, onRequestOpen }) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  const handleOpen = (item: ConversationResourceItem) => {
    setVisible(false);
    onOpen(item);
  };

  const content = (
    <div
      className='w-300px max-w-[calc(100vw-24px)] flex flex-col gap-8px px-8px py-10px'
      data-testid='conversation-resources-panel'
    >
      <div className='flex items-center justify-between px-4px'>
        <Typography.Text className='text-13px font-600 text-t-primary'>
          {t('conversation.resources.inspector')}
        </Typography.Text>
        {inferred ? <Tag size='small'>{t('conversation.resources.inferred')}</Tag> : null}
      </div>
      <FactSection title={t('conversation.resources.deliverables')} items={deliverables} onOpen={handleOpen} />
      <FactSection title={t('conversation.resources.receipts')} items={receipts} onOpen={handleOpen} />
      <ResourceSection
        title={t('conversation.resources.outputs')}
        emptyText={t('conversation.resources.emptyOutputs')}
        items={outputs}
        testId='conversation-resources-outputs-list'
        onOpen={handleOpen}
      />
      <div className='mx-4px border-t border-[var(--bg-3)]' />
      <ResourceSection
        title={t('conversation.resources.sources')}
        emptyText={t('conversation.resources.emptySources')}
        items={sources}
        testId='conversation-resources-sources-list'
        onOpen={handleOpen}
      />
    </div>
  );

  return (
    <Tooltip content={t('conversation.resources.tooltip')}>
      <Popover
        trigger='click'
        position='br'
        popupVisible={visible}
        onVisibleChange={(nextVisible) => {
          setVisible(nextVisible);
          if (nextVisible) onRequestOpen?.();
        }}
        content={content}
        triggerProps={{ showArrow: false }}
        unmountOnExit
        className={styles.popover}
      >
        <Button
          type='text'
          size='mini'
          shape='circle'
          aria-label={t('conversation.resources.tooltip')}
          className='!h-28px !w-28px !min-w-28px !p-0 !text-t-secondary hover:!bg-2 active:!bg-3'
          icon={<ApplicationMenu size={17} fill={iconColors.secondary} />}
          data-testid='conversation-resources-trigger'
        />
      </Popover>
    </Tooltip>
  );
};

const ConversationResourcesPortal: React.FC<{ conversationId: string; workspace?: string }> = ({
  conversationId,
  workspace,
}) => {
  const messages = useMessageList();
  const openLocalFile = useLocalFilePreview(workspace);
  const { openBrowserTab } = usePreviewContext();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [historyMessages, setHistoryMessages] = useState<TMessage[] | null>(null);
  const [recordMode, setRecordMode] = useState<'legacy' | 'loading' | 'structured'>('loading');
  const [records, setRecords] = useState<ConversationRecord[]>([]);
  const loadingConversationRef = useRef<string | undefined>(undefined);
  const resourceMessages = useMemo(
    () => (historyMessages ? [...historyMessages, ...messages] : messages),
    [historyMessages, messages]
  );
  const inferredResources = useMemo(
    () => collectConversationResources(resourceMessages, workspace),
    [resourceMessages, workspace]
  );
  const structured = useMemo(() => recordFacts(records), [records]);
  const resources = recordMode === 'legacy' ? inferredResources : structured;

  useEffect(() => {
    const targetId = conversationResourcesSlotId(conversationId);
    const syncTarget = () => {
      const nextTarget = document.getElementById(targetId);
      setTarget((current) => (current === nextTarget ? current : nextTarget));
    };
    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['id'] });
    return () => observer.disconnect();
  }, [conversationId]);

  useEffect(() => {
    let alive = true;
    const projection = new ConversationRecords();
    setRecordMode('loading');
    setRecords([]);

    const refresh = () =>
      ipcBridge.conversationRecords.get
        .invoke({ conversation_id: conversationId })
        .then((snapshot) => {
          if (!alive) return;
          const next = projection.replaceSnapshot(snapshot);
          setRecords(next.records);
          setRecordMode('structured');
        })
        .catch(() => {
          if (alive) setRecordMode('legacy');
        });
    void refresh();
    const off = ipcBridge.conversationRecords.changed.on((event: ConversationRecordEvent) => {
      if (!alive || event.conversation_id !== conversationId) return;
      const result = projection.apply(event);
      if (result.status === 'gap') void refresh();
      else {
        setRecords(result.snapshot.records);
        setRecordMode('structured');
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [conversationId]);

  useEffect(() => {
    setHistoryMessages(null);
    loadingConversationRef.current = undefined;
  }, [conversationId]);

  const loadHistory = useCallback(() => {
    if (historyMessages || loadingConversationRef.current === conversationId) return;
    loadingConversationRef.current = conversationId;
    void loadAllConversationMessagesPaged(conversationId, { contentMode: 'compact' })
      .then((loadedMessages) => {
        if (loadingConversationRef.current === conversationId) setHistoryMessages(loadedMessages);
      })
      .catch((error) => {
        console.error('[ConversationResources] Failed to load complete conversation history:', error);
      })
      .finally(() => {
        if (loadingConversationRef.current === conversationId) loadingConversationRef.current = undefined;
      });
  }, [conversationId, historyMessages]);

  if (!target) return null;
  return createPortal(
    <ConversationResourcesButton
      outputs={resources.outputs}
      sources={resources.sources}
      deliverables={recordMode === 'structured' ? structured.deliverables : []}
      receipts={recordMode === 'structured' ? structured.receipts : []}
      inferred={recordMode === 'legacy'}
      onOpen={(item) => (item.kind === 'url' ? openBrowserTab(item.url) : void openLocalFile(item.path))}
      onRequestOpen={recordMode === 'legacy' ? loadHistory : undefined}
    />,
    target
  );
};

export default ConversationResourcesPortal;
