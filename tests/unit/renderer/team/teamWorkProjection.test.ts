import { describe, expect, it } from 'vitest';
import type { ITeamWorkEvent, ITeamWorkSnapshot, ITeamWorkTask } from '@/common/types/team/teamTypes';
import { applyTeamWorkEvent } from '@/renderer/pages/team/control-board/teamWorkProjection';

const task = (version: number, status: ITeamWorkTask['status'] = 'ready'): ITeamWorkTask => ({
  id: 'task-1',
  team_id: 'team-1',
  subject: 'Task',
  acceptance_criteria: [],
  status,
  priority: 'normal',
  next_action_owner: 'agent',
  blocked_by: [],
  blocks: [],
  artifact_refs: [],
  approval_state: 'none',
  exclusive_workspace: false,
  version,
  created_at: 1,
  updated_at: version,
});

const snapshot: ITeamWorkSnapshot = {
  team_id: 'team-1',
  sequence: 4,
  generated_at: 4,
  tasks: [task(1)],
  runs: [],
  attention: [],
};

const event = (sequence: number, version = 2): ITeamWorkEvent => ({
  sequence,
  event_id: `event-${sequence}`,
  team_id: 'team-1',
  task_id: 'task-1',
  name: 'team.workTaskChanged',
  task_version: version,
  payload: { task: task(version, 'running'), run: null, attention: null },
  created_at: sequence,
});

describe('Team Work ordered projection', () => {
  it('applies the next event once', () => {
    const applied = applyTeamWorkEvent(snapshot, event(5));
    expect(applied.kind).toBe('applied');
    expect(applied.snapshot.sequence).toBe(5);
    expect(applied.snapshot.tasks[0].status).toBe('running');
    expect(applyTeamWorkEvent(applied.snapshot, event(5)).kind).toBe('ignored');
  });

  it('requires reconciliation for gaps, out of order state, or malformed payloads', () => {
    expect(applyTeamWorkEvent(snapshot, event(7)).kind).toBe('reconcile');
    expect(applyTeamWorkEvent({ ...snapshot, tasks: [task(4)] }, event(5, 2)).kind).toBe('reconcile');
    expect(applyTeamWorkEvent(snapshot, { ...event(5), payload: null }).kind).toBe('reconcile');
  });

  it('ignores another team without mutating the snapshot', () => {
    const result = applyTeamWorkEvent(snapshot, { ...event(5), team_id: 'team-2' });
    expect(result.kind).toBe('ignored');
    expect(result.snapshot).toBe(snapshot);
  });
});
