import { describe, expect, it } from 'vitest';
import type { ITeamWorkCommandEnvelope, ITeamWorkSnapshot } from '@/common/types/team/teamTypes';

describe('Team Work contract', () => {
  it('keeps commands tagged and snapshot state explicit', () => {
    const command = {
      expected_version: 3,
      idempotency_key: 'claim-1',
      actor: { kind: 'agent', id: 'agent-a' },
      command: {
        kind: 'claim',
        payload: {
          slot_id: 'agent-a',
          agent_backend: 'aionrs',
          lease_duration_ms: 30_000,
        },
      },
    } satisfies ITeamWorkCommandEnvelope;
    const snapshot = {
      team_id: 'team-1',
      sequence: 9,
      generated_at: 1_000,
      tasks: [],
      runs: [],
      attention: [],
    } satisfies ITeamWorkSnapshot;

    expect(command.command.kind).toBe('claim');
    expect(snapshot.sequence).toBe(9);
  });
});
