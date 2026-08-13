import { summarizeTeamMembers } from '@/renderer/pages/team/memberWorkSummary';
import type { ITeamWorkSnapshot, ITeamWorkTask } from '@/common/types/team/teamTypes';
import { describe, expect, it } from 'vitest';

const task = (patch: Partial<ITeamWorkTask>): ITeamWorkTask => ({
  id: 'task-1',
  team_id: 'team-1',
  subject: 'Prepare report',
  acceptance_criteria: [],
  status: 'running',
  priority: 'normal',
  owner_slot_id: 'worker-slot',
  next_action_owner: 'agent',
  blocked_by: [],
  blocks: [],
  artifact_refs: [],
  approval_state: 'none',
  exclusive_workspace: false,
  version: 1,
  created_at: 1,
  updated_at: 2,
  ...patch,
});

const snapshot = (tasks: ITeamWorkTask[]): ITeamWorkSnapshot => ({
  team_id: 'team-1',
  sequence: 1,
  generated_at: 1,
  tasks,
  runs: [],
  attention: [],
});

describe('summarizeTeamMembers', () => {
  it('prioritizes human attention over background work', () => {
    const value = snapshot([
      task({ id: 'running', subject: 'Background work' }),
      task({ id: 'approval', subject: 'Approve release', status: 'needs_approval', updated_at: 3 }),
    ]);
    value.attention = [
      {
        task_id: 'approval',
        status: 'needs_approval',
        next_action_owner: 'human',
        reason: 'Review',
        allowed_actions: ['approve'],
        requested_at: 3,
      },
    ];
    expect(summarizeTeamMembers(value).get('worker-slot')).toEqual({
      state: 'attention',
      count: 2,
      focus: 'Approve release',
    });
  });

  it('shows an expired lease as stale instead of pretending the member is running', () => {
    const value = snapshot([task({ lease: { holder: 'worker-slot', heartbeat_at: 5, expires_at: 10 } })]);
    expect(summarizeTeamMembers(value, 11).get('worker-slot')?.state).toBe('stale');
  });

  it('does not create noise for unowned tasks or members without Team Work', () => {
    expect(summarizeTeamMembers(snapshot([task({ owner_slot_id: undefined })]))).toEqual(new Map());
  });
});
