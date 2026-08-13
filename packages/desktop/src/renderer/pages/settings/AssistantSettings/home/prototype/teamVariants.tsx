/**
 * PROTOTYPE ONLY — three Team Work layouts on the existing work-center fixture route.
 * A keeps conversation primary, B turns the board into a task outline, and C keeps
 * the overview as an explicit secondary view. No control performs a real mutation.
 */
import { Alert, Button, Drawer, Progress, Tag } from '@arco-design/web-react';
import { AllApplication, Attention, FileText, ListView, Peoples, Refresh } from '@icon-park/react';
import type { TFunction } from 'i18next';
import React, { useState } from 'react';

type TeamVariantProps = { t: TFunction };

type MemberState = 'running' | 'waiting' | 'done';

const tt = (t: TFunction, key: string, defaultValue: string) => t(`prototype.workCenter.team.${key}`, { defaultValue });

const members: Array<{ id: string; name: string; role: string; state: MemberState; detail: string }> = [
  { id: 'lead', name: '审批负责人', role: 'Leader', state: 'running', detail: '正在汇总提交材料' },
  { id: 'policy', name: '合规检查员', role: '成员', state: 'done', detail: '制度核对已完成' },
  { id: 'document', name: '单据专员', role: '成员', state: 'waiting', detail: '等待费用部门确认' },
];

const tasks = [
  { id: 'check', title: '核对费用制度', status: 'completed', owner: '合规检查员', lane: '已完成' },
  { id: 'resolve', title: '确认费用归属部门', status: 'attention', owner: '需要你处理', lane: '进行中' },
  { id: 'package', title: '汇总审批材料', status: 'running', owner: '审批负责人', lane: '进行中' },
  { id: 'submit', title: '提交 OA 审批', status: 'queued', owner: '审批负责人', lane: '待开始' },
];

const stateColor = (state: MemberState) => (state === 'running' ? 'blue' : state === 'done' ? 'green' : 'orange');

const MemberAvatar: React.FC<{ name: string; active?: boolean }> = ({ name, active }) => (
  <div
    className={`flex size-34px shrink-0 items-center justify-center rounded-10px text-12px font-650 ${
      active ? 'bg-primary-6 text-white' : 'bg-fill-2 text-t-secondary'
    }`}
  >
    {name.slice(0, 1)}
  </div>
);

const TeamHeader: React.FC<{ t: TFunction; viewLabel?: string }> = ({ t, viewLabel }) => (
  <div className='flex min-h-54px shrink-0 flex-wrap items-center gap-10px border-b border-border-2 bg-bg-1 px-16px py-8px'>
    <div className='flex size-36px items-center justify-center rounded-11px bg-fill-2 text-t-secondary'>
      <Peoples size={19} />
    </div>
    <div className='min-w-0'>
      <div className='truncate text-14px font-650 text-t-primary'>{tt(t, 'name', '费用审批协作组')}</div>
      <div className='text-11px text-t-tertiary'>{tt(t, 'summary', '3 个成员 · 1 项需要你处理')}</div>
    </div>
    {viewLabel ? <Tag className='ml-auto'>{viewLabel}</Tag> : null}
    <Button size='small'>{tt(t, 'manage', '管理成员')}</Button>
  </div>
);

const TeamConversation: React.FC<{ t: TFunction; focusedTask?: string }> = ({ t, focusedTask }) => (
  <div className='mx-auto flex w-full max-w-720px flex-col gap-18px px-18px py-22px'>
    {focusedTask ? (
      <div className='flex items-center gap-8px rounded-10px bg-fill-1 px-12px py-8px text-11px text-t-secondary'>
        <ListView size={14} />
        {tt(t, 'focusedTask', '当前任务')}：<span className='font-600 text-t-primary'>{focusedTask}</span>
      </div>
    ) : null}
    <div className='ml-auto max-w-78% rounded-14px rounded-br-4px bg-fill-2 px-14px py-10px text-13px text-t-primary'>
      {tt(t, 'userMessage', '请并行检查这份费用申请，确认无误后准备 OA 审批材料。')}
    </div>
    <div className='flex items-start gap-10px'>
      <MemberAvatar name='合规检查员' />
      <div className='min-w-0 flex-1'>
        <div className='text-11px text-t-tertiary'>{tt(t, 'policyMember', '合规检查员 · 成员')}</div>
        <div className='mt-4px text-13px leading-6 text-t-primary'>
          {tt(t, 'policyMessage', '制度核对已完成：差旅标准符合，但费用归属存在两个可能的成本中心。')}
        </div>
      </div>
    </div>
    <Alert
      type='warning'
      title={tt(t, 'attentionTitle', '需要确认费用归属部门')}
      content={tt(t, 'attentionBody', '该请求属于原任务和成员会话，处理后将恢复同一个 Turn。')}
      action={<Button type='primary'>{tt(t, 'handle', '现在处理')}</Button>}
    />
    <div className='flex items-start gap-10px'>
      <MemberAvatar name='审批负责人' active />
      <div className='min-w-0 flex-1'>
        <div className='text-11px text-t-tertiary'>{tt(t, 'leadMember', '审批负责人 · Leader')}</div>
        <div className='mt-4px text-13px leading-6 text-t-primary'>
          {tt(t, 'leadMessage', '我会在部门确认后汇总成员结果，并由我提交 Team Completion Receipt。')}
        </div>
      </div>
    </div>
  </div>
);

