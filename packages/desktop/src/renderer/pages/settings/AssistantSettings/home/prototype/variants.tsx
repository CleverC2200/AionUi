/**
 * PROTOTYPE ONLY — three deliberately different information architectures.
 * All data is illustrative fixture content and no control performs a real mutation.
 */
import { Alert, Button, Progress, Switch, Tag } from '@arco-design/web-react';
import {
  Attention,
  CheckOne,
  FileText,
  FolderOpen,
  Lightning,
  LinkCloud,
  Refresh,
  Right,
  Robot,
  Shield,
} from '@icon-park/react';
import React from 'react';
import type { TFunction } from 'i18next';

export type PrototypeScenario = 'journey' | 'catalog' | 'running' | 'attention' | 'deliverable' | 'error' | 'team';

type VariantProps = {
  scenario: PrototypeScenario;
  t: TFunction;
};

const pt = (t: TFunction, key: string, defaultValue: string) => t(`prototype.workCenter.${key}`, { defaultValue });

const capabilityRows = [
  { id: 'skill-finance-check', name: '费用合规检查', kind: 'Skill', source: '企业内置' },
  { id: 'mcp-oa-production', name: 'OA 生产审批', kind: 'MCP', source: '企业内置' },
  { id: 'mcp-policy-search', name: '制度知识检索', kind: 'MCP', source: '我的扩展' },
];

const assistants = [
  {
    id: 'finance',
    name: '费用审批助手',
    summary: '检查材料、识别风险并提交企业审批。',
    required: true,
    version: 'v2.4',
  },
  {
    id: 'contract',
    name: '合同审阅助手',
    summary: '基于企业规则检查合同并形成审阅意见。',
    required: false,
    version: 'v1.8',
  },
  {
    id: 'analysis',
    name: '经营分析助手',
    summary: '连接数据源完成分析、图表与管理摘要。',
    required: false,
    version: 'v3.1',
  },
];

const getScenarioMeta = (scenario: PrototypeScenario, t: TFunction) => {
  switch (scenario) {
    case 'attention':
      return {
        label: pt(t, 'status.attention', '需要你处理'),
        color: 'orange' as const,
        detail: pt(t, 'status.attentionDetail', '确认本次提交的费用归属部门'),
      };
    case 'deliverable':
      return {
        label: pt(t, 'status.deliverable', '已形成交付'),
        color: 'green' as const,
        detail: pt(t, 'status.deliverableDetail', '审批材料与验证回执已准备完成'),
      };
    case 'error':
      return {
        label: pt(t, 'status.error', '企业策略拒绝'),
        color: 'red' as const,
        detail: pt(t, 'status.errorDetail', '个人 MCP 不允许参与本次运行'),
      };
    case 'running':
      return {
        label: pt(t, 'status.running', '正在执行'),
        color: 'blue' as const,
        detail: pt(t, 'status.runningDetail', '正在核对附件与企业费用制度'),
      };
    default:
      return {
        label: pt(t, 'status.catalog', '企业目录'),
        color: 'gray' as const,
        detail: pt(t, 'status.catalogDetail', '选择一个企业助手开始工作'),
      };
  }
};

const AssistantMark: React.FC = () => (
  <div className='flex size-38px shrink-0 items-center justify-center rounded-12px bg-fill-2 text-t-secondary'>
    <Robot size={20} />
  </div>
);

