/**
 * PROTOTYPE ONLY — three end-to-end compositions for the managed Assistant journey.
 * Fixture state only. No button calls GEA, AionCore, MCP, or a business system.
 */
import { Alert, Button, Progress, Radio, Tag } from '@arco-design/web-react';
import {
  Attention,
  CheckOne,
  FileText,
  Lightning,
  LinkCloud,
  Peoples,
  Refresh,
  Right,
  Robot,
  Shield,
} from '@icon-park/react';
import type { TFunction } from 'i18next';
import React from 'react';

export type JourneyStep =
  | 'catalog'
  | 'detail'
  | 'preparing'
  | 'running'
  | 'attention'
  | 'resumed'
  | 'deliverable'
  | 'receipt'
  | 'team'
  | 'error';

export const JOURNEY_STEPS: Array<{ key: JourneyStep; label: string }> = [
  { key: 'catalog', label: '目录同步' },
  { key: 'detail', label: '配置确认' },
  { key: 'preparing', label: '运行准备' },
  { key: 'running', label: '执行过程' },
  { key: 'attention', label: '需要介入' },
  { key: 'resumed', label: '恢复执行' },
  { key: 'deliverable', label: '检查产物' },
  { key: 'receipt', label: '完成回执' },
];

type JourneyVariantProps = {
  step: JourneyStep;
  t: TFunction;
  onStepChange: (step: JourneyStep) => void;
};

const jt = (t: TFunction, key: string, defaultValue: string) => t(`prototype.endToEnd.${key}`, { defaultValue });

const stepIndex = (step: JourneyStep) => JOURNEY_STEPS.findIndex((item) => item.key === step);

const stepLabel = (step: JourneyStep, t: TFunction) => {
  if (step === 'team') return jt(t, 'step.team', 'Team 复用');
  if (step === 'error') return jt(t, 'step.error', '策略错误');
  const item = JOURNEY_STEPS.find((candidate) => candidate.key === step);
  return item ? jt(t, `step.${item.key}`, item.label) : step;
};

const nextStep = (step: JourneyStep): JourneyStep => {
  const current = stepIndex(step);
  if (current < 0 || current >= JOURNEY_STEPS.length - 1) return 'receipt';
  return JOURNEY_STEPS[current + 1].key;
};

const statusMeta = (step: JourneyStep, t: TFunction) => {
  if (step === 'catalog') return { color: 'gray' as const, text: jt(t, 'status.synced', '目录已同步') };
  if (step === 'detail') return { color: 'arcoblue' as const, text: jt(t, 'status.ready', '可以发起会话') };
  if (step === 'preparing') return { color: 'blue' as const, text: jt(t, 'status.preparing', '正在准备能力') };
  if (step === 'running') return { color: 'blue' as const, text: jt(t, 'status.running', '正在执行') };
  if (step === 'attention') return { color: 'orange' as const, text: jt(t, 'status.attention', '需要你处理') };
  if (step === 'resumed') return { color: 'blue' as const, text: jt(t, 'status.resumed', '已恢复执行') };
  if (step === 'deliverable') return { color: 'green' as const, text: jt(t, 'status.deliverable', '等待检查产物') };
  if (step === 'receipt') return { color: 'green' as const, text: jt(t, 'status.completed', '已完成') };
  if (step === 'team') return { color: 'purple' as const, text: jt(t, 'status.team', 'Team 协作') };
  return { color: 'red' as const, text: jt(t, 'status.rejected', '企业策略拒绝') };
};

const AssistantAvatar: React.FC<{ team?: boolean }> = ({ team }) => (
  <div className='flex size-38px shrink-0 items-center justify-center rounded-12px bg-fill-2 text-t-secondary'>
    {team ? <Peoples size={20} /> : <Robot size={20} />}
  </div>
);

