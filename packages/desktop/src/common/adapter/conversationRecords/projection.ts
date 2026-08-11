import type { ConversationRecord, ConversationRecordSnapshot } from '../../types/conversationRecord';
import { parseConversationRecordEvent, parseConversationRecordSnapshot } from '../../types/conversationRecord';

export type ConversationRecordProjectionResult =
  | { status: 'applied' | 'duplicate'; snapshot: ConversationRecordSnapshot }
  | { status: 'gap'; snapshot: ConversationRecordSnapshot; expected_sequence: number; received_sequence: number };

export class ConversationRecords {
  private snapshot: ConversationRecordSnapshot = { revision: 0, records: [] };

  replaceSnapshot(value: unknown): ConversationRecordSnapshot {
    const snapshot = parseConversationRecordSnapshot(value);
    const byId = new Set<string>();
    for (const record of snapshot.records) {
      if (byId.has(record.id)) throw new Error(`CONVERSATION_RECORD_INVALID:duplicate record ${record.id}`);
      byId.add(record.id);
    }
    this.snapshot = snapshot;
    return this.current();
  }

  apply(value: unknown): ConversationRecordProjectionResult {
    const event = parseConversationRecordEvent(value);
    if (event.sequence <= this.snapshot.revision) return { status: 'duplicate', snapshot: this.current() };
    const expected = this.snapshot.revision + 1;
    if (event.sequence !== expected) {
      return {
        status: 'gap',
        snapshot: this.current(),
        expected_sequence: expected,
        received_sequence: event.sequence,
      };
    }

    const records = new Map(this.snapshot.records.map((record) => [record.id, record]));
    if (event.type === 'remove') records.delete(event.record_id);
    else this.upsert(records, event.record);
    this.snapshot = { revision: event.sequence, records: [...records.values()] };
    return { status: 'applied', snapshot: this.current() };
  }

  current(): ConversationRecordSnapshot {
    return { revision: this.snapshot.revision, records: [...this.snapshot.records] };
  }

  private upsert(records: Map<string, ConversationRecord>, record: ConversationRecord): void {
    const current = records.get(record.id);
    if (!current || record.revision >= current.revision) records.set(record.id, record);
  }
}
