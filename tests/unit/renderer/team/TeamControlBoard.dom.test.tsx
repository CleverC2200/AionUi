import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ITeamWorkSnapshot, TTeam } from '@/common/types/team/teamTypes';

const fixtures = vi.hoisted(() => ({
  refresh: vi.fn(),
  snapshot: {
    team_id: 'team-1',
    sequence: 17,
    generated_at: 100,
    tasks: [
      {
        id: 'task-running',
        team_id: 'team-1',
        subject: 'Build feature',
        acceptance_criteria: ['tests pass'],
        status: 'running',
        priority: 'high',
        owner_slot_id: 'agent-a',
        next_action_owner: 'agent',
        blocked_by: [],
        blocks: ['task-queued'],
        current_run_id: 'run-1',
        lease: { holder: 'agent-a', expires_at: 10_000, heartbeat_at: 90 },
        progress_summary: 'Implementation in progress',
        artifact_refs: [],
        approval_state: 'not_required',
        exclusive_workspace: true,
        workspace_key: 'worktree-a',
        version: 4,
        created_at: 1,
        updated_at: 90,
      },
      {
        id: 'task-queued',
        team_id: 'team-1',
        subject: 'Queued follow-up',
        acceptance_criteria: [],
        status: 'claimed',
        priority: 'normal',
        owner_slot_id: 'agent-b',
        next_action_owner: 'system',
        blocked_by: [],
        blocks: [],
        current_run_id: 'run-2',
        artifact_refs: [],
        approval_state: 'not_required',
        queue_reason: 'team_capacity',
        exclusive_workspace: false,
        version: 2,
        created_at: 2,
        updated_at: 91,
      },
    ],
    runs: [
      {
        id: 'run-1',
        team_id: 'team-1',
        task_id: 'task-running',
        attempt: 1,
        slot_id: 'agent-a',
        agent_backend: 'aionrs',
        status: 'running',
        queued_at: 10,
        started_at: 20,
        heartbeat_at: 90,
        verification_receipt: {
          checks: [{ command: 'cargo test', result: 'passed', passed: true }],
          artifacts: ['artifact://build'],
          remaining_risks: ['manual rollout'],
        },
      },
      {
        id: 'run-2',
        team_id: 'team-1',
        task_id: 'task-queued',
        attempt: 1,
        slot_id: 'agent-b',
        agent_backend: 'aionrs',
        status: 'queued',
        queued_at: 30,
      },
    ],
    attention: [],
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/renderer/pages/team/control-board/useTeamWorkSnapshot', () => ({
  useTeamWorkSnapshot: () => ({
    snapshot: fixtures.snapshot as ITeamWorkSnapshot,
    error: undefined,
    isLoading: false,
    isRefreshing: false,
    refresh: fixtures.refresh,
  }),
}));

vi.mock('@/renderer/pages/team/activity/TeamActivityView', () => ({
  default: () => <div data-testid='activity-view' />,
}));

vi.mock('@/common', () => ({
  ipcBridge: { team: { applyWorkCommand: { invoke: vi.fn() } } },
}));

vi.mock('@icon-park/react', () => ({ Refresh: () => <span /> }));

vi.mock('@arco-design/web-react', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  const Box = ({ children, title, ...props }: React.PropsWithChildren<{ title?: React.ReactNode }>) =>
    ReactModule.createElement('div', props, title, children);
  const Button = ({ children, onClick, ...props }: React.PropsWithChildren<{ onClick?: () => void }>) =>
    ReactModule.createElement('button', { ...props, onClick }, children);
  const Tabs = ({ children }: React.PropsWithChildren) => ReactModule.createElement('div', null, children);
  Tabs.TabPane = ({ children }: React.PropsWithChildren) => ReactModule.createElement('section', null, children);
  return {
    Alert: Box,
    Button,
    Card: Box,
    Drawer: ({ children, visible }: React.PropsWithChildren<{ visible?: boolean }>) =>
      visible ? ReactModule.createElement('aside', null, children) : null,
    Empty: Box,
    Input: { TextArea: (props: object) => ReactModule.createElement('textarea', props) },
    Message: { success: vi.fn(), error: vi.fn() },
    Spin: Box,
    Tabs,
    Tag: Box,
  };
});

import TeamControlBoard from '@/renderer/pages/team/control-board/TeamControlBoard';

const team: TTeam = {
  id: 'team-1',
  user_id: 'user-1',
  name: 'Test team',
  workspace: '/tmp/team-1',
  workspace_mode: 'isolated',
  leader_assistant_id: 'lead',
  assistants: [],
  created_at: 1,
  updated_at: 1,
};

describe('TeamControlBoard', () => {
  it('projects snapshot metrics, capacity queue state, attempts and receipts', () => {
    render(<TeamControlBoard team={team} />);

    expect(screen.getByTestId('team-control-board')).toBeInTheDocument();
    expect(screen.getAllByText('Build feature').length).toBeGreaterThan(0);
    expect(screen.getAllByText('team.controlBoard.queueReason.team_capacity').length).toBeGreaterThan(0);
    expect(screen.getByText('team.controlBoard.metrics.queued')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Build feature/ })[0]);

    expect(screen.getByTestId('team-work-task-drawer')).toBeInTheDocument();
    expect(screen.getByText('artifact://build')).toBeInTheDocument();
    expect(screen.getByText(/manual rollout/)).toBeInTheDocument();
  });
});