const ManagedAssistantHeader: React.FC<{ step: JourneyStep; t: TFunction }> = ({ step, t }) => {
  const meta = statusMeta(step, t);
  return (
    <div className='flex min-h-56px shrink-0 items-center gap-10px border-b border-border-2 bg-bg-1 px-18px py-8px'>
      <AssistantAvatar team={step === 'team'} />
      <div className='min-w-0'>
        <div className='truncate text-14px font-650 text-t-primary'>
          {step === 'team' ? jt(t, 'team.name', '费用审批协作组') : jt(t, 'assistant.name', '费用审批助手')}
        </div>
        <div className='text-11px text-t-tertiary'>
          {step === 'team'
            ? jt(t, 'team.summary', '3 个成员 · 共享同一套待处理与交付语义')
            : jt(t, 'assistant.version', '企业受管 · 模板 v2.4 · Assignment A-2048')}
        </div>
      </div>
      <Tag className='ml-auto' color={meta.color}>
        {meta.text}
      </Tag>
    </div>
  );
};

const JourneyRail: React.FC<{
  current: JourneyStep;
  t: TFunction;
  vertical?: boolean;
  onChange: (step: JourneyStep) => void;
}> = ({ current, t, vertical, onChange }) => {
  const currentIndex = stepIndex(current);
  return (
    <div className={vertical ? 'flex flex-col gap-4px' : 'flex min-w-max items-center gap-4px'}>
      {JOURNEY_STEPS.map((item, index) => {
        const active = item.key === current;
        const completed = currentIndex > index || current === 'receipt';
        return (
          <Button
            key={item.key}
            type={active ? 'primary' : 'text'}
            size='small'
            className={vertical ? '!h-36px !justify-start !rounded-9px' : '!rounded-9px'}
            icon={completed && !active ? <CheckOne size={13} /> : undefined}
            onClick={() => onChange(item.key)}
          >
            {jt(t, `step.${item.key}`, item.label)}
          </Button>
        );
      })}
    </div>
  );
};

const CapabilityList: React.FC<{ t: TFunction; compact?: boolean }> = ({ t, compact }) => {
  const rows = [
    { id: 'skill', icon: <Lightning size={15} />, name: '费用合规检查', detail: '企业基座 · Skill 2.1.0' },
    { id: 'oa', icon: <LinkCloud size={15} />, name: 'OA 生产审批', detail: '企业基座 · MCP 4.3.2' },
    { id: 'policy', icon: <LinkCloud size={15} />, name: '制度知识检索', detail: '我的扩展 · MCP 1.4.0' },
  ];
  return (
    <div className='divide-y divide-border-2'>
      {rows.map((row) => (
        <div key={row.id} className='flex items-center gap-9px py-9px'>
          {row.icon}
          <div className='min-w-0 flex-1'>
            <div className='truncate text-12px text-t-primary'>{jt(t, `capability.${row.id}.name`, row.name)}</div>
            {!compact ? (
              <div className='mt-1px truncate text-10px text-t-tertiary'>
                {jt(t, `capability.${row.id}.detail`, row.detail)}
              </div>
            ) : null}
          </div>
          <CheckOne size={13} className='text-success-6' />
        </div>
      ))}
    </div>
  );
};

const CatalogContent: React.FC<{ t: TFunction; onContinue: () => void }> = ({ t, onContinue }) => (
  <div className='mx-auto w-full max-w-920px px-20px py-22px'>
    <div className='mb-16px flex flex-wrap items-end justify-between gap-12px'>
      <div>
        <div className='text-20px font-650 text-t-primary'>{jt(t, 'catalog.title', '企业助手')}</div>
        <div className='mt-5px text-12px text-t-secondary'>
          {jt(t, 'catalog.subtitle', '来自 GEA 的 21 个分配 · 最近完整同步于 10:42')}
        </div>
      </div>
      <Button icon={<Refresh size={14} />}>{jt(t, 'catalog.refresh', '重新同步')}</Button>
    </div>
    <Alert
      className='mb-14px'
      type='info'
      content={jt(t, 'catalog.notice', '企业分配决定可用性；客户端启用只代表本机偏好。')}
    />
    <div className='grid grid-cols-1 gap-14px sm:grid-cols-2 lg:grid-cols-3'>
      {[
        ['费用审批助手', '检查材料、识别风险并提交企业审批。', '企业必选'],
        ['合同审阅助手', '依据企业规则形成合同审阅意见。', '已启用'],
        ['经营分析助手', '连接数据源生成分析与管理摘要。', '可启用'],
      ].map(([name, description, state], index) => (
        <Button
          key={name}
          type='text'
          long
          className={`!h-auto !items-stretch !rounded-14px !border !border-solid !bg-base !p-16px !text-left ${
            index === 0 ? '!border-primary-6' : '!border-transparent hover:!border-border-2'
          }`}
          onClick={index === 0 ? onContinue : undefined}
        >
          <div className='w-full'>
            <div className='flex items-start justify-between gap-8px'>
              <AssistantAvatar />
              <Tag size='small' color={index === 0 ? 'arcoblue' : undefined}>
                {state}
              </Tag>
            </div>
            <div className='mt-12px text-14px font-600 text-t-primary'>{name}</div>
            <div className='mt-5px min-h-38px text-12px leading-5 text-t-secondary'>{description}</div>
            <div className='mt-12px flex items-center justify-between text-11px text-t-tertiary'>
              <span>v{index === 0 ? '2.4' : index === 1 ? '1.8' : '3.1'} · GEA 管理</span>
              <Right size={13} />
            </div>
          </div>
        </Button>
      ))}
    </div>
  </div>
);

