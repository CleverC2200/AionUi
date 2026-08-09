import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Drawer, Empty, Input, Message, Spin, Tabs, Tag } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type {
  ITeamWorkCommandEnvelope,
  ITeamWorkCommandReceipt,
  ITeamWorkRun,
  ITeamWorkTask,
  TTeam,
  TeamWorkCommand,
  TeamWorkTaskStatus,
} from '@/common/types/team/teamTypes';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import TeamActivityView from '../activity/TeamActivityView';
import { useTeamWorkSnapshot } from './useTeamWorkSnapshot';

type Props = { team: TTeam };
type BoardLane = { key: string; statuses: TeamWorkTaskStatus[] };

const LANES: BoardLane[] = [
  { key: 'backlog', statuses: ['backlog'] },
  { key: 'ready', statuses: ['ready', 'claimed'] },
  { key: 'running', statuses: ['running'] },
  { key: 'attention', statuses: ['needs_input', 'needs_approval', 'blocked', 'failed'] },
  { key: 'review', statuses: ['in_review'] },
  { key: 'done', statuses: ['done', 'cancelled'] },
];

const statusColor = (status: TeamWorkTaskStatus) => {
  if (status === 'done') return 'green';
  if (status === 'running' || status === 'claimed') return 'arcoblue';
  if (status === 'failed' || status === 'cancelled') return 'red';
  if (status === 'needs_input' || status === 'needs_approval' || status === 'in_review') return 'orange';
  return 'gray';
};