const MemberRows: React.FC<{ t: TFunction; compact?: boolean }> = ({ t, compact }) => (
  <div className='flex flex-col gap-6px'>
    {members.map((member) => (
      <Button
        key={member.id}
        type='text'
        long
        className='!h-auto !justify-start !rounded-10px !px-8px !py-8px !text-left hover:!bg-fill-1'
      >
        <MemberAvatar name={member.name} active={member.id === 'lead'} />
        <div className='min-w-0 flex-1'>
          <div className='truncate text-12px font-600 text-t-primary'>
            {tt(t, `member.${member.id}.name`, member.name)}
          </div>
          {!compact ? (
            <div className='mt-2px truncate text-10px text-t-tertiary'>
              {tt(t, `member.${member.id}.detail`, member.detail)}
            </div>
          ) : null}
        </div>
        <Tag size='small' color={stateColor(member.state)}>
          {tt(
            t,
            `memberState.${member.state}`,
            member.state === 'running' ? '执行中' : member.state === 'done' ? '已完成' : '等待中'
          )}
        </Tag>
      </Button>
    ))}
  </div>
);

const MiniKanban: React.FC<{ t: TFunction }> = ({ t }) => {
  const lanes = ['待开始', '进行中', '已完成'];
  return (
    <div className='grid min-w-620px grid-cols-3 gap-12px'>
      {lanes.map((lane) => {
        const laneTasks = tasks.filter((task) => task.lane === lane);
        return (
          <section key={lane} className='rounded-12px bg-fill-1 p-10px'>
            <div className='mb-9px flex items-center justify-between text-12px font-600 text-t-primary'>
              <span>{tt(t, `lane.${lane}`, lane)}</span>
              <Tag size='small'>{laneTasks.length}</Tag>
            </div>
            <div className='flex flex-col gap-8px'>
              {laneTasks.map((task) => (
                <div key={task.id} className='rounded-10px bg-bg-1 p-10px'>
                  <div className='text-12px font-500 text-t-primary'>{tt(t, `task.${task.id}`, task.title)}</div>
                  <div className='mt-6px text-10px text-t-tertiary'>{tt(t, `taskOwner.${task.id}`, task.owner)}</div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};

const ContextInspector: React.FC<{ t: TFunction; onOpenBoard: () => void }> = ({ t, onOpenBoard }) => (
  <div className='flex flex-col gap-16px'>
    <section>
      <div className='flex items-center justify-between text-12px font-600 text-t-primary'>
        <span>{tt(t, 'currentWork', '当前工作')}</span>
        <Tag color='blue'>{tt(t, 'parallel', '2 路并行')}</Tag>
      </div>
      <div className='mt-9px rounded-11px bg-fill-1 p-11px'>
        <div className='text-12px font-500 text-t-primary'>{tt(t, 'packageTask', '汇总审批材料')}</div>
        <Progress className='mt-10px' percent={68} showText={false} />
        <div className='mt-7px text-10px text-t-tertiary'>{tt(t, 'packageProgress', '2/3 成员结果已返回')}</div>
      </div>
    </section>
    <section>
      <div className='flex items-center gap-7px text-12px font-600 text-t-primary'>
        <Attention size={15} />
        {tt(t, 'attention', '需要你处理')}
        <Tag size='small' color='orange'>
          1
        </Tag>
      </div>
      <div className='mt-8px text-11px leading-5 text-t-secondary'>
        {tt(t, 'attentionSummary', '确认费用归属部门，当前阻塞单据专员。')}
      </div>
    </section>
    <section>
      <div className='flex items-center gap-7px text-12px font-600 text-t-primary'>
        <FileText size={15} />
        {tt(t, 'outputs', '输出与交付')}
      </div>
      <div className='mt-8px rounded-10px bg-fill-1 p-10px text-11px text-t-secondary'>
        {tt(t, 'outputSummary', '制度核对结果 v1 · 来自合规检查员')}
      </div>
    </section>
    <Button long icon={<AllApplication size={15} />} onClick={onOpenBoard}>
      {tt(t, 'openBoard', '按需展开任务面板')}
    </Button>
  </div>
);

export const TeamVariantA: React.FC<TeamVariantProps> = ({ t }) => {
  const [boardVisible, setBoardVisible] = useState(false);
  return (
    <div className='flex h-full min-h-0 flex-col bg-bg-0'>
      <TeamHeader t={t} viewLabel={tt(t, 'variantA', '会话主线')} />
      <div className='flex min-h-0 flex-1'>
        <aside className='hidden w-205px shrink-0 overflow-auto border-r border-border-2 bg-bg-0 p-10px lg:block'>
          <div className='mb-8px px-8px text-11px font-600 text-t-secondary'>{tt(t, 'members', '并行成员')}</div>
          <MemberRows t={t} />
        </aside>
        <main className='min-w-0 flex-1 overflow-auto bg-bg-1'>
          <TeamConversation t={t} />
        </main>
        <aside className='hidden w-300px shrink-0 overflow-auto border-l border-border-2 bg-bg-0 p-16px md:block'>
          <ContextInspector t={t} onOpenBoard={() => setBoardVisible(true)} />
        </aside>
      </div>
      <Drawer
        width={760}
        visible={boardVisible}
        title={tt(t, 'boardTitle', 'Team 当前任务')}
        footer={null}
        onCancel={() => setBoardVisible(false)}
      >
        <Alert
          className='mb-14px'
          type='info'
          content={tt(t, 'boardNotice', '这是 AionCore Team Work 的只读投影；状态变更仍通过来源动作完成。')}
        />
        <div className='overflow-auto'>
          <MiniKanban t={t} />
        </div>
      </Drawer>
    </div>
  );
};

export const TeamVariantB: React.FC<TeamVariantProps> = ({ t }) => {
  const [selectedTask, setSelectedTask] = useState(tasks[1]);
  return (
    <div className='flex h-full min-h-0 flex-col bg-bg-0'>
      <TeamHeader t={t} viewLabel={tt(t, 'variantB', '任务侧栏')} />
      <div className='flex min-h-0 flex-1'>
        <aside className='w-260px shrink-0 overflow-auto border-r border-border-2 bg-bg-0 p-10px'>
          <div className='mb-8px flex items-center justify-between px-6px'>
            <span className='text-11px font-600 text-t-secondary'>{tt(t, 'taskOutline', '任务大纲')}</span>
            <Tag size='small'>4</Tag>
          </div>
          <div className='flex flex-col gap-5px'>
            {tasks.map((task) => (
              <Button
                key={task.id}
                type='text'
                long
                className={`!h-auto !justify-start !rounded-10px !px-9px !py-9px !text-left ${selectedTask.id === task.id ? '!bg-fill-2' : ''}`}
                onClick={() => setSelectedTask(task)}
              >
                <div className='min-w-0'>
                  <div className='truncate text-12px font-500 text-t-primary'>
                    {tt(t, `task.${task.id}`, task.title)}
                  </div>
                  <div className='mt-3px truncate text-10px text-t-tertiary'>
                    {tt(t, `taskOwner.${task.id}`, task.owner)}
                  </div>
                </div>
              </Button>
            ))}
          </div>
        </aside>
        <main className='min-w-0 flex-1 overflow-auto bg-bg-1'>
          <TeamConversation t={t} focusedTask={tt(t, `task.${selectedTask.id}`, selectedTask.title)} />
        </main>
        <aside className='hidden w-250px shrink-0 overflow-auto border-l border-border-2 bg-bg-0 p-12px lg:block'>
          <div className='mb-8px px-8px text-11px font-600 text-t-secondary'>{tt(t, 'members', '并行成员')}</div>
          <MemberRows t={t} compact />
          <div className='mt-14px border-t border-border-2 pt-14px'>
            <div className='text-11px font-600 text-t-secondary'>{tt(t, 'taskResult', '当前任务结果')}</div>
            <div className='mt-8px rounded-10px bg-fill-1 p-10px text-11px text-t-primary'>
              {selectedTask.status === 'completed'
                ? tt(t, 'verifiedOutput', '已验证输出可供 Leader 汇总')
                : tt(t, 'notReady', '尚未形成可交付结果')}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

type TeamOverviewView = 'chat' | 'overview' | 'activity';

export const TeamVariantC: React.FC<TeamVariantProps> = ({ t }) => {
  const [view, setView] = useState<TeamOverviewView>('overview');
  return (
    <div className='flex h-full min-h-0 flex-col bg-bg-0'>
      <TeamHeader t={t} />
      <div className='flex h-46px shrink-0 items-center gap-4px border-b border-border-2 bg-bg-1 px-16px'>
        {(['chat', 'overview', 'activity'] as const).map((item) => (
          <Button key={item} type={view === item ? 'primary' : 'text'} size='small' onClick={() => setView(item)}>
            {tt(t, `view.${item}`, item === 'chat' ? '对话' : item === 'overview' ? '工作总览' : 'Activity')}
          </Button>
        ))}
        <Tag className='ml-auto' color='orange'>
          {tt(t, 'oneAttention', '1 项待处理')}
        </Tag>
      </div>
      <div className='min-h-0 flex-1 overflow-auto bg-bg-1'>
        {view === 'chat' ? <TeamConversation t={t} /> : null}
        {view === 'activity' ? (
          <div className='mx-auto max-w-800px px-20px py-22px'>
            <div className='mb-12px text-14px font-600 text-t-primary'>{tt(t, 'activityTitle', '团队过程轨迹')}</div>
            {[
              ['10:42', '合规检查员完成制度核对'],
              ['10:39', '单据专员请求确认费用归属部门'],
              ['10:35', '审批负责人拆分并分派 3 项工作'],
            ].map(([time, detail]) => (
              <div key={time} className='flex gap-12px border-b border-border-2 py-12px text-12px'>
                <span className='text-t-tertiary'>{time}</span>
                <span className='text-t-primary'>{tt(t, `activity.${time}`, detail)}</span>
              </div>
            ))}
          </div>
        ) : null}
        {view === 'overview' ? (
          <div className='mx-auto max-w-1080px px-18px py-18px'>
            <div className='grid grid-cols-1 gap-12px lg:grid-cols-[minmax(0,1fr)_300px]'>
              <section className='rounded-14px bg-base p-16px'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-8px text-14px font-600 text-t-primary'>
                    <AllApplication size={16} />
                    {tt(t, 'currentTasks', '当前任务')}
                  </div>
                  <span className='text-11px text-t-tertiary'>{tt(t, 'boardReadonly', '只读投影')}</span>
                </div>
                <div className='mt-14px overflow-auto'>
                  <MiniKanban t={t} />
                </div>
              </section>
              <div className='flex flex-col gap-12px'>
                <section className='rounded-14px bg-base p-14px'>
                  <div className='flex items-center gap-7px text-13px font-600 text-t-primary'>
                    <Attention size={15} />
                    {tt(t, 'attention', '需要你处理')}
                  </div>
                  <div className='mt-9px text-11px leading-5 text-t-secondary'>
                    {tt(t, 'attentionSummary', '确认费用归属部门，当前阻塞单据专员。')}
                  </div>
                  <Button type='primary' long className='mt-11px'>
                    {tt(t, 'handle', '现在处理')}
                  </Button>
                </section>
                <section className='rounded-14px bg-base p-14px'>
                  <div className='flex items-center gap-7px text-13px font-600 text-t-primary'>
                    <Peoples size={15} />
                    {tt(t, 'members', '并行成员')}
                  </div>
                  <div className='mt-8px'>
                    <MemberRows t={t} compact />
                  </div>
                </section>
                <section className='rounded-14px bg-base p-14px'>
                  <div className='flex items-center gap-7px text-13px font-600 text-t-primary'>
                    <FileText size={15} />
                    {tt(t, 'delivery', '交付准备')}
                  </div>
                  <div className='mt-9px flex items-center gap-8px text-11px text-t-secondary'>
                    <Refresh size={14} />
                    {tt(t, 'deliveryWaiting', '等待 1 项用户确认后由 Leader 汇总')}
                  </div>
                </section>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