const DetailContent: React.FC<{ t: TFunction; onContinue: () => void }> = ({ t, onContinue }) => (
  <div className='mx-auto grid w-full max-w-880px grid-cols-1 gap-14px px-20px py-22px md:grid-cols-2'>
    <section className='rounded-14px bg-base p-16px'>
      <div className='flex items-center gap-8px text-14px font-650 text-t-primary'>
        <Shield size={17} />
        {jt(t, 'detail.enterpriseConfig', '企业配置')}
        <Tag size='small'>{jt(t, 'detail.readonly', '只读')}</Tag>
      </div>
      <div className='mt-12px text-12px leading-6 text-t-secondary'>
        {jt(t, 'detail.enterpriseRules', '身份、运行规则、主 Agent、费用检查 Skill 与 OA 生产 MCP 由企业锁定。')}
      </div>
      <div className='mt-12px rounded-10px bg-fill-1 p-11px text-11px text-t-secondary'>
        {jt(t, 'detail.acceptance', '验收要求：生产提交必须生成外部结果与完成回执。')}
      </div>
    </section>
    <section className='rounded-14px bg-base p-16px'>
      <div className='text-14px font-650 text-t-primary'>{jt(t, 'detail.myExtensions', '我的扩展')}</div>
      <div className='mt-5px text-11px text-t-tertiary'>
        {jt(t, 'detail.extensionHint', '只能添加企业策略允许的辅助 Skill 或 MCP，不获得额外生产权限。')}
      </div>
      <div className='mt-12px flex items-center justify-between rounded-10px bg-fill-1 p-11px'>
        <div>
          <div className='text-12px font-500 text-t-primary'>{jt(t, 'detail.policySearch', '制度知识检索')}</div>
          <div className='mt-2px text-10px text-t-tertiary'>
            {jt(t, 'detail.localExtension', '本机 MCP · 待运行校验')}
          </div>
        </div>
        <Tag color='arcoblue'>{jt(t, 'detail.added', '已添加')}</Tag>
      </div>
      <Button type='primary' long className='mt-14px' onClick={onContinue}>
        {jt(t, 'detail.start', '使用此助手发起会话')}
      </Button>
    </section>
  </div>
);

const InteractionCard: React.FC<{ t: TFunction; onContinue: () => void }> = ({ t, onContinue }) => (
  <Alert
    type='warning'
    title={jt(t, 'attention.title', '需要确认费用归属部门')}
    content={jt(t, 'attention.body', '系统识别出两个可能的成本中心；选择结果会回到原 Turn 并继续执行。')}
    action={
      <div className='flex gap-8px'>
        <Button>{jt(t, 'attention.optionA', '研发中心')}</Button>
        <Button type='primary' onClick={onContinue}>
          {jt(t, 'attention.optionB', '市场中心并继续')}
        </Button>
      </div>
    }
  />
);

