import type {
  ITeamWorkAttentionItem,
  ITeamWorkEvent,
  ITeamWorkRun,
  ITeamWorkSnapshot,
  ITeamWorkTask,
} from '@/common/types/team/teamTypes';

type TeamWorkEventPayload = {
  task: ITeamWorkTask;
  run?: ITeamWorkRun | null;
  attention?: ITeamWorkAttentionItem | null;
};

export type TeamWorkProjectionResult =
  | { kind: 'applied'; snapshot: ITeamWorkSnapshot }
  | { kind: 'ignored'; snapshot: ITeamWorkSnapshot }
  | { kind: 'reconcile'; snapshot: ITeamWorkSnapshot };

function isPayload(value: unknown): value is TeamWorkEventPayload {
  if (!value || typeof value !== 'object') return false;
  const task = (value as { task?: unknown }).task;
  return Boolean(task && typeof task === 'object' && typeof (task as ITeamWorkTask).id === 'string');
}

export function applyTeamWorkEvent(snapshot: ITeamWorkSnapshot, event: ITeamWorkEvent): TeamWorkProjectionResult {
  if (event.team_id !== snapshot.team_id || event.sequence <= snapshot.sequence) {
    return { kind: 'ignored', snapshot };
  }
  if (event.sequence !== snapshot.sequence + 1 || !isPayload(event.payload)) {
    return { kind: 'reconcile', snapshot };
  }

  const payload = event.payload;
  const currentTask = snapshot.tasks.find((task) => task.id === payload.task.id);
  if (currentTask && payload.task.version < currentTask.version) {
    return { kind: 'reconcile', snapshot };
  }
  const tasks = currentTask
    ? snapshot.tasks.map((task) => (task.id === payload.task.id ? payload.task : task))
    : [...snapshot.tasks, payload.task];
  const runs = payload.run
    ? snapshot.runs.some((run) => run.id === payload.run!.id)
      ? snapshot.runs.map((run) => (run.id === payload.run!.id ? payload.run! : run))
      : [...snapshot.runs, payload.run]
    : snapshot.runs;
  const withoutTaskAttention = snapshot.attention.filter((item) => item.task_id !== payload.task.id);
  const attention = payload.attention ? [...withoutTaskAttention, payload.attention] : withoutTaskAttention;

  return {
    kind: 'applied',
    snapshot: {
      ...snapshot,
      sequence: event.sequence,
      generated_at: event.created_at,
      tasks,
      runs,
      attention,
    },
  };
}