const EnterpriseCatalog: React.FC<{ mode: 'grid' | 'rows' | 'split'; t: TFunction }> = ({ mode, t }) => {
  const items = assistants.map((assistant) => {
    const assistantName = pt(t, `assistant.${assistant.id}.name`, assistant.name);
    const assistantSummary = pt(t, `assistant.${assistant.id}.summary`, assistant.summary);
    const body = (
      <>
        <div className='flex items-start justify-between gap-10px'>
          <AssistantMark />
          {assistant.required ? (
            <Tag size='small' color='arcoblue'>
              {t('prototype.workCenter.required', { defaultValue: '企业必选' })}
            </Tag>
          ) : (
            <Switch size='small' defaultChecked={assistant.id === 'contract'} />
          )}
        </div>
        <div className='mt-12px text-14px font-600 text-t-primary'>{assistantName}</div>
        <div className='mt-5px text-12px leading-5 text-t-secondary'>{assistantSummary}</div>
        <div className='mt-12px flex items-center justify-between text-11px text-t-tertiary'>
          <span>
            {assistant.version} · {pt(t, 'managedByGea', 'GEA 管理')}
          </span>
          <Right size={13} />
        </div>
      </>
    );

    if (mode === 'rows') {
      return (
        <div
          key={assistant.id}
          className='flex items-center gap-12px border-b border-border-2 px-4px py-14px last:border-b-0'
        >
          <AssistantMark />
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-8px'>
              <span className='truncate text-14px font-600 text-t-primary'>{assistantName}</span>
              <span className='text-11px text-t-tertiary'>{assistant.version}</span>
            </div>
            <div className='mt-3px truncate text-12px text-t-secondary'>{assistantSummary}</div>
          </div>
          {assistant.required ? <Tag color='arcoblue'>{pt(t, 'required', '企业必选')}</Tag> : <Switch size='small' />}
          <Button type='text' icon={<Right />} aria-label={pt(t, 'viewAssistant', `查看${assistantName}`)} />
        </div>
      );
    }

    return (
      <div
        key={assistant.id}
        className={`rounded-14px bg-base p-16px ${mode === 'split' && assistant.id === 'finance' ? 'ring-1 ring-primary-6' : ''}`}
      >
        {body}
      </div>
    );
  });

  if (mode === 'rows') return <div className='rounded-14px bg-base px-12px'>{items}</div>;
  return (
    <div
      className={`grid gap-14px ${mode === 'split' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}
    >
      {items}
    </div>
  );
};

const ConversationTranscript: React.FC<{ scenario: PrototypeScenario; compact?: boolean; t: TFunction }> = ({
  scenario,
  compact,
  t,
}) => {
  const meta = getScenarioMeta(scenario, t);
  return (
    <div
      className={`mx-auto flex w-full max-w-720px flex-col ${compact ? 'gap-12px' : 'gap-18px'} px-14px py-18px md:px-24px md:py-22px`}
    >
      <div className='ml-auto max-w-75% rounded-14px rounded-br-4px bg-fill-2 px-14px py-10px text-13px text-t-primary'>
        {pt(t, 'conversation.userRequest', '帮我检查这份费用申请，确认无误后提交审批。')}
      </div>
      <div className='flex max-w-88% items-start gap-10px'>
        <AssistantMark />
        <div className='min-w-0 flex-1 text-13px leading-6 text-t-primary'>
          {pt(t, 'conversation.assistantUpdate', '已读取申请单和 6 份附件，正在核对发票、预算归属与企业费用制度。')}
          <div className='mt-10px flex items-center gap-8px text-12px text-t-secondary'>
            {scenario === 'running' ? <Refresh className='animate-spin' size={14} /> : <CheckOne size={14} />}
            <span>{meta.detail}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const ScenarioNotice: React.FC<{ scenario: PrototypeScenario; t: TFunction }> = ({ scenario, t }) => {
  if (scenario === 'attention') {
    return (
      <Alert
        type='warning'
        title={pt(t, 'notice.attentionTitle', '需要确认费用归属')}
        content={pt(t, 'notice.attentionContent', '系统识别出两个可能的成本中心，请选择后继续。')}
        action={<Button type='primary'>{pt(t, 'action.handleNow', '现在处理')}</Button>}
      />
    );
  }
  if (scenario === 'deliverable') {
    return (
      <Alert
        type='success'
        title={pt(t, 'notice.deliverableTitle', '审批材料已准备完成')}
        content={pt(t, 'notice.deliverableContent', '包含核对结果、提交内容和验证回执。')}
        action={<Button>{pt(t, 'action.viewDeliverable', '查看交付')}</Button>}
      />
    );
  }
  if (scenario === 'error') {
    return (
      <Alert
        type='error'
        title={pt(t, 'notice.errorTitle', 'GEA 拒绝了个人扩展')}
        content={pt(t, 'notice.errorContent', '“制度知识检索”不允许参与该企业助手运行。错误编号 GEA-8F21。')}
        action={<Button>{pt(t, 'action.disableAndRetry', '停用扩展并重试')}</Button>}
      />
    );
  }
  return null;
};

export const VariantA: React.FC<VariantProps> = ({ scenario, t }) => {
  const meta = getScenarioMeta(scenario, t);
  if (scenario === 'catalog') {
    return (
      <div className='h-full overflow-auto px-28px py-24px'>
        <div className='mx-auto max-w-980px'>
          <div className='mb-18px flex items-end justify-between gap-16px'>
            <div>
              <h2 className='m-0 text-20px font-650 text-t-primary'>{pt(t, 'enterpriseAssistants', '企业助手')}</h2>
              <p className='mb-0 mt-6px text-12px text-t-secondary'>
                {pt(t, 'catalogHint', '由 GEA 管理 · 企业配置只读，允许添加辅助扩展')}
              </p>
            </div>
            <Button icon={<Refresh size={14} />}>{pt(t, 'syncedJustNow', '刚刚同步')}</Button>
          </div>
          <EnterpriseCatalog mode='grid' t={t} />
        </div>
      </div>
    );
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex h-52px shrink-0 items-center gap-10px border-b border-border-2 px-18px'>
        <AssistantMark />
        <div className='min-w-0'>
          <div className='truncate text-14px font-600 text-t-primary'>
            {pt(t, 'assistant.finance.name', '费用审批助手')}
          </div>
          <div className='text-11px text-t-tertiary'>{pt(t, 'managedVersion', '企业受管 · v2.4')}</div>
        </div>
        <Tag className='ml-auto' color={meta.color}>
          {meta.label}
        </Tag>
      </div>
      <div className='flex min-h-0 flex-1 flex-col md:flex-row'>
        <main className='min-w-0 flex-1 overflow-auto bg-bg-1'>
          <ConversationTranscript scenario={scenario} t={t} />
          <div className='mx-auto max-w-720px px-14px md:px-24px'>
            <ScenarioNotice scenario={scenario} t={t} />
          </div>
        </main>
        <aside className='max-h-[48%] w-full shrink-0 overflow-auto border-t border-border-2 bg-bg-0 px-16px py-18px md:max-h-none md:w-310px md:border-l md:border-t-0'>
          <div className='flex items-center justify-between'>
            <span className='text-13px font-600 text-t-primary'>{pt(t, 'workOverview', '工作概览')}</span>
            <Tag size='small' color={meta.color}>
              {meta.label}
            </Tag>
          </div>
          <div className='mt-16px rounded-12px bg-fill-1 p-14px'>
            <div className='text-11px text-t-tertiary'>{pt(t, 'currentStep', '当前步骤')}</div>
            <div className='mt-5px text-13px font-500 text-t-primary'>{meta.detail}</div>
            <Progress className='mt-12px' percent={scenario === 'deliverable' ? 100 : 68} showText={false} />
          </div>
          <div className='mt-18px text-12px font-600 text-t-primary'>{pt(t, 'runCapabilities', '本次能力')}</div>
          <div className='mt-8px divide-y divide-border-2'>
            {capabilityRows.map((row) => (
              <div key={row.id} className='flex items-center gap-9px py-10px'>
                {row.kind === 'Skill' ? <Lightning size={15} /> : <LinkCloud size={15} />}
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-12px text-t-primary'>
                    {pt(t, `capability.${row.id}.name`, row.name)}
                  </div>
                  <div className='text-10px text-t-tertiary'>{pt(t, `capability.${row.id}.source`, row.source)}</div>
                </div>
                <CheckOne size={13} className='text-success-6' />
              </div>
            ))}
          </div>
          <div className='mt-18px text-12px font-600 text-t-primary'>{pt(t, 'outputs', '产物')}</div>
          <div className='mt-8px flex items-center gap-9px rounded-10px bg-fill-1 p-10px'>
            <FileText size={16} />
            <span className='min-w-0 flex-1 truncate text-12px'>{pt(t, 'fixture.outputFile', '费用核对结果.md')}</span>
            <Right size={13} />
          </div>
        </aside>
      </div>
    </div>
  );
};

export const VariantB: React.FC<VariantProps> = ({ scenario, t }) => {
  if (scenario === 'catalog') {
    return (
      <div className='h-full overflow-auto px-28px py-24px'>
        <div className='mx-auto max-w-880px'>
          <div className='mb-16px flex items-center gap-12px'>
            <h2 className='m-0 text-20px font-650 text-t-primary'>{pt(t, 'enterpriseAssistants', '企业助手')}</h2>
            <Tag>{pt(t, 'lastSynced', '最后同步于 10:42')}</Tag>
          </div>
          <EnterpriseCatalog mode='rows' t={t} />
        </div>
      </div>
    );
  }

  const meta = getScenarioMeta(scenario, t);
  return (
    <div className='h-full overflow-auto bg-bg-1'>
      <div className='sticky top-0 z-10 flex min-h-48px flex-wrap items-center gap-9px border-b border-border-2 bg-bg-1 px-14px py-8px md:h-48px md:flex-nowrap md:px-18px md:py-0'>
        <AssistantMark />
        <span className='text-14px font-600 text-t-primary'>{pt(t, 'assistant.finance.name', '费用审批助手')}</span>
        <Tag size='small'>{pt(t, 'managedVersionReverse', 'v2.4 · 企业受管')}</Tag>
        <span className='ml-auto text-12px text-t-secondary'>{meta.label}</span>
      </div>
      <div className='mx-auto max-w-760px px-14px pb-72px pt-18px md:px-24px'>
        <ConversationTranscript scenario={scenario} compact t={t} />
        <div className='my-14px'>
          <ScenarioNotice scenario={scenario} t={t} />
        </div>
        <div className='border-y border-border-2 py-14px'>
          <div className='flex items-center gap-9px text-12px font-600 text-t-primary'>
            <Shield size={16} />
            {pt(t, 'enterpriseCapabilitiesUsed', '本次运行使用的企业能力')}
          </div>
          <div className='mt-10px flex flex-wrap gap-7px'>
            {capabilityRows.map((row) => (
              <Tag key={row.id}>
                {pt(t, `capability.${row.id}.name`, row.name)} · {pt(t, `capability.${row.id}.source`, row.source)}
              </Tag>
            ))}
          </div>
        </div>
        <div className='mt-18px flex items-center gap-12px rounded-14px bg-fill-1 p-14px'>
          <FileText size={20} />
          <div className='min-w-0 flex-1'>
            <div className='text-13px font-600 text-t-primary'>{pt(t, 'fixture.outputTitle', '费用核对结果')}</div>
            <div className='mt-3px text-11px text-t-secondary'>
              {pt(t, 'fixture.outputHint', '由当前轮次生成 · 等待提交或继续修改')}
            </div>
          </div>
          <Button>{pt(t, 'action.open', '打开')}</Button>
        </div>
      </div>
    </div>
  );
};

export const VariantC: React.FC<VariantProps> = ({ scenario, t }) => {
  if (scenario === 'catalog') {
    return (
      <div className='flex h-full min-h-0 flex-col md:flex-row'>
        <div className='min-w-0 flex-1 overflow-auto px-24px py-22px'>
          <h2 className='m-0 text-20px font-650 text-t-primary'>{pt(t, 'enterpriseAssistants', '企业助手')}</h2>
          <p className='mt-6px text-12px text-t-secondary'>
            {pt(t, 'splitCatalogHint', '选择助手后在右侧查看企业配置与我的扩展。')}
          </p>
          <div className='mt-16px'>
            <EnterpriseCatalog mode='split' t={t} />
          </div>
        </div>
        <aside className='max-h-[46%] w-full shrink-0 overflow-auto border-t border-border-2 bg-bg-0 p-18px md:max-h-none md:w-300px md:border-l md:border-t-0'>
          <div className='flex items-center gap-10px'>
            <AssistantMark />
            <div>
              <div className='text-14px font-600'>{pt(t, 'assistant.finance.name', '费用审批助手')}</div>
              <div className='text-11px text-t-tertiary'>{pt(t, 'geaManagedVersion', 'v2.4 · GEA 管理')}</div>
            </div>
          </div>
          <div className='mt-20px text-12px font-600'>{pt(t, 'enterpriseConfig', '企业配置')}</div>
          <div className='mt-8px rounded-12px bg-fill-1 p-12px text-12px leading-6 text-t-secondary'>
            {pt(t, 'enterpriseConfigSummary', 'Agent、费用检查 Skill 与 OA 生产 MCP 由企业锁定。')}
          </div>
          <div className='mt-18px flex items-center justify-between'>
            <span className='text-12px font-600'>{pt(t, 'myExtensions', '我的扩展')}</span>
            <Button size='mini'>{pt(t, 'action.add', '添加')}</Button>
          </div>
          <div className='mt-8px rounded-12px border border-border-2 p-12px text-12px'>
            {pt(t, 'fixture.localExtension', '制度知识检索 · 本机 MCP')}
          </div>
        </aside>
      </div>
    );
  }

  const meta = getScenarioMeta(scenario, t);
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex min-h-52px flex-wrap items-center gap-8px border-b border-border-2 px-12px py-9px md:h-52px md:flex-nowrap md:gap-10px md:px-18px md:py-0'>
        <AssistantMark />
        <div>
          <div className='text-14px font-600'>{pt(t, 'assistant.finance.name', '费用审批助手')}</div>
          <div className='text-11px text-t-tertiary'>{pt(t, 'managedVersion', '企业受管 · v2.4')}</div>
        </div>
        <div className='flex rounded-9px bg-fill-1 p-3px md:ml-18px'>
          <Button type='text' size='small'>
            {pt(t, 'conversationTab', '对话')}
          </Button>
          <Button type='primary' size='small'>
            {pt(t, 'workOverview', '工作总览')}
          </Button>
        </div>
        <Tag className='ml-auto' color={meta.color}>
          {meta.label}
        </Tag>
      </div>
      <div className='min-h-0 flex-1 overflow-auto bg-bg-1 px-12px py-16px md:px-26px md:py-22px'>
        <div className='mx-auto max-w-940px'>
          <ScenarioNotice scenario={scenario} t={t} />
          <div className='mt-16px grid grid-cols-1 gap-12px md:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)] md:gap-16px'>
            <section className='rounded-14px bg-base p-18px'>
              <div className='flex items-center justify-between'>
                <span className='text-14px font-600'>{pt(t, 'executionProgress', '执行进度')}</span>
                <Tag color={meta.color}>{meta.label}</Tag>
              </div>
              <div className='mt-18px grid grid-cols-3 gap-12px text-center'>
                {[
                  pt(t, 'step.readMaterials', '材料读取'),
                  pt(t, 'step.checkCompliance', '合规核对'),
                  pt(t, 'step.prepareSubmission', '提交准备'),
                ].map((step, index) => (
                  <div key={step} className='rounded-12px bg-fill-1 px-8px py-14px'>
                    <div className='mx-auto flex size-26px items-center justify-center rounded-full bg-bg-1'>
                      {index < 2 ? <CheckOne size={14} /> : <Refresh size={14} />}
                    </div>
                    <div className='mt-8px text-12px text-t-primary'>{step}</div>
                  </div>
                ))}
              </div>
              <div className='mt-16px border-t border-border-2 pt-14px text-12px text-t-secondary'>{meta.detail}</div>
            </section>
            <section className='rounded-14px bg-base p-18px'>
              <div className='flex items-center gap-8px text-14px font-600'>
                <Attention size={17} />
                {pt(t, 'needsAttention', '需要你处理')}
              </div>
              <div className='mt-12px text-12px leading-5 text-t-secondary'>
                {scenario === 'attention'
                  ? pt(t, 'attention.blocked', '选择费用归属部门后才能继续。')
                  : pt(t, 'attention.none', '当前没有阻塞工作的问题。')}
              </div>
              {scenario === 'attention' && (
                <Button type='primary' long className='mt-14px'>
                  {pt(t, 'action.handleNow', '现在处理')}
                </Button>
              )}
            </section>
            <section className='rounded-14px bg-base p-18px'>
              <div className='flex items-center gap-8px text-14px font-600'>
                <Lightning size={17} />
                {pt(t, 'capabilitiesAndSources', '能力与来源')}
              </div>
              <div className='mt-12px grid grid-cols-1 gap-10px sm:grid-cols-2'>
                {capabilityRows.map((row) => (
                  <div key={row.id} className='rounded-10px bg-fill-1 p-10px text-12px'>
                    <div>{pt(t, `capability.${row.id}.name`, row.name)}</div>
                    <div className='mt-3px text-10px text-t-tertiary'>
                      {row.kind} · {pt(t, `capability.${row.id}.source`, row.source)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className='rounded-14px bg-base p-18px'>
              <div className='flex items-center gap-8px text-14px font-600'>
                <FolderOpen size={17} />
                {pt(t, 'deliverablesAndFiles', '交付与文件')}
              </div>
              <div className='mt-12px rounded-10px bg-fill-1 p-10px text-12px'>
                {pt(t, 'fixture.outputFile', '费用核对结果.md')}
              </div>
              <Button long className='mt-10px'>
                {pt(t, 'action.viewWorkspace', '查看工作区')}
              </Button>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