const DeliverableCard: React.FC<{ receipt?: boolean; t: TFunction; onContinue?: () => void }> = ({
  receipt,
  t,
  onContinue,
}) => (
  <div className='rounded-14px border border-solid border-border-2 bg-base p-15px'>
    <div className='flex items-start gap-10px'>
      {receipt ? <CheckOne size={20} className='text-success-6' /> : <FileText size={20} />}
      <div className='min-w-0 flex-1'>
        <div className='text-13px font-650 text-t-primary'>
          {receipt
            ? jt(t, 'receipt.title', '完成回执 CR-20260811-0842')
            : jt(t, 'deliverable.title', '费用审批材料 · 修订版 1')}
        </div>
        <div className='mt-4px text-11px leading-5 text-t-secondary'>
          {receipt
            ? jt(t, 'receipt.summary', 'OA 已受理，业务单号 OA-98521；3 项验证通过，无剩余风险。')
            : jt(t, 'deliverable.summary', '包含费用核对结果、提交参数、来源证据和验证状态。')}
        </div>
        <div className='mt-9px flex flex-wrap gap-6px'>
          <Tag size='small' color='green'>
            {receipt ? jt(t, 'receipt.externalResult', '外部结果已确认') : jt(t, 'deliverable.verified', '验证通过')}
          </Tag>
          <Tag size='small'>{receipt ? 'OA-98521' : jt(t, 'deliverable.outputCount', '3 个输出')}</Tag>
        </div>
      </div>
      {!receipt && onContinue ? (
        <Button type='primary' onClick={onContinue}>
          {jt(t, 'deliverable.accept', '确认交付')}
        </Button>
      ) : null}
    </div>
  </div>
);

const TeamReuseContent: React.FC<{ t: TFunction }> = ({ t }) => (
  <div className='grid h-full min-h-0 grid-cols-1 md:grid-cols-[190px_minmax(0,1fr)_280px]'>
    <aside className='hidden overflow-auto border-r border-border-2 bg-bg-0 p-10px md:block'>
      <div className='mb-8px px-7px text-11px font-600 text-t-secondary'>{jt(t, 'team.members', '成员会话')}</div>
      {[
        ['审批负责人', '正在汇总', 'bg-primary-6'],
        ['合规检查员', '已完成', 'bg-success-6'],
        ['单据专员', '等待确认', 'bg-warning-6'],
      ].map(([name, state, colorClass]) => (
        <div key={name} className='mb-6px flex items-center gap-8px rounded-10px px-8px py-9px hover:bg-fill-1'>
          <div className='flex size-28px items-center justify-center rounded-9px bg-fill-2 text-11px'>{name[0]}</div>
          <div className='min-w-0 flex-1'>
            <div className='truncate text-11px font-500 text-t-primary'>{name}</div>
            <div className='text-10px text-t-tertiary'>{state}</div>
          </div>
          <span className={`size-6px rounded-full ${colorClass}`} />
        </div>
      ))}
    </aside>
    <main className='overflow-auto bg-bg-1 px-16px py-20px'>
      <div className='mx-auto max-w-700px'>
        <div className='ml-auto max-w-78% rounded-14px rounded-br-4px bg-fill-2 px-14px py-10px text-13px'>
          {jt(t, 'team.request', '请并行检查材料并准备 OA 审批。')}
        </div>
        <div className='mt-18px text-11px text-t-tertiary'>{jt(t, 'team.memberLabel', '合规检查员 · 成员')}</div>
        <div className='mt-4px text-13px leading-6 text-t-primary'>
          {jt(t, 'team.memberResult', '制度核对已完成；费用归属仍需用户确认。')}
        </div>
        <Alert
          className='mt-16px'
          type='warning'
          title={jt(t, 'team.attention', '需要确认费用归属部门')}
          content={jt(t, 'team.attentionHint', '请求仍属于来源任务和成员会话，处理后恢复同一 Turn。')}
        />
      </div>
    </main>
    <aside className='hidden overflow-auto border-l border-border-2 bg-bg-0 p-15px md:block'>
      <div className='text-12px font-650 text-t-primary'>{jt(t, 'team.context', 'Team 上下文')}</div>
      <div className='mt-12px rounded-11px bg-fill-1 p-11px'>
        <div className='text-11px text-t-tertiary'>{jt(t, 'team.currentTask', '当前任务')}</div>
        <div className='mt-4px text-12px font-500 text-t-primary'>{jt(t, 'team.package', '汇总审批材料')}</div>
        <Progress className='mt-9px' percent={68} showText={false} />
      </div>
      <div className='mt-16px text-12px font-600 text-t-primary'>{jt(t, 'team.outputs', '成员输出')}</div>
      <div className='mt-8px rounded-10px bg-fill-1 p-10px text-11px text-t-secondary'>
        {jt(t, 'team.output', '制度核对结果 v1 · 可供 Leader 汇总')}
      </div>
      <Button long className='mt-14px'>
        {jt(t, 'team.board', '按需查看只读任务面板')}
      </Button>
    </aside>
  </div>
);

