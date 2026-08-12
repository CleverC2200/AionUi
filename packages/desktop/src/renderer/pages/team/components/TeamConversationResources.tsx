import { ipcBridge } from '@/common';
import { ConversationRecords } from '@/common/adapter/conversationRecords';
import type { ConversationRecord, ConversationRecordEvent } from '@/common/types/conversationRecord';
import type { TeamAssistant } from '@/common/types/team/teamTypes';
import { useLocalFilePreview } from '@/renderer/pages/conversation/Preview/hooks/useLocalFilePreview';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import {
  buildConversationRecordFacts,
  ConversationResourcesButton,
} from '@/renderer/pages/conversation/components/ConversationResources';
import { conversationResourcesSlotId } from '@/renderer/pages/conversation/components/ConversationResources/model';
import { Button, Tag } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

type TeamResourceMember = Pick<TeamAssistant, 'assistant_name' | 'conversation_id' | 'slot_id'>;
type RecordsByConversation = Record<string, ConversationRecord[]>;

export const selectTeamConversationRecords = (
  recordsByConversation: RecordsByConversation,
  members: TeamResourceMember[],
  selectedSlotId: string | null
): ConversationRecord[] =>
  members
    .filter((member) => !selectedSlotId || member.slot_id === selectedSlotId)
    .flatMap((member) => recordsByConversation[member.conversation_id] ?? []);

const TeamConversationResources: React.FC<{
  members: TeamResourceMember[];
  activeSlotId?: string;
  activeConversationId?: string;
  workspace?: string;
}> = ({ members, activeSlotId, activeConversationId, workspace }) => {
  const { t } = useTranslation();
  const openLocalFile = useLocalFilePreview(workspace);
  const { openBrowserTab } = usePreviewContext();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(activeSlotId ?? null);
  const [recordsByConversation, setRecordsByConversation] = useState<RecordsByConversation>({});
  const memberKey = members.map((member) => `${member.slot_id}:${member.conversation_id}`).join('|');

  useEffect(() => {
    setSelectedSlotId(activeSlotId ?? null);
  }, [activeSlotId]);

  useEffect(() => {
    if (!activeConversationId) {
      setTarget(null);
      return;
    }
    const targetId = conversationResourcesSlotId(activeConversationId);
    const syncTarget = () => {
      const nextTarget = document.getElementById(targetId);
      setTarget((current) => (current === nextTarget ? current : nextTarget));
    };
    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['id'] });
    return () => observer.disconnect();
  }, [activeConversationId]);

  useEffect(() => {
    let alive = true;
    const memberConversationIds = new Set(members.map((member) => member.conversation_id).filter(Boolean));
    const projections = new Map<string, ConversationRecords>();

    setRecordsByConversation((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([conversationId]) => memberConversationIds.has(conversationId))
      )
    );

    const refresh = async (conversationId: string) => {
      try {
        const snapshot = await ipcBridge.conversationRecords.get.invoke({ conversation_id: conversationId });
        if (!alive) return;
        const projection = projections.get(conversationId) ?? new ConversationRecords();
        projections.set(conversationId, projection);
        const next = projection.replaceSnapshot(snapshot);
        setRecordsByConversation((current) => ({ ...current, [conversationId]: next.records }));
      } catch {
        // Keep the last-good projection. A reconnect or the next record event
        // will retry against the AionCore authoritative snapshot.
      }
    };

    for (const conversationId of memberConversationIds) void refresh(conversationId);

    const offChanged = ipcBridge.conversationRecords.changed.on((event: ConversationRecordEvent) => {
      if (!alive || !memberConversationIds.has(event.conversation_id)) return;
      const projection = projections.get(event.conversation_id);
      if (!projection) {
        void refresh(event.conversation_id);
        return;
      }
      const result = projection.apply(event);
      if (result.status === 'gap' || result.status === 'invalid') {
        void refresh(event.conversation_id);
        return;
      }
      setRecordsByConversation((current) => ({
        ...current,
        [event.conversation_id]: result.snapshot.records,
      }));
    });
    const offReconnected = ipcBridge.realtime.reconnected.on(() => {
      for (const conversationId of memberConversationIds) void refresh(conversationId);
    });

    return () => {
      alive = false;
      offChanged();
      offReconnected();
    };
  }, [memberKey]);

  const records = useMemo(
    () => selectTeamConversationRecords(recordsByConversation, members, selectedSlotId),
    [members, recordsByConversation, selectedSlotId]
  );
  const facts = useMemo(() => buildConversationRecordFacts(records), [records]);
  const selectedMember = members.find((member) => member.slot_id === selectedSlotId);

  if (!target) return null;
  return createPortal(
    <ConversationResourcesButton
      outputs={facts.outputs}
      sources={facts.sources}
      deliverables={facts.deliverables}
      receipts={facts.receipts}
      onOpen={(item) => (item.kind === 'url' ? openBrowserTab(item.url) : void openLocalFile(item.path))}
      scopeControls={
        <div className='flex flex-col gap-6px rounded-8px bg-fill-1 px-6px py-6px' data-testid='team-resource-scope'>
          <div className='flex flex-wrap gap-4px'>
            <Button
              size='mini'
              type={selectedSlotId ? 'text' : 'primary'}
              onClick={() => setSelectedSlotId(null)}
              data-testid='team-resource-filter-all'
            >
              {t('team.resources.allMembers')}
            </Button>
            {members.map((member) => (
              <Button
                key={member.slot_id}
                size='mini'
                type={member.slot_id === selectedSlotId ? 'primary' : 'text'}
                onClick={() => setSelectedSlotId(member.slot_id)}
                data-testid={`team-resource-filter-${member.slot_id}`}
              >
                {member.assistant_name}
              </Button>
            ))}
          </div>
          {selectedMember ? (
            <Tag closable onClose={() => setSelectedSlotId(null)} data-testid='team-resource-active-filter'>
              {t('team.resources.filteredBy', { name: selectedMember.assistant_name })}
            </Tag>
          ) : null}
        </div>
      }
    />,
    target
  );
};

export default TeamConversationResources;