const TeamControlBoard: React.FC<Props> = ({ team }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { snapshot, error, isLoading, isRefreshing, refresh } = useTeamWorkSnapshot(team.id);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<ITeamWorkCommandReceipt>();

  const selectedTask = snapshot?.tasks.find((task) => task.id === selectedTaskId);
  const taskRuns = useMemo(
    () =>
      snapshot?.runs.filter((run) => run.task_id === selectedTaskId).toSorted((a, b) => b.attempt - a.attempt) ?? [],
    [selectedTaskId, snapshot?.runs]
  );
  const attention = snapshot?.attention.find((item) => item.task_id === selectedTaskId);

  const sendHumanCommand = async (command: TeamWorkCommand) => {
    if (!selectedTask) return;
    setSubmitting(true);
    const envelope: ITeamWorkCommandEnvelope = {
      expected_version: selectedTask.version,
      idempotency_key: `human:${command.kind}:${selectedTask.id}:${selectedTask.version}`,
      actor: { kind: 'human', id: user?.id ?? 'local-user' },
      command,
    };
    try {
      const receipt = await ipcBridge.team.applyWorkCommand.invoke({
        team_id: team.id,
        task_id: selectedTask.id,
        envelope,
      });
      setLastReceipt(receipt);
      setReason('');
      await refresh();
      Message.success(t('team.controlBoard.receiptSuccess'));
    } catch {
      Message.error(t('team.controlBoard.actionFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const runHumanAction = (action: string) => {
    const text = reason.trim() || t('team.controlBoard.defaultReason');
    if (action === 'provide_input') return sendHumanCommand({ kind: 'provide_input', payload: { summary: text } });
    if (action === 'approve') return sendHumanCommand({ kind: 'approve', payload: { reason: text } });
    if (action === 'reject') return sendHumanCommand({ kind: 'reject', payload: { reason: text } });
    if (action === 'accept_review') return sendHumanCommand({ kind: 'accept_review', payload: { reason: text } });
    if (action === 'return_for_changes')
      return sendHumanCommand({ kind: 'return_for_changes', payload: { reason: text } });
    if (action === 'retry') {
      const previous = taskRuns[0];
      if (!previous) return;
      return sendHumanCommand({
        kind: 'reclaim',
        payload: {
          slot_id: previous.slot_id,
          agent_backend: previous.agent_backend,
          model: previous.model,
          lease_duration_ms: 30_000,
          resume_ref: previous.resume_ref,
        },
      });
    }
  };

  if (isLoading) {
    return (
      <div className='flex items-center justify-center h-full' data-testid='team-control-board-loading'>
        <Spin />
      </div>
    );
  }
  if (error || !snapshot) {
    return (
      <div className='p-16px' data-testid='team-control-board-error'>
        <Alert
          type='error'
          content={t('team.controlBoard.loadFailed')}
          action={<Button onClick={refresh}>{t('team.controlBoard.retry')}</Button>}
        />
      </div>
    );
  }

  const statusLabel = (status: TeamWorkTaskStatus) => t(`team.controlBoard.status.${status}`);
  const taskCard = (task: ITeamWorkTask) => {
    const run = task.current_run_id ? snapshot.runs.find((item) => item.id === task.current_run_id) : undefined;
    return (
      <Card key={task.id} size='small' className='mb-8px' data-testid={`team-work-task-${task.id}`}>
        <Button type='text' long onClick={() => setSelectedTaskId(task.id)} className='!h-auto !p-0 !text-left'>
          <div className='w-full min-w-0'>
            <div className='font-500 text-[color:var(--color-text-1)] truncate'>{task.subject}</div>
            <div className='flex flex-wrap items-center gap-4px mt-6px'>
              <Tag size='small' color={statusColor(task.status)}>
                {statusLabel(task.status)}
              </Tag>
              {task.owner_slot_id && <Tag size='small'>{task.owner_slot_id}</Tag>}
              {task.queue_reason && (
                <Tag size='small' color='purple'>
                  {t(`team.controlBoard.queueReason.${task.queue_reason}`)}
                </Tag>
              )}
              {run && <span className='text-11px text-[color:var(--color-text-3)]'>#{run.attempt}</span>}
            </div>
            <div className='text-11px text-[color:var(--color-text-3)] mt-6px truncate'>
              {t('team.controlBoard.nextAction')}: {t(`team.controlBoard.owner.${task.next_action_owner}`)}
            </div>
          </div>
        </Button>
      </Card>
    );
  };

  const overviewCards = [
    ['total', snapshot.tasks.length],
    [
      'running',
      snapshot.tasks.filter((task) => task.status === 'running' || (task.status === 'claimed' && task.lease)).length,
    ],
    ['queued', snapshot.tasks.filter((task) => Boolean(task.queue_reason)).length],
    ['attention', snapshot.attention.length],
    ['done', snapshot.tasks.filter((task) => task.status === 'done').length],
  ] as const;

  return (
    <div className='flex flex-col h-full min-h-0' data-testid='team-control-board'>
      <div className='flex items-center justify-between px-16px pt-10px'>
        <div>
          <div className='font-600 text-16px'>{t('team.controlBoard.title')}</div>
          <div className='text-11px text-[color:var(--color-text-3)]'>
            {t('team.controlBoard.sequence', { sequence: snapshot.sequence })}
          </div>
        </div>
        <Button icon={<Refresh />} loading={isRefreshing} onClick={refresh}>
          {t('team.controlBoard.refresh')}
        </Button>
      </div>
      <Tabs
        defaultActiveTab='overview'
        className='flex-1 min-h-0 [&_.arco-tabs-content]:h-full [&_.arco-tabs-pane]:h-full'
      >
        <Tabs.TabPane key='overview' title={t('team.controlBoard.tabs.overview')}>
          <div className='h-full overflow-auto p-16px'>
            <div className='grid grid-cols-2 lg:grid-cols-5 gap-12px'>
              {overviewCards.map(([key, count]) => (
                <Card key={key} size='small'>
                  <div className='text-12px text-[color:var(--color-text-3)]'>
                    {t(`team.controlBoard.metrics.${key}`)}
                  </div>
                  <div className='text-24px font-600 mt-4px'>{count}</div>
                </Card>
              ))}
            </div>
            <Card className='mt-12px' title={t('team.controlBoard.currentWork')}>
              {snapshot.tasks.filter((task) => ['claimed', 'running'].includes(task.status)).length ? (
                snapshot.tasks.filter((task) => ['claimed', 'running'].includes(task.status)).map(taskCard)
              ) : (
                <Empty description={t('team.controlBoard.noCurrentWork')} />
              )}
            </Card>
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane key='kanban' title={t('team.controlBoard.tabs.kanban')}>
          {snapshot.tasks.length ? (
            <div className='flex gap-12px h-full overflow-x-auto p-12px' data-testid='team-work-kanban'>
              {LANES.map((lane) => {
                const tasks = snapshot.tasks.filter((task) => lane.statuses.includes(task.status));
                return (
                  <div key={lane.key} className='w-260px shrink-0 rounded-8px bg-2 p-10px overflow-y-auto'>
                    <div className='flex justify-between mb-8px font-500'>
                      <span>{t(`team.controlBoard.lanes.${lane.key}`)}</span>
                      <Tag size='small'>{tasks.length}</Tag>
                    </div>
                    {tasks.map(taskCard)}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className='flex items-center justify-center h-full'>
              <Empty description={t('team.controlBoard.empty')} />
            </div>
          )}
        </Tabs.TabPane>
        <Tabs.TabPane key='attention' title={`${t('team.controlBoard.tabs.attention')} (${snapshot.attention.length})`}>
          <div className='h-full overflow-auto p-16px'>
            {snapshot.attention.length ? (
              snapshot.attention.map((item) => {
                const task = snapshot.tasks.find((candidate) => candidate.id === item.task_id);
                return task ? taskCard(task) : null;
              })
            ) : (
              <Empty description={t('team.controlBoard.noAttention')} />
            )}
          </div>
        </Tabs.TabPane>
        <Tabs.TabPane key='activity' title={t('team.controlBoard.tabs.activity')}>
          <TeamActivityView team={team} />
        </Tabs.TabPane>
      </Tabs>

      <Drawer
        width={480}
        visible={Boolean(selectedTask)}
        title={selectedTask?.subject}
        onCancel={() => {
          setSelectedTaskId(undefined);
          setLastReceipt(undefined);
        }}
        footer={null}
      >
        {selectedTask && (
          <div className='flex flex-col gap-12px' data-testid='team-work-task-drawer'>
            <div className='flex gap-6px flex-wrap'>
              <Tag color={statusColor(selectedTask.status)}>{statusLabel(selectedTask.status)}</Tag>
              <Tag>{t('team.controlBoard.version', { version: selectedTask.version })}</Tag>
              <Tag>{t(`team.controlBoard.owner.${selectedTask.next_action_owner}`)}</Tag>
            </div>
            {selectedTask.description && <div>{selectedTask.description}</div>}
            {selectedTask.progress_summary && <Alert type='info' content={selectedTask.progress_summary} />}
            <Card size='small' title={t('team.controlBoard.dependencies')}>
              <div>
                {selectedTask.blocked_by.length ? selectedTask.blocked_by.join(', ') : t('team.controlBoard.none')}
              </div>
            </Card>
            <Card size='small' title={t('team.controlBoard.attempts')}>
              {taskRuns.length
                ? taskRuns.map((run: ITeamWorkRun) => (
                    <div
                      key={run.id}
                      className='py-6px border-b border-solid border-[color:var(--border-base)] last:border-b-0'
                    >
                      <div className='flex justify-between'>
                        <span>
                          #{run.attempt} · {run.slot_id}
                        </span>
                        <Tag size='small'>{t(`team.controlBoard.runStatus.${run.status}`)}</Tag>
                      </div>
                      {run.output_summary && <div className='text-12px mt-4px'>{run.output_summary}</div>}
                      {run.verification_receipt && (
                        <div className='text-12px text-[color:var(--color-text-3)] mt-4px'>
                          {t('team.controlBoard.checks', {
                            passed: run.verification_receipt.checks.filter((check) => check.passed).length,
                            total: run.verification_receipt.checks.length,
                          })}
                          {run.verification_receipt.artifacts.map((artifact) => (
                            <div key={artifact}>{artifact}</div>
                          ))}
                          {run.verification_receipt.remaining_risks.map((risk) => (
                            <div key={risk}>
                              {t('team.controlBoard.risk')}: {risk}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                : t('team.controlBoard.none')}
            </Card>
            {attention && (
              <Card size='small' title={t('team.controlBoard.actionRequired')}>
                <div className='mb-8px'>{attention.reason}</div>
                <Input.TextArea
                  value={reason}
                  onChange={setReason}
                  placeholder={t('team.controlBoard.reasonPlaceholder')}
                />
                <div className='flex gap-8px flex-wrap mt-10px'>
                  {attention.allowed_actions
                    .filter((action) => action !== 'reassign')
                    .map((action) => (
                      <Button
                        key={action}
                        type='primary'
                        loading={submitting}
                        onClick={() => void runHumanAction(action)}
                      >
                        {t(`team.controlBoard.actions.${action}`)}
                      </Button>
                    ))}
                </div>
              </Card>
            )}
            {lastReceipt && (
              <Alert
                type='success'
                content={t('team.controlBoard.receipt', {
                  sequence: lastReceipt.event_sequence,
                  replayed: lastReceipt.replayed ? t('team.controlBoard.replayed') : t('team.controlBoard.applied'),
                })}
              />
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default TeamControlBoard;