const ErrorContent: React.FC<{ t: TFunction; onContinue: () => void }> = ({ t, onContinue }) => (
  <div className='mx-auto max-w-720px px-20px py-28px'>
    <Alert
      type='error'
      title={jt(t, 'error.title', '企业策略拒绝了个人扩展')}
      content={jt(
        t,
        'error.body',
        '“制度知识检索”不允许参与本次受管运行。企业基座未被修改，当前 Turn 尚未提交任何生产操作。'
      )}
    />
    <div className='mt-14px rounded-14px bg-base p-16px'>
      <div className='grid grid-cols-[110px_1fr] gap-y-8px text-12px'>
        <span className='text-t-tertiary'>Code</span>
        <span className='text-t-primary'>GEA_EXTENSION_NOT_ALLOWED</span>
        <span className='text-t-tertiary'>Correlation ID</span>
        <span className='text-t-primary'>GEA-8F21</span>
        <span className='text-t-tertiary'>{jt(t, 'error.action', '建议动作')}</span>
        <span className='text-t-primary'>
          {jt(t, 'error.suggestion', '停用该扩展后重新准备；不要重试已发出的生产提交。')}
        </span>
      </div>
      <Button type='primary' className='mt-16px' onClick={onContinue}>
        {jt(t, 'error.disable', '停用扩展并重新准备')}
      </Button>
    </div>
  </div>
);

const ConversationStage: React.FC<{ step: JourneyStep; t: TFunction; onContinue: () => void }> = ({
  step,
  t,
  onContinue,
}) => {
  if (step === 'team') return <TeamReuseContent t={t} />;
  if (step === 'error') return <ErrorContent t={t} onContinue={onContinue} />;
  if (step === 'catalog') return <CatalogContent t={t} onContinue={onContinue} />;
  if (step === 'detail') return <DetailContent t={t} onContinue={onContinue} />;
  return (
    <div className='mx-auto flex w-full max-w-720px flex-col gap-18px px-18px py-22px'>
      <div className='ml-auto max-w-78% rounded-14px rounded-br-4px bg-fill-2 px-14px py-10px text-13px text-t-primary'>
        {jt(t, 'conversation.request', '帮我检查这份费用申请，确认无误后提交审批。')}
      </div>
      <div className='flex items-start gap-10px'>
        <AssistantAvatar />
        <div className='min-w-0 flex-1 text-13px leading-6 text-t-primary'>
          {step === 'preparing'
            ? jt(t, 'conversation.preparing', '正在同步模板 v2.4、校验企业能力和我的扩展，并冻结会话配置快照。')
            : step === 'running'
              ? jt(t, 'conversation.running', '已读取申请单和 6 份附件，正在核对发票、预算归属与企业费用制度。')
              : step === 'attention'
                ? jt(t, 'conversation.waiting', '材料检查已完成，但费用归属存在两个可能的成本中心。')
                : step === 'resumed'
                  ? jt(t, 'conversation.resumed', '已记录“市场中心”，原 Turn 已恢复，正在提交 OA 审批。')
                  : jt(t, 'conversation.completed', 'OA 已返回受理结果，交付物与完成回执已生成。')}
          {step === 'preparing' || step === 'running' || step === 'resumed' ? (
            <div className='mt-9px flex items-center gap-7px text-11px text-t-secondary'>
              <Refresh className='animate-spin' size={13} />
              {step === 'preparing'
                ? jt(t, 'conversation.prepareState', '3/3 项能力已就绪，正在校验当前 Assignment')
                : step === 'resumed'
                  ? jt(t, 'conversation.resumeState', '等待业务系统确认，结果未知时不会自动重试')
                  : jt(t, 'conversation.runState', '已完成 4/6 项检查')}
            </div>
          ) : null}
        </div>
      </div>
      {step === 'attention' ? <InteractionCard t={t} onContinue={onContinue} /> : null}
      {step === 'deliverable' ? <DeliverableCard t={t} onContinue={onContinue} /> : null}
      {step === 'receipt' ? <DeliverableCard receipt t={t} /> : null}
      {['preparing', 'running', 'resumed'].includes(step) ? (
        <Button type='primary' className='self-end' onClick={onContinue}>
          {step === 'preparing'
            ? jt(t, 'action.prepared', '准备完成，查看执行')
            : step === 'running'
              ? jt(t, 'action.showAttention', '模拟需要介入')
              : jt(t, 'action.showDeliverable', '查看执行结果')}
        </Button>
      ) : null}
    </div>
  );
};

