import type { ConversationRecordSnapshot } from '@/common/types/conversationRecord';

const base = {
  conversation_id: 'conversation-1',
  turn_id: 'turn-1',
  producer: { type: 'agent' as const, id: 'finance-agent' },
  created_at: '2026-08-12T00:00:00.000Z',
};

export const conversationRecordSnapshot: ConversationRecordSnapshot = {
  revision: 2,
  records: [
    {
      ...base,
      id: 'evidence-1',
      revision: 1,
      record_type: 'context_evidence',
      resource: { kind: 'url', uri: 'https://example.test/source', name: 'Source system record' },
    },
    {
      ...base,
      id: 'deliverable-1-v1',
      revision: 1,
      record_type: 'deliverable_revision',
      deliverable_id: 'deliverable-1',
      status: 'ready',
      resource: { kind: 'file', uri: '/workspace/report.xlsx', name: 'report.xlsx' },
    },
  ],
};
