import { ConversationRecords } from '@/common/adapter/conversationRecords';
import { conversationRecordSnapshot } from '../../fixtures/conversationRecords';
import { describe, expect, it } from 'vitest';

describe('ConversationRecords', () => {
  it('replays duplicate and ordered events deterministically', () => {
    const records = new ConversationRecords();
    records.replaceSnapshot(conversationRecordSnapshot);
    const event = {
      sequence: 3,
      conversation_id: 'conversation-1',
      type: 'upsert' as const,
      record: {
        id: 'verification-1',
        revision: 1,
        record_type: 'verification_evidence' as const,
        conversation_id: 'conversation-1',
        turn_id: 'turn-1',
        producer: { type: 'aioncore' as const, id: 'aioncore' },
        created_at: '2026-08-12T00:01:00.000Z',
        outcome: 'pass' as const,
        summary: 'Business record verified',
        evidence_record_ids: ['evidence-1'],
      },
    };

    expect(records.apply(event)).toMatchObject({ status: 'applied', snapshot: { revision: 3 } });
    expect(records.apply(event)).toMatchObject({ status: 'duplicate', snapshot: { revision: 3 } });
    expect(records.current().records).toHaveLength(3);
  });

  it('does not apply a gap and requests an authoritative snapshot rebuild', () => {
    const records = new ConversationRecords();
    records.replaceSnapshot(conversationRecordSnapshot);
    expect(
      records.apply({ sequence: 5, conversation_id: 'conversation-1', type: 'remove', record_id: 'evidence-1' })
    ).toEqual({
      status: 'gap',
      snapshot: conversationRecordSnapshot,
      expected_sequence: 3,
      received_sequence: 5,
    });
    expect(records.current()).toEqual(conversationRecordSnapshot);
  });

  it('keeps the newer record revision when an older update arrives in sequence', () => {
    const records = new ConversationRecords();
    records.replaceSnapshot({
      revision: 1,
      records: [{ ...conversationRecordSnapshot.records[0], revision: 3 }],
    });
    records.apply({
      sequence: 2,
      conversation_id: 'conversation-1',
      type: 'upsert',
      record: {
        ...conversationRecordSnapshot.records[0],
        revision: 2,
        resource: { kind: 'url', uri: 'https://old.test', name: 'Old' },
      },
    });
    expect(records.current().records[0]).toMatchObject({ revision: 3, resource: { name: 'Source system record' } });
  });

  it('rejects completion claims without evidence and secret-bearing records', () => {
    const records = new ConversationRecords();
    expect(() =>
      records.replaceSnapshot({
        revision: 1,
        records: [
          {
            id: 'receipt-1',
            revision: 1,
            record_type: 'completion_receipt',
            conversation_id: 'conversation-1',
            producer: { type: 'agent', id: 'agent-1' },
            created_at: '2026-08-12T00:00:00.000Z',
            definition: 'Done',
            owner: 'agent-1',
            status: 'verified',
            evidence_record_ids: [],
          },
        ],
      })
    ).toThrow('CONVERSATION_RECORD_INVALID');
    expect(() => records.replaceSnapshot({ revision: 1, records: [], api_token: 'secret' })).toThrow(
      'CONVERSATION_RECORD_SENSITIVE_FIELD'
    );
  });

  it('rejects verified receipts whose evidence is missing or not a passing verification record', () => {
    const records = new ConversationRecords();
    expect(() =>
      records.replaceSnapshot({
        revision: 1,
        records: [
          {
            id: 'receipt-1',
            revision: 1,
            record_type: 'completion_receipt',
            conversation_id: 'conversation-1',
            producer: { type: 'agent', id: 'agent-1' },
            created_at: '2026-08-12T00:00:00.000Z',
            definition: 'Done',
            owner: 'agent-1',
            status: 'verified',
            evidence_record_ids: ['missing-verification'],
          },
        ],
      })
    ).toThrow('CONVERSATION_RECORD_INVALID:receipt evidence missing-verification');
  });

  it('rejects verification records without concrete evidence or with circular verification references', () => {
    const records = new ConversationRecords();
    expect(() =>
      records.replaceSnapshot({
        revision: 1,
        records: [
          {
            id: 'verification-1',
            revision: 1,
            record_type: 'verification_evidence',
            conversation_id: 'conversation-1',
            producer: { type: 'aioncore', id: 'aioncore' },
            created_at: '2026-08-12T00:00:00.000Z',
            outcome: 'pass',
            summary: 'No evidence supplied',
            evidence_record_ids: [],
          },
        ],
      })
    ).toThrow('CONVERSATION_RECORD_INVALID');

    expect(() =>
      records.replaceSnapshot({
        revision: 1,
        records: [
          {
            id: 'verification-1',
            revision: 1,
            record_type: 'verification_evidence',
            conversation_id: 'conversation-1',
            producer: { type: 'aioncore', id: 'aioncore' },
            created_at: '2026-08-12T00:00:00.000Z',
            outcome: 'pass',
            summary: 'Self-referencing evidence',
            evidence_record_ids: ['verification-1'],
          },
        ],
      })
    ).toThrow('CONVERSATION_RECORD_INVALID:dangling evidence verification-1');
  });
});