const ContextInspector: React.FC<{ step: JourneyStep; t: TFunction; onBranch: (step: JourneyStep) => void }> = ({
  step,
  t,
  onBranch,
}) => {
  const progress = Math.max(0, stepIndex(step));
  return (
    <div className='flex flex-col gap-16px'>
      <section>
        <div className='flex items-center justify-between text-12px font-650 text-t-primary'>
          <span>{jt(t, 'inspector.progress', '本次工作')}</span>
          <Tag size='small'>{stepLabel(step, t)}</Tag>
        </div>
        <Progress
          className='mt-10px'
          percent={step === 'receipt' ? 100 : Math.max(8, Math.round((progress / 7) * 100))}
          showText={false}
        />
      </section>
      <section>
        <div className='text-12px font-650 text-t-primary'>{jt(t, 'inspector.snapshot', '会话配置快照')}</div>
        <div className='mt-8px rounded-11px bg-fill-1 p-11px text-11px leading-5 text-t-secondary'>
          {jt(t, 'inspector.snapshotDetail', '模板 v2.4 · Agent finance-prod · 1 Skill · 2 MCP')}
        </div>
      </section>
      <section>
        <div className='text-12px font-650 text-t-primary'>{jt(t, 'inspector.capabilities', '本次能力')}</div>
        <CapabilityList compact t={t} />
      </section>
      <section className='flex flex-col gap-7px border-t border-border-2 pt-14px'>
        <Button long icon={<Peoples size={15} />} onClick={() => onBranch('team')}>
          {jt(t, 'branch.team', '查看 Team 如何复用')}
        </Button>
        <Button long status='danger' icon={<Attention size={15} />} onClick={() => onBranch('error')}>
          {jt(t, 'branch.error', '查看策略错误状态')}
        </Button>
      </section>
    </div>
  );
};

export const JourneyVariantA: React.FC<JourneyVariantProps> = ({ step, t, onStepChange }) => {
  const advance = () => onStepChange(step === 'error' ? 'preparing' : nextStep(step));
  return (
    <div className='flex h-full min-h-0 flex-col bg-bg-0'>
      <ManagedAssistantHeader step={step} t={t} />
      <div className='shrink-0 overflow-x-auto border-b border-border-2 bg-bg-0 px-12px py-7px'>
        <JourneyRail current={step} t={t} onChange={onStepChange} />
      </div>
      <div className='flex min-h-0 flex-1'>
        <main className='min-w-0 flex-1 overflow-auto bg-bg-1'>
          <ConversationStage step={step} t={t} onContinue={advance} />
        </main>
        {!['catalog', 'detail', 'team', 'error'].includes(step) ? (
          <aside className='hidden w-300px shrink-0 overflow-auto border-l border-border-2 bg-bg-0 p-16px md:block'>
            <ContextInspector step={step} t={t} onBranch={onStepChange} />
          </aside>
        ) : null}
      </div>
    </div>
  );
};

