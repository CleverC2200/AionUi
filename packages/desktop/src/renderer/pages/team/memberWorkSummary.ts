import type { ITeamWorkSnapshot, ITeamWorkTask } from '@/common/types/team/teamTypes';

export type TeamMemberWorkState =
  'attention' | 'blocked' | 'done' | 'idle' | 'review' | 'stale' | 'waiting' | 'working';
export type TeamMemberWorkSummary = {
  state: TeamMemberWorkState;
  count: number;
  focus?: string;
};

const stateRank: Record<TeamMemberWorkState, number> = {
  attention: 0,
  blocked: 1,
  stale: 2,
  working: 3,
  review: 4,
  waiting: 5,
  done: 6,
  idle: 7,
};

const taskState = (task: ITeamWorkTask, attentionTaskIds: Set<string>, now: number): TeamMemberWorkState => {
  if (attentionTaskIds.has(task.id) || task.status === 'needs_input' || task.status === 'needs_approval')
    return 'attention';
  if (task.status === 'blocked' || task.status === 'failed') return 'blocked';
  if (task.lease && task.lease.expires_at <= now && ['claimed', 'running'].includes(task.status)) return 'stale';
  if (task.status === 'running' || task.status === 'claimed') return 'working';
  if (task.status === 'in_review') return 'review';
  if (task.status === 'ready' || task.status === 'backlog' || task.queue_reason) return 'waiting';
  if (task.status === 'done') return 'done';
  return 'idle';
};

export const summarizeTeamMembers = (
  snapshot: ITeamWorkSnapshot | undefined,
  now = Date.now()
): Map<string, TeamMemberWorkSummary> => {
  const result = new Map<string, TeamMemberWorkSummary>();
  if (!snapshot) return result;
  const attentionTaskIds = new Set(snapshot.attention.map((item) => item.task_id));
  const bySlot = new Map<string, ITeamWorkTask[]>();
  for (const task of snapshot.tasks) {
    if (!task.owner_slot_id) continue;
    const tasks = bySlot.get(task.owner_slot_id) ?? [];
    tasks.push(task);
    bySlot.set(task.owner_slot_id, tasks);
  }
  for (const [slotId, tasks] of bySlot) {
    const ranked = tasks
      .map((task) => ({ task, state: taskState(task, attentionTaskIds, now) }))
      .toSorted((a, b) => stateRank[a.state] - stateRank[b.state] || b.task.updated_at - a.task.updated_at);
    const primary = ranked[0];
    result.set(slotId, {
      state: primary?.state ?? 'idle',
      count: tasks.filter((task) => !['cancelled', 'done'].includes(task.status)).length,
      focus: primary?.task.subject,
    });
  }
  return result;
};