export const JourneyVariantB: React.FC<JourneyVariantProps> = ({ step, t, onStepChange }) => {
  const advance = () => onStepChange(step === 'error' ? 'preparing' : nextStep(step));
  return (
    <div className='grid h-full min-h-0 grid-cols-1 bg-bg-0 md:grid-cols-[220px_minmax(0,1fr)]'>
      <aside className='hidden overflow-auto border-r border-border-2 bg-bg-0 p-12px md:block'>
        <div className='px-8px pb-10px text-13px font-650 text-t-primary'>{jt(t, 'variantB.title', '工作旅程')}</div>
        <JourneyRail current={step} vertical t={t} onChange={onStepChange} />
        <div className='mt-16px border-t border-border-2 pt-14px'>
          <Button long icon={<Peoples size={15} />} onClick={() => onStepChange('team')}>
            {jt(t, 'branch.teamShort', 'Team 复用')}
          </Button>
          <Button long className='mt-6px' status='danger' onClick={() => onStepChange('error')}>
            {jt(t, 'branch.errorShort', '错误恢复')}
          </Button>
        </div>
      </aside>
      <div className='flex min-h-0 min-w-0 flex-col'>
        <ManagedAssistantHeader step={step} t={t} />
        <main className='min-h-0 flex-1 overflow-auto bg-bg-1'>
          <ConversationStage step={step} t={t} onContinue={advance} />
        </main>
        {!['catalog', 'detail', 'team', 'error', 'receipt'].includes(step) ? (
          <div className='shrink-0 border-t border-border-2 bg-bg-0 px-16px py-10px'>
            <div className='mx-auto flex max-w-720px items-center gap-10px'>
              <div className='min-w-0 flex-1 truncate text-11px text-t-secondary'>
                {jt(t, 'variantB.next', '下一状态由来源 Turn 确认后进入，不创建平行任务。')}
              </div>
              <Button type='primary' onClick={advance}>
                {jt(t, 'action.continue', '继续演示')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const JourneyVariantC: React.FC<JourneyVariantProps> = ({ step, t, onStepChange }) => {
  const advance = () => onStepChange(step === 'error' ? 'preparing' : nextStep(step));
  const meta = statusMeta(step, t);
  return (
    <div className='h-full overflow-auto bg-bg-1'>
      <ManagedAssistantHeader step={step} t={t} />
      <div className='mx-auto max-w-1120px px-16px py-16px'>
        <div className='mb-12px flex flex-wrap items-center gap-8px'>
          <Radio.Group type='button' value={step} onChange={(value) => onStepChange(value as JourneyStep)}>
            <Radio value='catalog'>{jt(t, 'variantC.catalog', '目录')}</Radio>
            <Radio value='running'>{jt(t, 'variantC.run', '运行')}</Radio>
            <Radio value='attention'>{jt(t, 'variantC.attention', '待处理')}</Radio>
            <Radio value='deliverable'>{jt(t, 'variantC.delivery', '交付')}</Radio>
            <Radio value='team'>{jt(t, 'variantC.team', 'Team')}</Radio>
            <Radio value='error'>{jt(t, 'variantC.error', '错误')}</Radio>
          </Radio.Group>
          <Tag className='ml-auto' color={meta.color}>
            {meta.text}
          </Tag>
        </div>
        <div className='grid grid-cols-1 gap-12px lg:grid-cols-[minmax(0,1fr)_320px]'>
          <section className='min-h-480px overflow-hidden rounded-14px bg-base'>
            <ConversationStage step={step} t={t} onContinue={advance} />
          </section>
          <div className='flex flex-col gap-12px'>
            <section className='rounded-14px bg-base p-14px'>
              <div className='text-12px font-650 text-t-primary'>{jt(t, 'variantC.journey', '端到端状态')}</div>
              <div className='mt-9px'>
                <JourneyRail current={step} vertical t={t} onChange={onStepChange} />
              </div>
            </section>
            <section className='rounded-14px bg-base p-14px'>
              <ContextInspector step={step} t={t} onBranch={onStepChange} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
