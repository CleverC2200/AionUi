/**
 * Fixture-only business workbenches shared by the production Surface host and
 * the settings Prototype. No backend calls and no real business mutations.
 */
import {
  Alert,
  Button,
  Drawer,
  Input,
  InputNumber,
  Pagination,
  Progress,
  Radio,
  ResizeBox,
  Select,
  Skeleton,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
} from '@arco-design/web-react';
import {
  AlarmClock,
  Attention,
  CheckOne,
  Data,
  FileText,
  History,
  Plus,
  PreviewOpen,
  Return,
  Right,
  Robot,
  Search,
  Send,
  SettingTwo,
  Shield,
  Upload,
} from '@icon-park/react';
import type { TFunction } from 'i18next';
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { AssistantSurfaceId as AgentSurfaceId } from '@renderer/pages/assistantSurface/registry';
import { readAssistantSurfaceState, writeAssistantSurfaceState } from '@renderer/pages/assistantSurface/storage';
import styles from './FixtureWorkbenches.module.css';

export type { AssistantSurfaceId as AgentSurfaceId } from '@renderer/pages/assistantSurface/registry';
export type ForecastMode = 'conversation' | 'split' | 'workbench';
export type ForecastView = 'dealers' | 'loading-skus' | 'skus';
export type ForecastFixtureState = 'ready' | 'loading' | 'empty' | 'partial' | 'permission-denied' | 'failed';

export type ForecastBoardContext = {
  view: ForecastView;
  fixtureState: ForecastFixtureState;
  scope: { planType: 'monthly'; month: '2026-09'; dealer: string; dealerCode: string };
  filters: Record<string, string | number | boolean>;
  pagination: { page: number; pageSize: number; total: number; visibleCount: number };
  visibleEntities: Array<Record<string, string | number>>;
  changes: Array<{ entityId: string; entityName: string; field: 'confirmedQty'; before: number; after: number }>;
  metrics: { targetAmount: number; confirmedAmount: number; inventory: number; adjustedCount: number };
  evidence: { source: 'fixture'; permission: 'read-only'; dataVersion: 'forecast-fixture-v1' };
};

type AgentSurfaceVariantProps = {
  agentId: AgentSurfaceId;
  onAgentChange: (agentId: AgentSurfaceId) => void;
  t: TFunction;
};

type PrototypeWorkMode = 'general' | 'business';

type WorkModeDefinition = {
  id: PrototypeWorkMode;
  name: string;
  summary: string;
};

const workModes: WorkModeDefinition[] = [
  {
    id: 'general',
    name: 'GEAUi',
    summary: 'General conversations, files, projects, and tasks.',
  },
  {
    id: 'business',
    name: 'GEA Business',
    summary: 'Enter the enterprise workbench and switch agents from the sidebar.',
  },
];

const st = (t: TFunction, key: string, defaultValue: string) =>
  t(`common.prototype.agentSurface.${key}`, { defaultValue });
const fixtureClassNames = (...values: Array<string | false | null | undefined>) =>
  values
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(/\s+/))
    .map((token) => (token === 'agent-surface-prototype' || token.startsWith('asp-') ? styles[token] : token))
    .filter(Boolean)
    .join(' ');
const WorkModeMark: React.FC<{ mode: WorkModeDefinition; size?: number }> = ({ mode, size = 16 }) => (
  <span className={fixtureClassNames('asp-agent-mark', `asp-agent-mark--${mode.id}`)} aria-hidden='true'>
    {mode.id === 'business' ? <Data size={size} /> : <Robot size={size} />}
  </span>
);

const AgentSelector: React.FC<{
  agentId: AgentSurfaceId;
  compact?: boolean;
  onAgentChange: (agentId: AgentSurfaceId) => void;
  t: TFunction;
}> = ({ agentId, compact, onAgentChange, t }) => {
  const [visible, setVisible] = useState(false);
  const location = useLocation();
  const activeMode: PrototypeWorkMode = agentId === 'general' ? 'general' : 'business';
  const activeModeDefinition = workModes.find((mode) => mode.id === activeMode) ?? workModes[0];
  const businessAvailable = new URLSearchParams(location.search).get('business') !== 'unavailable';

  const selectMode = (mode: PrototypeWorkMode) => {
    if (mode === 'business' && !businessAvailable) return;
    onAgentChange(mode === 'general' ? 'general' : agentId === 'general' ? 'forecast' : agentId);
    setVisible(false);
  };

  return (
    <>
      <Button
        type='text'
        className={fixtureClassNames('asp-agent-trigger', compact && 'asp-agent-trigger--compact')}
        aria-label={st(t, 'selector.open', '切换工作模式')}
        aria-haspopup='dialog'
        data-testid='prototype-work-mode-switcher'
        onClick={() => setVisible(true)}
      >
        <WorkModeMark mode={activeModeDefinition} />
        {!compact ? (
          <>
            <span className={fixtureClassNames('asp-agent-name')}>
              {st(t, `mode.${activeMode}.name`, activeModeDefinition.name)}
            </span>
            <Right size={13} />
          </>
        ) : null}
      </Button>
      <Drawer
        className={fixtureClassNames('asp-agent-drawer')}
        placement='left'
        width={368}
        title={st(t, 'selector.title', '切换工作模式')}
        visible={visible}
        footer={null}
        onCancel={() => setVisible(false)}
      >
        <div className='px-4px pb-10px text-12px leading-5 text-t-secondary'>
          {st(t, 'selector.description', '通用版保持现有界面；业务版在左侧菜单切换不同业务 Agent。')}
        </div>
        <div className='flex flex-col gap-8px' data-testid='prototype-work-mode-options'>
          {workModes.map((mode) => {
            const selected = mode.id === activeMode;
            const disabled = mode.id === 'business' && !businessAvailable;
            return (
              <Button
                key={mode.id}
                type='text'
                long
                className={fixtureClassNames('asp-agent-option')}
                data-active={selected}
                aria-pressed={selected}
                disabled={disabled}
                data-testid={`prototype-work-mode-option-${mode.id}`}
                onClick={() => selectMode(mode.id)}
              >
                <WorkModeMark mode={mode} size={17} />
                <span className='min-w-0 flex-1'>
                  <span className='flex min-w-0 items-center gap-7px text-13px font-650'>
                    <span className='truncate'>{st(t, `mode.${mode.id}.name`, mode.name)}</span>
                    {mode.id === 'business' && !disabled ? (
                      <Tag size='small'>{st(t, 'managed', '企业受管')}</Tag>
                    ) : null}
                    {disabled ? <Tag size='small'>{st(t, 'unavailable', '待接入')}</Tag> : null}
                  </span>
                  <span className={fixtureClassNames('asp-agent-option-summary')}>
                    {st(t, `mode.${mode.id}.summary`, mode.summary)}
                  </span>
                </span>
                <CheckOne size={17} className={fixtureClassNames(selected ? 'asp-agent-option-check' : 'invisible')} />
              </Button>
            );
          })}
        </div>
        <Alert
          className={fixtureClassNames('asp-agent-fixture-notice')}
          type='info'
          showIcon
          content={st(t, 'selector.fixture', 'Fixture 原型：不连接 GEA，不执行真实业务操作。')}
        />
      </Drawer>
    </>
  );
};

const GeneralNavButton: React.FC<{ icon: React.ReactNode; label: string; active?: boolean; badge?: string }> = ({
  icon,
  label,
  active,
  badge,
}) => (
  <Button
    type='text'
    long
    className={fixtureClassNames('asp-general-nav-item')}
    data-active={active}
    aria-pressed={active}
    icon={icon}
  >
    <span className='truncate'>{label}</span>
    {badge ? (
      <Tag className='ml-auto' size='small' color='red'>
        {badge}
      </Tag>
    ) : null}
  </Button>
);

const GeneralSurface: React.FC<{
  agentId: AgentSurfaceId;
  onAgentChange: (agentId: AgentSurfaceId) => void;
  t: TFunction;
}> = ({ agentId, onAgentChange, t }) => {
  const [message, setMessage] = useState('');
  return (
    <div className={fixtureClassNames('asp-general-shell')}>
      <aside className={fixtureClassNames('asp-general-sidebar')}>
        <div className={fixtureClassNames('asp-general-brand')}>
          <AgentSelector agentId={agentId} onAgentChange={onAgentChange} t={t} />
        </div>
        <div className={fixtureClassNames('asp-general-nav')}>
          <GeneralNavButton icon={<Plus size={16} />} label={st(t, 'general.newChat', '新会话')} />
          <GeneralNavButton icon={<Robot size={16} />} label={st(t, 'general.assistants', '助手')} active />
          <GeneralNavButton icon={<AlarmClock size={16} />} label={st(t, 'general.scheduled', '定时任务')} />
          <GeneralNavButton icon={<Attention size={16} />} label={st(t, 'general.attention', '待处理')} badge='4' />
        </div>
        <div className={fixtureClassNames('asp-general-section')}>
          <div className={fixtureClassNames('asp-general-section-title')}>
            {st(t, 'general.teams', '团队')}
            <Plus size={13} />
          </div>
          <GeneralNavButton icon={<Robot size={15} />} label='AT' />
          <GeneralNavButton icon={<Robot size={15} />} label={st(t, 'general.supplyTeam', '生产供应链协同团队')} />
        </div>
        <div className={fixtureClassNames('asp-general-section')}>
          <div className={fixtureClassNames('asp-general-section-title')}>{st(t, 'general.projects', '项目')}</div>
          <GeneralNavButton icon={<FileText size={15} />} label='openwork2' />
          <GeneralNavButton icon={<FileText size={15} />} label='openwork' />
        </div>
        <div className={fixtureClassNames('asp-general-section', 'asp-general-conversations')}>
          <div className={fixtureClassNames('asp-general-section-title')}>{st(t, 'general.conversations', '对话')}</div>
          <GeneralNavButton icon={<Robot size={15} />} label={st(t, 'general.conversationOne', '查询本月经营数据')} />
          <GeneralNavButton icon={<Robot size={15} />} label={st(t, 'general.conversationTwo', '整理需求预测差异')} />
          <GeneralNavButton icon={<Robot size={15} />} label={st(t, 'general.conversationThree', '检查项目重复文件')} />
        </div>
        <div className={fixtureClassNames('asp-general-footer')}>
          <GeneralNavButton icon={<SettingTwo size={15} />} label={st(t, 'general.settings', '设置')} />
        </div>
      </aside>
      <main className={fixtureClassNames('asp-general-main')}>
        <div className={fixtureClassNames('asp-general-center')}>
          <h1>{st(t, 'general.greeting', 'Hi，今天有什么安排？')}</h1>
          <div className={fixtureClassNames('asp-general-agent-strip')}>
            <Tag color='red'>{st(t, 'general.cli', 'GEA CLI')}</Tag>
            <span>Claude Code</span>
            <span>Codex CLI</span>
            <span>Hermes</span>
            <span>{st(t, 'general.more', '更多')}</span>
          </div>
          <div className={fixtureClassNames('asp-general-composer')}>
            <Input.TextArea
              value={message}
              autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder={st(t, 'general.placeholder', '发消息、上传文件、打开文件夹、创建定时任务，或输入命令…')}
              onChange={setMessage}
            />
            <div className={fixtureClassNames('asp-general-composer-actions')}>
              <Button type='text' shape='circle' icon={<Plus size={17} />} aria-label={st(t, 'upload', '添加文件')} />
              <span className='ml-auto text-11px text-t-secondary'>deepseek-v4-flash</span>
              <span className='text-11px text-t-secondary'>{st(t, 'general.auto', '全自动')}</span>
              <Button
                type='primary'
                shape='circle'
                icon={<Send size={15} />}
                disabled={!message.trim()}
                aria-label={st(t, 'send', '发送')}
              />
            </div>
          </div>
          <div className={fixtureClassNames('asp-general-working')}>{st(t, 'general.working', '在项目中工作')}</div>
          <div className={fixtureClassNames('asp-general-prompts')}>
            <div>{st(t, 'general.try', '试试这些指令')}</div>
            <Button type='text'>{st(t, 'general.promptOne', '了解这个项目，从哪里入手')}</Button>
            <Button type='text'>{st(t, 'general.promptTwo', '找出重复和没用的文件')}</Button>
            <Button type='text'>{st(t, 'general.promptThree', '做一个精美的个人主页')}</Button>
          </div>
        </div>
      </main>
    </div>
  );
};

type DealerRow = {
  key: string;
  name: string;
  code: string;
  forecastPct: number;
  forecastAmount: string;
  targetAmount: string;
  confirmPct: number;
  confirmAmount: string;
  inventory: string;
  turnover: string;
  age: string;
  health: 'healthy' | 'attention' | 'warning';
  analysis: string;
  missing: string;
};

const dealerRows: DealerRow[] = [
  {
    key: 'north-star',
    name: '北辰食品商贸（样例）',
    code: 'F1001001',
    forecastPct: 99.6,
    forecastAmount: '¥87,885',
    targetAmount: '¥88,197',
    confirmPct: 99.6,
    confirmAmount: '¥87,823',
    inventory: '861 件',
    turnover: '76.47 天',
    age: '39.25 天',
    health: 'warning',
    analysis: '周转偏慢，建议谨慎提报并优先关注库存。',
    missing: '当月实绩、历史提报待接入',
  },
  {
    key: 'morning',
    name: '晨星冷链商贸（样例）',
    code: 'F1001002',
    forecastPct: 99.9,
    forecastAmount: '¥37,543',
    targetAmount: '¥37,585',
    confirmPct: 99.9,
    confirmAmount: '¥37,543',
    inventory: '1 件',
    turnover: '待回填',
    age: '待回填',
    health: 'healthy',
    analysis: '当前可用健康信号不足，经营节奏平稳。',
    missing: '库存货龄、库存周转待接入',
  },
  {
    key: 'great-wall',
    name: '嘉禾冷冻商贸（样例）',
    code: 'F1001003',
    forecastPct: 99.8,
    forecastAmount: '¥111,086',
    targetAmount: '¥111,311',
    confirmPct: 99.8,
    confirmAmount: '¥111,086',
    inventory: '1,046 件',
    turnover: '29.98 天',
    age: '63.76 天',
    health: 'warning',
    analysis: '周转与货龄偏高，建议复核本次提报。',
    missing: '当月实绩、历史提报待接入',
  },
  {
    key: 'ocean',
    name: '海岳商贸（样例）',
    code: 'F1001004',
    forecastPct: 99.9,
    forecastAmount: '¥196,583',
    targetAmount: '¥196,838',
    confirmPct: 99.9,
    confirmAmount: '¥196,583',
    inventory: '2,493 件',
    turnover: '100.37 天',
    age: '64 天',
    health: 'warning',
    analysis: '库存周转明显偏慢，建议降低备货优先级。',
    missing: '历史提报待接入',
  },
  {
    key: 'river',
    name: '江城瑞隆商贸（样例）',
    code: 'F1001005',
    forecastPct: 99.6,
    forecastAmount: '¥141,862',
    targetAmount: '¥142,500',
    confirmPct: 99.6,
    confirmAmount: '¥141,862',
    inventory: '0 件',
    turnover: '待回填',
    age: '待回填',
    health: 'attention',
    analysis: '库存信号不足，建议结合客户订单人工确认。',
    missing: '库存与在途数据待接入',
  },
];

type SkuRow = {
  key: string;
  name: string;
  code: string;
  category: string;
  group: string;
  rank?: number;
  budget: number;
  forecastQty: number;
  forecastAmount: number;
  confirmedQty: number;
  inventory: number;
  age: string;
  policy: 'none' | 'promotion' | 'new-product';
  suggestion: string;
};
const skuRows: SkuRow[] = [
  {
    key: 'sku-1',
    name: '珍味三鲜薄皮小云吞（样例）',
    code: 'FSKU001',
    category: '馄饨',
    group: '薄皮小云吞',
    rank: 1,
    budget: 3717,
    forecastQty: 60,
    forecastAmount: 3717,
    confirmedQty: 59,
    inventory: 46,
    age: '20.52 天',
    policy: 'promotion',
    suggestion: '建议下调：库存覆盖偏高，优先复核近三月发货。',
  },
  {
    key: 'sku-2',
    name: '葱香味手抓饼（样例）',
    code: 'FSKU002',
    category: '饼类',
    group: '家庭装手抓饼',
    rank: 2,
    budget: 3131,
    forecastQty: 61,
    forecastAmount: 3131,
    confirmedQty: 61,
    inventory: 71,
    age: '59.03 天',
    policy: 'promotion',
    suggestion: '需复核：库存覆盖偏高，建议结合促销节奏核验。',
  },
  {
    key: 'sku-3',
    name: '小小汤圆组合装（样例）',
    code: 'FSKU003',
    category: '汤圆',
    group: '组合装汤圆',
    rank: 3,
    budget: 1538,
    forecastQty: 11,
    forecastAmount: 1538,
    confirmedQty: 11,
    inventory: 0,
    age: '待回填',
    policy: 'none',
    suggestion: '建议维持：历史达成数据待接入，暂按 AI 预测提报。',
  },
  {
    key: 'sku-4',
    name: '鲜美猪肉薄皮小云吞（样例）',
    code: 'FSKU004',
    category: '馄饨',
    group: '薄皮小云吞',
    budget: 1053,
    forecastQty: 17,
    forecastAmount: 1053,
    confirmedQty: 17,
    inventory: 27,
    age: '32.15 天',
    policy: 'new-product',
    suggestion: '已合并至同产品组的共性建议。',
  },
  {
    key: 'sku-5',
    name: '醇香黑芝麻汤圆（样例）',
    code: 'FSKU005',
    category: '汤圆',
    group: '黑芝麻汤圆',
    budget: 379,
    forecastQty: 4,
    forecastAmount: 379,
    confirmedQty: 4,
    inventory: 21,
    age: '待回填',
    policy: 'none',
    suggestion: '需复核：平均货龄与历史偏离仍待接入。',
  },
];

const MetricPair: React.FC<{
  percent?: number;
  primary: string;
  secondary: string;
  primaryLabel: string;
  secondaryLabel: string;
}> = ({ percent, primary, secondary, primaryLabel, secondaryLabel }) => (
  <div className={fixtureClassNames('asp-metric-pair')}>
    {typeof percent === 'number' ? (
      <div className={fixtureClassNames('asp-metric-progress')}>
        <Progress percent={percent} size='small' showText={false} />
        <strong>{percent}%</strong>
      </div>
    ) : (
      <strong>—</strong>
    )}
    <div className={fixtureClassNames('asp-metric-values')}>
      <span>
        {primaryLabel}
        <b>{primary}</b>
      </span>
      <span>
        {secondaryLabel}
        <b>{secondary}</b>
      </span>
    </div>
  </div>
);

const ForecastConversation: React.FC<{ stateScope: string; t: TFunction }> = ({ stateScope, t }) => {
  const [draft, setDraft] = useState(() => readAssistantSurfaceState('forecast', `${stateScope}:draft`, ''));
  useEffect(() => writeAssistantSurfaceState('forecast', `${stateScope}:draft`, draft), [draft, stateScope]);
  return (
    <section
      className={fixtureClassNames('asp-forecast-chat')}
      aria-label={st(t, 'forecast.chatRegion', '需求预测对话')}
    >
      <div className={fixtureClassNames('asp-forecast-chat-center')}>
        <h1>{st(t, 'forecast.ask', '有什么可以帮你？')}</h1>
        <div className={fixtureClassNames('asp-forecast-composer')}>
          <Button type='text' shape='circle' icon={<Plus size={18} />} aria-label={st(t, 'upload', '添加附件')} />
          <Input.TextArea
            value={draft}
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder={st(t, 'forecast.placeholder', '请输入问题，或添加图片、CSV…')}
            onChange={setDraft}
          />
          <Button type='primary' shape='circle' icon={<Send size={15} />} disabled aria-label={st(t, 'send', '发送')} />
        </div>
        <Button className={fixtureClassNames('asp-forecast-shortcut')} icon={<Data size={15} />}>
          {st(t, 'forecast.shortcut', '需求预测')} <Right size={12} />
        </Button>
      </div>
    </section>
  );
};

const ForecastHeader: React.FC<{
  agentId: AgentSurfaceId;
  mode: ForecastMode;
  onAgentChange: (agentId: AgentSurfaceId) => void;
  onModeChange: (mode: ForecastMode) => void;
  showAgentSelector?: boolean;
  t: TFunction;
}> = ({ agentId, mode, onAgentChange, onModeChange, showAgentSelector = true, t }) => (
  <header className={fixtureClassNames('asp-forecast-header')}>
    <Tooltip content={st(t, 'forecast.history', '历史对话')}>
      <Button
        type='text'
        shape='circle'
        icon={<History size={17} />}
        aria-label={st(t, 'forecast.history', '历史对话')}
      />
    </Tooltip>
    {showAgentSelector ? <AgentSelector agentId={agentId} onAgentChange={onAgentChange} t={t} /> : null}
    <Tag size='small'>{st(t, 'fixture', 'Fixture')}</Tag>
    <Radio.Group
      className={fixtureClassNames('asp-mode-switch')}
      type='button'
      value={mode}
      onChange={(value) => {
        if (value === 'conversation' || value === 'split' || value === 'workbench') onModeChange(value);
      }}
      aria-label={st(t, 'forecast.mode', '切换页面模式')}
    >
      <Radio
        value='conversation'
        aria-label={st(t, 'forecast.modeConversation', '对话全屏')}
        title={st(t, 'forecast.modeConversation', '对话全屏')}
      >
        <Robot size={16} />
      </Radio>
      <Radio
        value='split'
        aria-label={st(t, 'forecast.modeSplit', '对话与工作区双栏')}
        title={st(t, 'forecast.modeSplit', '对话与工作区双栏')}
      >
        <PreviewOpen size={16} />
      </Radio>
      <Radio
        value='workbench'
        aria-label={st(t, 'forecast.modeWorkbench', '工作区全屏')}
        title={st(t, 'forecast.modeWorkbench', '工作区全屏')}
      >
        <Data size={16} />
      </Radio>
    </Radio.Group>
  </header>
);

const ForecastWorkflow: React.FC<{ current: number; t: TFunction }> = ({ current, t }) => (
  <Steps className={fixtureClassNames('asp-forecast-steps')} current={current} size='small'>
    <Steps.Step title={st(t, 'forecast.stepDealer', '经销商数据获取')} />
    <Steps.Step title={st(t, 'forecast.stepAi', 'AI 预测生成')} />
    <Steps.Step title={st(t, 'forecast.stepPlan', '计划提报')} />
    <Steps.Step title={st(t, 'forecast.stepApproval', '提交审批')} />
  </Steps>
);

type DealerListContext = Pick<ForecastBoardContext, 'filters' | 'pagination' | 'visibleEntities'>;

const DealerQueue: React.FC<{
  onReviewSku: (dealer: DealerRow) => void;
  onContextChange?: (context: DealerListContext) => void;
  stateScope: string;
  t: TFunction;
}> = ({ onReviewSku, onContextChange, stateScope, t }) => {
  const initialListState = readAssistantSurfaceState('forecast', `${stateScope}:dealer-list`, {
    query: '',
    page: 1,
    pageSize: 10,
  });
  const [query, setQuery] = useState(initialListState.query);
  const [page, setPage] = useState(initialListState.page);
  const [pageSize, setPageSize] = useState(initialListState.pageSize);
  const filteredRows = useMemo(
    () => dealerRows.filter((row) => `${row.name}${row.code}`.toLowerCase().includes(query.toLowerCase())),
    [query]
  );
  const visibleRows = useMemo(
    () => filteredRows.slice((page - 1) * pageSize, page * pageSize),
    [filteredRows, page, pageSize]
  );
  useEffect(
    () => writeAssistantSurfaceState('forecast', `${stateScope}:dealer-list`, { query, page, pageSize }),
    [page, pageSize, query, stateScope]
  );
  useEffect(() => {
    if ((page - 1) * pageSize >= filteredRows.length) setPage(1);
  }, [filteredRows.length, page, pageSize]);
  useEffect(
    () =>
      onContextChange?.({
        filters: { dealerQuery: query },
        pagination: { page, pageSize, total: filteredRows.length, visibleCount: visibleRows.length },
        visibleEntities: visibleRows.map((row) => ({
          id: row.key,
          name: row.name,
          code: row.code,
          health: row.health,
          forecastAmount: row.forecastAmount,
          confirmAmount: row.confirmAmount,
        })),
      }),
    [filteredRows.length, onContextChange, page, pageSize, query, visibleRows]
  );
  const healthMeta = {
    healthy: { label: st(t, 'forecast.healthHealthy', '健康'), color: 'green' },
    attention: { label: st(t, 'forecast.healthAttention', '关注'), color: 'orange' },
    warning: { label: st(t, 'forecast.healthWarning', '预警'), color: 'red' },
  };
  const columns = useMemo(
    () => [
      {
        title: st(t, 'forecast.index', '序号'),
        dataIndex: 'key',
        width: 58,
        fixed: 'left' as const,
        render: (_: string, __: DealerRow, index: number) => String(index + 1).padStart(2, '0'),
      },
      {
        title: st(t, 'forecast.dealer', '经销商'),
        dataIndex: 'name',
        width: 210,
        fixed: 'left' as const,
        render: (_: string, row: DealerRow) => (
          <div className={fixtureClassNames('asp-dealer-name')}>
            <Tag size='small'>{st(t, 'forecast.unsubmitted', '未提报')}</Tag>
            <strong>{st(t, `forecast.dealer.${row.key}`, row.name)}</strong>
            <span>{row.code}</span>
          </div>
        ),
      },
      {
        title: st(t, 'forecast.forecastProgress', '预测进度'),
        width: 180,
        render: (_: unknown, row: DealerRow) => (
          <MetricPair
            percent={row.forecastPct}
            primary={row.forecastAmount}
            secondary={row.targetAmount}
            primaryLabel={st(t, 'forecast.forecastAmount', '预测金额')}
            secondaryLabel={st(t, 'forecast.targetAmount', '目标金额')}
          />
        ),
      },
      {
        title: st(t, 'forecast.confirmProgress', '确认进度'),
        width: 180,
        render: (_: unknown, row: DealerRow) => (
          <MetricPair
            percent={row.confirmPct}
            primary={row.confirmAmount}
            secondary={row.targetAmount}
            primaryLabel={st(t, 'forecast.confirmAmount', '确认金额')}
            secondaryLabel={st(t, 'forecast.targetAmount', '目标金额')}
          />
        ),
      },
      {
        title: st(t, 'forecast.achievement', '达成进度'),
        width: 150,
        render: (_: unknown, row: DealerRow) => (
          <MetricPair
            primary='—'
            secondary={row.confirmAmount}
            primaryLabel={st(t, 'forecast.achievedAmount', '达成金额')}
            secondaryLabel={st(t, 'forecast.confirmAmount', '确认金额')}
          />
        ),
      },
      {
        title: st(t, 'forecast.inventoryHealth', '库存健康'),
        width: 180,
        render: (_: unknown, row: DealerRow) => (
          <dl className={fixtureClassNames('asp-inventory-list')}>
            <div>
              <dt>{st(t, 'forecast.inventory', '当前库存')}</dt>
              <dd>{row.inventory}</dd>
            </div>
            <div>
              <dt>{st(t, 'forecast.turnover', '周转天数')}</dt>
              <dd>{row.turnover}</dd>
            </div>
            <div>
              <dt>{st(t, 'forecast.averageAge', '平均货龄')}</dt>
              <dd>{row.age}</dd>
            </div>
          </dl>
        ),
      },
      {
        title: st(t, 'forecast.healthAnalysis', '健康度分析'),
        width: 260,
        render: (_: unknown, row: DealerRow) => (
          <div className={fixtureClassNames('asp-health-analysis')}>
            <Tag size='small' color={healthMeta[row.health].color}>
              {healthMeta[row.health].label}
            </Tag>
            <p>{st(t, `forecast.analysis.${row.key}`, row.analysis)}</p>
            <span>{st(t, `forecast.missing.${row.key}`, row.missing)}</span>
          </div>
        ),
      },
      {
        title: st(t, 'forecast.action', '操作'),
        width: 110,
        fixed: 'right' as const,
        render: (_: unknown, row: DealerRow) => (
          <Button size='small' type='primary' onClick={() => onReviewSku(row)}>
            {st(t, 'forecast.reviewSku', '核对 SKU')} <Right size={12} />
          </Button>
        ),
      },
    ],
    [healthMeta, onReviewSku, t]
  );
  return (
    <section className={fixtureClassNames('asp-dealer-queue')}>
      <div className={fixtureClassNames('asp-section-toolbar')}>
        <h2>{st(t, 'forecast.dealerQueue', '经销商核对队列')}</h2>
        <Input.Search
          value={query}
          allowClear
          placeholder={st(t, 'forecast.searchDealer', '搜索经销商名称或编码')}
          onChange={setQuery}
        />
      </div>
      <Table<DealerRow>
        className={fixtureClassNames('asp-forecast-table')}
        size='small'
        rowKey='key'
        columns={columns}
        data={visibleRows}
        pagination={false}
        scroll={{ x: 1500, y: 'calc(100vh - 390px)' }}
        rowClassName={(row) => fixtureClassNames(row.health === 'warning' && 'asp-warning-row')}
        noDataElement={st(t, 'forecast.noDealer', '没有匹配的经销商')}
      />
      <div className={fixtureClassNames('asp-table-footer')}>
        <span>
          {st(
            t,
            'forecast.dealerTotal',
            `第 ${page} 页 · 显示 ${visibleRows.length} 条，共 ${filteredRows.length} 个 Fixture 经销商`
          )}
        </span>
        <Pagination
          size='small'
          current={page}
          total={filteredRows.length}
          pageSize={pageSize}
          showTotal
          sizeCanChange
          sizeOptions={[10, 20, 50, 100]}
          onChange={(nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          }}
        />
      </div>
    </section>
  );
};

const SummaryCard: React.FC<{ title: string; value: string; detail: string; tone?: 'red' | 'green' }> = ({
  title,
  value,
  detail,
  tone,
}) => (
  <div className={fixtureClassNames('asp-summary-card')}>
    <span>{title}</span>
    <strong data-tone={tone}>{value}</strong>
    <small>{detail}</small>
  </div>
);

type SkuListContext = Pick<ForecastBoardContext, 'filters' | 'pagination' | 'visibleEntities' | 'changes'>;

const SkuReview: React.FC<{
  onBack: () => void;
  onContextChange?: (context: SkuListContext) => void;
  stateScope: string;
  t: TFunction;
}> = ({ onBack, onContextChange, stateScope, t }) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [policy, setPolicy] = useState('all');
  const [adjustedOnly, setAdjustedOnly] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    readAssistantSurfaceState(
      'forecast',
      `${stateScope}:sku-quantities`,
      Object.fromEntries(skuRows.map((row) => [row.key, row.confirmedQty]))
    )
  );
  useEffect(
    () => writeAssistantSurfaceState('forecast', `${stateScope}:sku-quantities`, quantities),
    [quantities, stateScope]
  );
  const adjustedCount = skuRows.filter((row) => quantities[row.key] !== row.confirmedQty).length;
  const rows = useMemo(
    () =>
      skuRows.filter(
        (row) =>
          `${row.name}${row.code}`.toLowerCase().includes(query.toLowerCase()) &&
          (category === 'all' || row.category === category) &&
          (policy === 'all' || row.policy === policy) &&
          (!adjustedOnly || quantities[row.key] !== row.confirmedQty)
      ),
    [adjustedOnly, category, policy, quantities, query]
  );
  const changes = useMemo(
    () =>
      skuRows
        .filter((row) => quantities[row.key] !== row.confirmedQty)
        .map((row) => ({
          entityId: row.key,
          entityName: row.name,
          field: 'confirmedQty' as const,
          before: row.confirmedQty,
          after: quantities[row.key],
        })),
    [quantities]
  );
  useEffect(
    () =>
      onContextChange?.({
        filters: { skuQuery: query, category, policy, adjustedOnly },
        pagination: { page: 1, pageSize: 10, total: rows.length, visibleCount: rows.length },
        visibleEntities: rows.map((row) => ({
          id: row.key,
          name: row.name,
          code: row.code,
          forecastQty: row.forecastQty,
          confirmedQty: quantities[row.key],
          inventory: row.inventory,
        })),
        changes,
      }),
    [adjustedOnly, category, changes, onContextChange, policy, quantities, query, rows]
  );
  const columns = useMemo(
    () => [
      {
        title: st(t, 'forecast.skuProduct', 'SKU / 产品'),
        dataIndex: 'name',
        width: 260,
        fixed: 'left' as const,
        render: (_: string, row: SkuRow) => (
          <div className={fixtureClassNames('asp-sku-name')}>
            {row.rank ? (
              <Tag color='gold' size='small'>
                TOP {row.rank}
              </Tag>
            ) : null}
            <strong>{st(t, `forecast.sku.${row.key}`, row.name)}</strong>
            <span>
              {row.code} · {row.category} · {row.group}
            </span>
          </div>
        ),
      },
      {
        title: st(t, 'forecast.targetBudget', '目标预算'),
        dataIndex: 'budget',
        width: 110,
        sorter: (a: SkuRow, b: SkuRow) => a.budget - b.budget,
        render: (value: number) => `¥${value.toLocaleString()}`,
      },
      {
        title: st(t, 'forecast.aiForecast', 'AI预测量/金额'),
        width: 150,
        sorter: (a: SkuRow, b: SkuRow) => a.forecastQty - b.forecastQty,
        render: (_: unknown, row: SkuRow) => (
          <div className={fixtureClassNames('asp-number-stack')}>
            <strong>{row.forecastQty}</strong>
            <span>¥{row.forecastAmount.toLocaleString()}</span>
          </div>
        ),
      },
      {
        title: st(t, 'forecast.confirmPlan', '确认计划量/金额'),
        width: 170,
        sorter: (a: SkuRow, b: SkuRow) => quantities[a.key] - quantities[b.key],
        render: (_: unknown, row: SkuRow) => (
          <div className={fixtureClassNames('asp-confirm-cell')}>
            <InputNumber
              size='small'
              min={0}
              value={quantities[row.key]}
              onChange={(value) => setQuantities((current) => ({ ...current, [row.key]: value }))}
            />
            <span>
              {quantities[row.key] === row.confirmedQty
                ? st(t, 'forecast.sourceAi', '来源：AI 预测')
                : st(t, 'forecast.sourceManual', '来源：本地调整')}
            </span>
          </div>
        ),
      },
      {
        title: st(t, 'forecast.actualShipment', '达成量/确认量'),
        width: 130,
        render: () => (
          <span className='text-11px text-t-tertiary'>{st(t, 'forecast.actualPending', '实际发货未回填')}</span>
        ),
      },
      {
        title: st(t, 'forecast.quantityGap', '数量偏差'),
        width: 95,
        render: (_: unknown, row: SkuRow) => quantities[row.key] - row.forecastQty,
      },
      {
        title: st(t, 'forecast.amountGap', '金额偏差'),
        width: 105,
        render: (_: unknown, row: SkuRow) => {
          const unit = row.forecastAmount / row.forecastQty;
          const gap = Math.round((quantities[row.key] - row.forecastQty) * unit);
          return `${gap < 0 ? '-' : ''}¥${Math.abs(gap).toLocaleString()}`;
        },
      },
      {
        title: st(t, 'forecast.inventory', '当前库存'),
        dataIndex: 'inventory',
        width: 95,
        sorter: (a: SkuRow, b: SkuRow) => a.inventory - b.inventory,
      },
      { title: st(t, 'forecast.averageAge', '平均货龄'), dataIndex: 'age', width: 100 },
      {
        title: st(t, 'forecast.policy', '政策'),
        dataIndex: 'policy',
        width: 95,
        render: (value: SkuRow['policy']) =>
          value === 'none'
            ? st(t, 'forecast.policyNone', '未提供')
            : value === 'promotion'
              ? st(t, 'forecast.policyPromotion', '促销支持')
              : st(t, 'forecast.policyNewProduct', '新品支持'),
      },
      {
        title: st(t, 'forecast.aiSuggestion', 'AI 建议'),
        dataIndex: 'suggestion',
        width: 280,
        render: (value: string, row: SkuRow) => (
          <p className={fixtureClassNames('asp-ai-suggestion')}>{st(t, `forecast.suggestion.${row.key}`, value)}</p>
        ),
      },
    ],
    [quantities, t]
  );
  return (
    <section className={fixtureClassNames('asp-sku-review')}>
      <div className={fixtureClassNames('asp-summary-grid')}>
        <SummaryCard
          title={st(t, 'forecast.monthTarget', '月度经营目标')}
          value='¥88,197'
          detail={st(t, 'forecast.targetDetail', '确认计划 ¥87,823 · 差额 -¥374')}
          tone='red'
        />
        <SummaryCard
          title={st(t, 'forecast.targetAchievement', '目标达成')}
          value='—'
          detail={st(t, 'forecast.actualMonthPending', '该月仅显示预测，实绩待月结回填')}
        />
        <SummaryCard
          title={st(t, 'forecast.planAchievementQty', '计划达成量')}
          value='—'
          detail={st(t, 'forecast.confirmQtyDetail', '确认计划量 1,074 件')}
        />
        <SummaryCard
          title={st(t, 'forecast.currentInventory', '当前库存')}
          value='861 件'
          detail={st(t, 'forecast.inventoryDetail', '周转 83.26 天 · 平均货龄 41.44 天')}
        />
      </div>
      <div className={fixtureClassNames('asp-sku-toolbar')}>
        <div className={fixtureClassNames('asp-sku-toolbar-title')}>{st(t, 'forecast.skuReview', 'SKU 核对')}</div>
        <Button
          size='small'
          type={adjustedOnly ? 'primary' : 'outline'}
          status={adjustedCount ? 'danger' : 'default'}
          onClick={() => setAdjustedOnly((value) => !value)}
        >
          {st(t, 'forecast.adjusted', `已调整 ${adjustedCount} 条`)}
        </Button>
        <Input.Search
          value={query}
          allowClear
          placeholder={st(t, 'forecast.searchSku', '搜索 SKU 编码或名称')}
          onChange={setQuery}
        />
        <Select
          size='small'
          value={category}
          onChange={(value) => setCategory(String(value))}
          options={[
            { label: st(t, 'forecast.allCategories', '全部品类'), value: 'all' },
            { label: '馄饨', value: '馄饨' },
            { label: '饼类', value: '饼类' },
            { label: '汤圆', value: '汤圆' },
          ]}
        />
        <Select
          size='small'
          value={policy}
          onChange={(value) => setPolicy(String(value))}
          options={[
            { label: st(t, 'forecast.allPolicies', '全部政策'), value: 'all' },
            { label: st(t, 'forecast.policyPromotion', '促销支持'), value: 'promotion' },
            { label: st(t, 'forecast.policyNewProduct', '新品支持'), value: 'new-product' },
            { label: st(t, 'forecast.policyNone', '未提供'), value: 'none' },
          ]}
        />
        <Tooltip content={st(t, 'forecast.prototypeNoUpload', '原型不执行文件操作')}>
          <Button size='small' disabled>
            {st(t, 'forecast.downloadTemplate', '下载模板')}
          </Button>
        </Tooltip>
        <Tooltip content={st(t, 'forecast.prototypeNoUpload', '原型不执行文件操作')}>
          <Button size='small' disabled>
            {st(t, 'forecast.uploadBackfill', '上传回填')}
          </Button>
        </Tooltip>
      </div>
      {adjustedCount ? (
        <Alert
          type='warning'
          showIcon
          content={st(
            t,
            'forecast.localDraft',
            `已产生 ${adjustedCount} 条本地 Fixture 调整；切换 Agent 不会提交或丢弃。`
          )}
        />
      ) : null}
      <div className={fixtureClassNames('asp-filter-summary')}>
        <span>
          <small>{st(t, 'forecast.filteredSku', '当前筛选 SKU')}</small>
          <strong>{rows.length} 个</strong>
        </span>
        <span>
          <small>{st(t, 'forecast.targetBudget', '目标预算')}</small>
          <strong>¥{rows.reduce((sum, row) => sum + row.budget, 0).toLocaleString()}</strong>
        </span>
        <span>
          <small>{st(t, 'forecast.aiForecastAmount', 'AI 预测金额')}</small>
          <strong>¥{rows.reduce((sum, row) => sum + row.forecastAmount, 0).toLocaleString()}</strong>
        </span>
        <span>
          <small>{st(t, 'forecast.confirmPlanAmount', '确认计划金额')}</small>
          <strong>¥11,420</strong>
        </span>
        <Button className='ml-auto' type='text' size='small'>
          {st(t, 'forecast.collapseSummary', '收起汇总')}
        </Button>
      </div>
      <div className={fixtureClassNames('asp-sku-table-title')}>
        <strong>{st(t, 'forecast.skuDetail', 'SKU 明细')}</strong>
        <span>{st(t, 'forecast.skuCount', '第 1 页 · 共 67 个 SKU')}</span>
      </div>
      <Table<SkuRow>
        className={fixtureClassNames('asp-forecast-table')}
        size='small'
        rowKey='key'
        columns={columns}
        data={rows}
        pagination={false}
        scroll={{ x: 1575, y: 'calc(100vh - 520px)' }}
        noDataElement={st(t, 'forecast.noSku', '没有匹配的 SKU')}
      />
      <div className={fixtureClassNames('asp-table-footer')}>
        <span>{st(t, 'forecast.skuTotal', '第 1 / 7 页 · 显示 1–5 条，共 67 个 SKU')}</span>
        <Pagination size='small' current={1} total={67} pageSize={10} />
      </div>
      <Button className={fixtureClassNames('asp-mobile-back')} icon={<Return size={14} />} onClick={onBack}>
        {st(t, 'forecast.backDealers', '返回经销商列表')}
      </Button>
    </section>
  );
};

export const ForecastWorkbench: React.FC<{
  view: ForecastView;
  onViewChange: (view: ForecastView) => void;
  onContextChange?: (context: ForecastBoardContext) => void;
  stateScope: string;
  t: TFunction;
  showWorkflow?: boolean;
}> = ({ view, onViewChange, onContextChange, stateScope, t, showWorkflow = true }) => {
  const [fixtureState, setFixtureState] = useState<ForecastFixtureState>(() =>
    readAssistantSurfaceState('forecast', `${stateScope}:fixture-state`, 'ready')
  );
  useEffect(
    () => writeAssistantSurfaceState('forecast', `${stateScope}:fixture-state`, fixtureState),
    [fixtureState, stateScope]
  );
  const [selectedDealer, setSelectedDealer] = useState(dealerRows[0]);
  const [dealerContext, setDealerContext] = useState<DealerListContext>({
    filters: { dealerQuery: '' },
    pagination: { page: 1, pageSize: 10, total: dealerRows.length, visibleCount: dealerRows.length },
    visibleEntities: dealerRows.map((row) => ({
      id: row.key,
      name: row.name,
      code: row.code,
      health: row.health,
      forecastAmount: row.forecastAmount,
      confirmAmount: row.confirmAmount,
    })),
  });
  const [skuContext, setSkuContext] = useState<SkuListContext>({
    filters: { skuQuery: '', category: 'all', policy: 'all', adjustedOnly: false },
    pagination: { page: 1, pageSize: 10, total: skuRows.length, visibleCount: skuRows.length },
    visibleEntities: skuRows.map((row) => ({
      id: row.key,
      name: row.name,
      code: row.code,
      forecastQty: row.forecastQty,
      confirmedQty: row.confirmedQty,
    })),
    changes: [],
  });
  useEffect(() => {
    const activeContext = view === 'skus' ? skuContext : dealerContext;
    onContextChange?.({
      view,
      fixtureState,
      scope: {
        planType: 'monthly',
        month: '2026-09',
        dealer: selectedDealer.name,
        dealerCode: selectedDealer.code,
      },
      filters: activeContext.filters,
      pagination: activeContext.pagination,
      visibleEntities: activeContext.visibleEntities,
      changes: view === 'skus' ? skuContext.changes : [],
      metrics: {
        targetAmount: 88197,
        confirmedAmount: 87823,
        inventory: 861,
        adjustedCount: view === 'skus' ? skuContext.changes.length : 0,
      },
      evidence: { source: 'fixture', permission: 'read-only', dataVersion: 'forecast-fixture-v1' },
    });
  }, [dealerContext, fixtureState, onContextChange, selectedDealer, skuContext, view]);
  const dealerContent =
    fixtureState === 'loading' ? (
      <div className={fixtureClassNames('asp-sku-loading')}>
        <Skeleton animation text={{ rows: 7 }} />
        <span>{st(t, 'forecast.loadingDealers', '正在读取经销商数据…')}</span>
      </div>
    ) : fixtureState === 'empty' ? (
      <Alert type='info' showIcon content={st(t, 'forecast.emptyDealers', '当前计划条件下没有经销商数据。')} />
    ) : fixtureState === 'permission-denied' ? (
      <Alert
        type='error'
        showIcon
        content={st(t, 'forecast.permissionDenied', '当前账号没有读取需求预测数据的权限。')}
      />
    ) : fixtureState === 'failed' ? (
      <Alert
        type='error'
        showIcon
        content={st(t, 'forecast.failed', '经销商数据读取失败；Fixture 不会自动无限重试。')}
        action={
          <Button size='small' onClick={() => setFixtureState('ready')}>
            {st(t, 'retry', '重试')}
          </Button>
        }
      />
    ) : (
      <>
        {fixtureState === 'partial' ? (
          <Alert
            type='warning'
            showIcon
            content={st(t, 'forecast.partial', '当前为部分结果：库存健康字段尚未完整返回。')}
          />
        ) : null}
        <DealerQueue
          t={t}
          stateScope={stateScope}
          onContextChange={setDealerContext}
          onReviewSku={(dealer) => {
            setSelectedDealer(dealer);
            onViewChange('loading-skus');
          }}
        />
      </>
    );

  return (
    <main
      className={fixtureClassNames('asp-forecast-workbench')}
      aria-label={st(t, 'forecast.workbenchRegion', '需求预测工作台')}
    >
      <div className={fixtureClassNames('asp-forecast-toolbar')}>
        <div className={fixtureClassNames('asp-workbench-title')}>{st(t, 'forecast.salesPlan', '销售计划提报')}</div>
        {view === 'skus' ? (
          <Button size='small' icon={<Return size={13} />} onClick={() => onViewChange('dealers')}>
            {st(t, 'forecast.backDealers', '返回经销商列表')}
          </Button>
        ) : null}
        <Tooltip content={st(t, 'forecast.prototypeNoSubmit', 'Fixture 原型不执行提交')}>
          <Button size='small' type='primary' disabled>
            {st(t, 'forecast.submit', '提交')}
          </Button>
        </Tooltip>
        <Radio.Group
          className={fixtureClassNames('asp-plan-type')}
          type='button'
          size='small'
          value='monthly'
          options={[
            { label: st(t, 'forecast.monthlyPlan', '月初计划'), value: 'monthly' },
            { label: st(t, 'forecast.correctionPlan', '纠偏计划'), value: 'correction', disabled: true },
          ]}
        />
        <Select
          size='small'
          value='fixture-dealer'
          options={[{ label: st(t, 'forecast.currentDealer', '北辰食品商贸（样例）'), value: 'fixture-dealer' }]}
        />
        <Select
          size='small'
          value='2026-09'
          options={[
            { label: st(t, 'forecast.month.september', '2026 年 9 月'), value: '2026-09' },
            { label: st(t, 'forecast.month.august', '2026 年 8 月'), value: '2026-08' },
          ]}
        />
        <Select
          className={fixtureClassNames('asp-fixture-state-select')}
          size='small'
          value={fixtureState}
          aria-label={st(t, 'forecast.fixtureState', 'Fixture 数据状态')}
          onChange={(value) => setFixtureState(value as ForecastFixtureState)}
          options={[
            { label: st(t, 'forecast.stateReady', '完整数据'), value: 'ready' },
            { label: st(t, 'forecast.stateLoading', '加载中'), value: 'loading' },
            { label: st(t, 'forecast.stateEmpty', '空数据'), value: 'empty' },
            { label: st(t, 'forecast.statePartial', '部分结果'), value: 'partial' },
            { label: st(t, 'forecast.statePermission', '无权限'), value: 'permission-denied' },
            { label: st(t, 'forecast.stateFailed', '读取失败'), value: 'failed' },
          ]}
        />
      </div>
      {showWorkflow ? <ForecastWorkflow current={view === 'skus' ? 2 : 1} t={t} /> : null}
      <div className={fixtureClassNames('asp-workbench-body')}>
        {view === 'dealers' ? dealerContent : null}
        {view === 'loading-skus' ? (
          <div className={fixtureClassNames('asp-sku-loading')}>
            <Skeleton animation text={{ rows: 7 }} />
            <span>{st(t, 'forecast.loadingSku', '正在读取 SKU 明细…')}</span>
          </div>
        ) : null}
        {view === 'skus' ? (
          <SkuReview
            t={t}
            stateScope={stateScope}
            onContextChange={setSkuContext}
            onBack={() => onViewChange('dealers')}
          />
        ) : null}
      </div>
    </main>
  );
};

export const ForecastBoard: React.FC<{
  stateScope: string;
  t: TFunction;
  onContextChange: (context: ForecastBoardContext) => void;
  showWorkflow?: boolean;
}> = ({ stateScope, t, onContextChange, showWorkflow = true }) => {
  const [view, setView] = useState<ForecastView>(() => {
    const stored = readAssistantSurfaceState<ForecastView>('forecast', `${stateScope}:board-view`, 'dealers');
    return stored === 'loading-skus' ? 'dealers' : stored;
  });
  useEffect(() => writeAssistantSurfaceState('forecast', `${stateScope}:board-view`, view), [stateScope, view]);
  useEffect(() => {
    if (view !== 'loading-skus') return undefined;
    const timer = window.setTimeout(() => setView('skus'), 450);
    return () => window.clearTimeout(timer);
  }, [view]);

  return (
    <ForecastWorkbench
      view={view}
      onViewChange={setView}
      onContextChange={onContextChange}
      stateScope={stateScope}
      t={t}
      showWorkflow={showWorkflow}
    />
  );
};

const ForecastSplitHandle: React.FC<{
  onRatioChange: React.Dispatch<React.SetStateAction<number>>;
  t: TFunction;
}> = ({ onRatioChange, t }) => (
  <Button
    type='text'
    size='mini'
    className={fixtureClassNames('asp-split-keyboard-handle')}
    aria-label={st(t, 'forecast.resize', '调整对话与工作区宽度')}
    onKeyDown={(event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      onRatioChange((current) => Math.min(0.58, Math.max(0.25, current + (event.key === 'ArrowLeft' ? -0.04 : 0.04))));
    }}
  >
    <span aria-hidden='true'>⋮</span>
  </Button>
);

export const ForecastSurface: React.FC<{
  agentId: AgentSurfaceId;
  initialMode: ForecastMode;
  onAgentChange: (agentId: AgentSurfaceId) => void;
  t: TFunction;
  onStateChange: (state: string) => void;
  showAgentSelector?: boolean;
  stateScope?: string;
}> = ({
  agentId,
  initialMode,
  onAgentChange,
  t,
  onStateChange,
  showAgentSelector = true,
  stateScope = 'prototype',
}) => {
  const initialSnapshot = readAssistantSurfaceState<{ mode: ForecastMode; view: ForecastView; splitRatio: number }>(
    'forecast',
    `${stateScope}:workspace`,
    {
      mode: initialMode,
      view: 'dealers',
      splitRatio: 0.38,
    }
  );
  const [mode, setMode] = useState<ForecastMode>(initialSnapshot.mode);
  const [view, setView] = useState<ForecastView>(
    initialSnapshot.view === 'loading-skus' ? 'dealers' : initialSnapshot.view
  );
  const [splitRatio, setSplitRatio] = useState(initialSnapshot.splitRatio);
  useEffect(() => {
    if (view !== 'loading-skus') return undefined;
    const timer = window.setTimeout(() => setView('skus'), 650);
    return () => window.clearTimeout(timer);
  }, [view]);
  useEffect(() => onStateChange(`mode=${mode} · view=${view}`), [mode, onStateChange, view]);
  useEffect(
    () =>
      writeAssistantSurfaceState('forecast', `${stateScope}:workspace`, {
        mode,
        view,
        splitRatio,
      }),
    [mode, splitRatio, stateScope, view]
  );
  return (
    <div className={fixtureClassNames('asp-forecast-surface')}>
      <ForecastHeader
        agentId={agentId}
        mode={mode}
        onAgentChange={onAgentChange}
        onModeChange={setMode}
        showAgentSelector={showAgentSelector}
        t={t}
      />
      <div className={fixtureClassNames('asp-forecast-content')} data-mode={mode}>
        <ResizeBox.Split
          className={fixtureClassNames('asp-forecast-split')}
          direction='horizontal'
          size={splitRatio}
          min='320px'
          max='58%'
          panes={[
            <ForecastConversation key='chat' stateScope={stateScope} t={t} />,
            <ForecastWorkbench key='workbench' view={view} onViewChange={setView} stateScope={stateScope} t={t} />,
          ]}
          trigger={<ForecastSplitHandle onRatioChange={setSplitRatio} t={t} />}
          onMoving={(_event, value) => {
            if (typeof value === 'number') setSplitRatio(value);
          }}
        />
      </div>
    </div>
  );
};

type ContractClauseId = 'payment' | 'liability' | 'privacy';
export type ContractBoardContext = {
  selectedClause: ContractClauseId;
  selectedClauseTitle: string;
  severity: string;
  reviewState: Record<ContractClauseId, 'pending' | 'accepted' | 'retained'>;
  resolved: number;
  evidence: { source: 'fixture'; permission: 'read-only'; dataVersion: 'contract-fixture-v1' };
};
const contractClauses: Array<{
  id: ContractClauseId;
  title: string;
  severity: string;
  color: string;
  summary: string;
  issue: string;
  detail: string;
  suggestion: string;
}> = [
  {
    id: 'payment',
    title: '4.2 付款条件',
    severity: '高风险',
    color: 'red',
    summary: '当前条款与 Fixture 采购基线存在差异。',
    issue: '逾期付款责任单向免除',
    detail: '建议增加合理逾期责任，并保留连续逾期后的恢复动作。',
    suggestion: '采购方逾期超过十五个工作日的，应承担双方约定的逾期责任。',
  },
  {
    id: 'liability',
    title: '7.1 违约责任',
    severity: '需确认',
    color: 'orange',
    summary: '当前责任范围缺少累计赔偿上限。',
    issue: '供应商责任上限缺失',
    detail: '建议设置累计责任上限，但故意或重大过失除外。',
    suggestion: '除故意或重大过失外，累计责任不超过最近十二个月已支付合同金额。',
  },
  {
    id: 'privacy',
    title: '9.3 数据与保密',
    severity: '已通过',
    color: 'green',
    summary: '当前条款符合 Fixture 数据与保密基线。',
    issue: '处理范围和保密义务完整',
    detail: '未发现需要人工处理的明显差异。',
    suggestion: '保留原文，并在最终意见中记录本条已通过。',
  },
];

export const ContractSurface: React.FC<{
  agentId: AgentSurfaceId;
  onAgentChange: (agentId: AgentSurfaceId) => void;
  t: TFunction;
  onStateChange: (state: string) => void;
  showAgentSelector?: boolean;
  stateScope?: string;
  onContextChange?: (context: ContractBoardContext) => void;
}> = ({
  agentId,
  onAgentChange,
  t,
  onStateChange,
  showAgentSelector = true,
  stateScope = 'prototype',
  onContextChange,
}) => {
  const initialSnapshot = readAssistantSurfaceState<{
    selectedClause: ContractClauseId;
    reviewState: Record<ContractClauseId, 'pending' | 'accepted' | 'retained'>;
  }>('contract', `${stateScope}:workspace`, {
    selectedClause: 'payment',
    reviewState: { payment: 'pending', liability: 'pending', privacy: 'accepted' },
  });
  const [selectedClause, setSelectedClause] = useState<ContractClauseId>(initialSnapshot.selectedClause);
  const [reviewState, setReviewState] = useState<Record<ContractClauseId, 'pending' | 'accepted' | 'retained'>>(
    initialSnapshot.reviewState
  );
  const activeClause = contractClauses.find((clause) => clause.id === selectedClause) ?? contractClauses[0];
  const resolved = Object.values(reviewState).filter((state) => state !== 'pending').length;
  useEffect(
    () => onStateChange(`clause=${selectedClause} · resolved=${resolved}/3`),
    [onStateChange, resolved, selectedClause]
  );
  useEffect(
    () => writeAssistantSurfaceState('contract', `${stateScope}:workspace`, { selectedClause, reviewState }),
    [reviewState, selectedClause, stateScope]
  );
  useEffect(
    () =>
      onContextChange?.({
        selectedClause,
        selectedClauseTitle: activeClause.title,
        severity: activeClause.severity,
        reviewState,
        resolved,
        evidence: { source: 'fixture', permission: 'read-only', dataVersion: 'contract-fixture-v1' },
      }),
    [activeClause.severity, activeClause.title, onContextChange, resolved, reviewState, selectedClause]
  );
  return (
    <div className={fixtureClassNames('asp-contract-surface')}>
      <header className={fixtureClassNames('asp-contract-header')}>
        {showAgentSelector ? <AgentSelector agentId={agentId} onAgentChange={onAgentChange} t={t} /> : null}
        <Tag color='blue'>{st(t, 'contract.fixture', 'Fixture 审查')}</Tag>
        <Select
          size='small'
          className={fixtureClassNames('asp-contract-clause-select')}
          aria-label={st(t, 'contract.selectClause', '选择风险条款')}
          value={selectedClause}
          options={contractClauses.map((clause) => ({
            label: st(t, `contract.clause.${clause.id}.title`, clause.title),
            value: clause.id,
          }))}
          onChange={(value) => setSelectedClause(value as ContractClauseId)}
        />
        <Tag data-testid='contract-active-review-state'>
          {reviewState[selectedClause] === 'accepted'
            ? st(t, 'contract.accepted', '已采纳')
            : reviewState[selectedClause] === 'retained'
              ? st(t, 'contract.retained', '保留原文')
              : st(t, 'contract.pending', '待处理')}
        </Tag>
        <span className={fixtureClassNames('asp-contract-progress')}>
          {st(t, 'contract.progress', `已处理 ${resolved} / 3 条`)}
        </span>
        <Tooltip content={st(t, 'contract.prototypeNoFile', '原型不读取真实文件')}>
          <Button size='small' icon={<Upload size={14} />} disabled>
            {st(t, 'contract.replace', '替换文件')}
          </Button>
        </Tooltip>
        <Tooltip content={st(t, 'contract.prototypeNoExport', '原型不形成真实审阅结果')}>
          <Button size='small' type='primary' disabled>
            {st(t, 'contract.export', '形成审阅意见')}
          </Button>
        </Tooltip>
      </header>
      <Alert
        banner
        type='info'
        content={st(
          t,
          'contract.evidenceGap',
          '当前内容为脱敏 Fixture；在取得真实合同 Agent 页面前，字段、动作和风险规则不作为生产事实。'
        )}
      />
      <div className={fixtureClassNames('asp-contract-layout')}>
        <aside className={fixtureClassNames('asp-contract-nav')}>
          <div className={fixtureClassNames('asp-pane-heading')}>
            <span>{st(t, 'contract.documents', '审查文档')}</span>
            <Search size={14} />
          </div>
          <Button
            type='text'
            long
            className={fixtureClassNames('asp-document-row')}
            data-active='true'
            aria-pressed={true}
          >
            <FileText size={16} />
            <span>
              <strong>{st(t, 'contract.documentName', '采购框架协议（样例）.docx')}</strong>
              <small>{st(t, 'contract.documentStatus', '28 页 · 已读取 · Fixture')}</small>
            </span>
          </Button>
          <div className={fixtureClassNames('asp-contract-summary')}>
            <span>
              <small>{st(t, 'contract.pages', '页数')}</small>
              <strong>28</strong>
            </span>
            <span>
              <small>{st(t, 'contract.risks', '风险')}</small>
              <strong>3</strong>
            </span>
            <span>
              <small>{st(t, 'contract.resolved', '已处理')}</small>
              <strong>{resolved}</strong>
            </span>
          </div>
          <div className={fixtureClassNames('asp-pane-heading')}>
            <span>{st(t, 'contract.outline', '风险条款')}</span>
            <Tag size='small' color='red'>
              3
            </Tag>
          </div>
          <div className={fixtureClassNames('asp-clause-list')}>
            {contractClauses.map((clause) => (
              <Button
                key={clause.id}
                type='text'
                long
                className={fixtureClassNames('asp-clause-row')}
                data-active={selectedClause === clause.id}
                aria-pressed={selectedClause === clause.id}
                onClick={() => setSelectedClause(clause.id)}
              >
                <Shield size={15} />
                <span>
                  <strong>{st(t, `contract.clause.${clause.id}.title`, clause.title)}</strong>
                  <span>
                    <Tag size='small' color={clause.color}>
                      {st(t, `contract.clause.${clause.id}.severity`, clause.severity)}
                    </Tag>
                    {reviewState[clause.id] !== 'pending' ? (
                      <Tag size='small'>
                        {reviewState[clause.id] === 'accepted'
                          ? st(t, 'contract.accepted', '已采纳')
                          : st(t, 'contract.retained', '保留原文')}
                      </Tag>
                    ) : null}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        </aside>
        <main className={fixtureClassNames('asp-document-canvas')}>
          <article className={fixtureClassNames('asp-document-sheet')}>
            <div className={fixtureClassNames('asp-document-title')}>
              <div>
                <h1>{st(t, 'contract.documentTitle', '采购框架协议')}</h1>
                <span>{st(t, 'contract.documentPage', 'Fixture 文档 · 第 4 / 28 页')}</span>
              </div>
              <Button type='text' icon={<PreviewOpen size={16} />}>
                {st(t, 'contract.original', '查看原文')}
              </Button>
            </div>
            <div className={fixtureClassNames('asp-contract-copy')}>
              <h2>{st(t, 'contract.copy.paymentTitle', '第四条 付款与结算')}</h2>
              <p>
                {st(
                  t,
                  'contract.copy.paymentOne',
                  '4.1 双方按照已确认订单及验收结果进行结算，供应商应提供合法有效的结算材料。'
                )}
              </p>
              <p>
                {st(t, 'contract.copy.paymentTwo', '4.2 采购方应在收到完整结算材料后六十个工作日内支付相应款项。')}{' '}
                {selectedClause === 'payment' ? (
                  <mark>{st(t, 'contract.copy.paymentRisk', '采购方不承担任何逾期责任。')}</mark>
                ) : null}
              </p>
              <p>
                {st(
                  t,
                  'contract.copy.paymentThree',
                  '4.3 结算材料存在缺失或数据不一致时，付款期限自补正材料确认之日起重新计算。'
                )}
              </p>
              <h2>{st(t, 'contract.copy.liabilityTitle', '第七条 违约责任')}</h2>
              <p>
                {st(t, 'contract.copy.liabilityOne', '7.1 任一方违反本协议约定，应赔偿守约方因此产生的实际损失。')}{' '}
                {selectedClause === 'liability' ? (
                  <mark>{st(t, 'contract.copy.liabilityRisk', '供应商承担的累计责任不受合同金额限制。')}</mark>
                ) : null}
              </p>
              <h2>{st(t, 'contract.copy.privacyTitle', '第九条 数据与保密')}</h2>
              <p>
                {st(
                  t,
                  'contract.copy.privacyOne',
                  '9.3 双方仅在履行本协议所需范围内处理业务数据，并持续承担保密义务。'
                )}{' '}
                {selectedClause === 'privacy' ? (
                  <mark data-passed='true'>
                    {st(t, 'contract.copy.privacyPassed', '处理目的、范围和保密期限符合 Fixture 基线。')}
                  </mark>
                ) : null}
              </p>
            </div>
          </article>
        </main>
        <aside className={fixtureClassNames('asp-risk-panel')}>
          <div className={fixtureClassNames('asp-risk-heading')}>
            <Attention size={16} />
            <div>
              <strong>{st(t, 'contract.riskTitle', '审阅意见')}</strong>
              <span>{st(t, `contract.clause.${activeClause.id}.summary`, activeClause.summary)}</span>
            </div>
          </div>
          <div className={fixtureClassNames('asp-risk-item')}>
            <Tag color={activeClause.color}>
              {st(t, `contract.clause.${activeClause.id}.severity`, activeClause.severity)}
            </Tag>
            <h3>{st(t, `contract.clause.${activeClause.id}.issue`, activeClause.issue)}</h3>
            <p>{st(t, `contract.clause.${activeClause.id}.detail`, activeClause.detail)}</p>
          </div>
          <div className={fixtureClassNames('asp-risk-evidence')}>
            <span>{st(t, 'contract.evidence', '判断依据')}</span>
            <ul>
              <li>{st(t, 'contract.evidenceOne', 'Fixture 企业采购合同基线 v1.2')}</li>
              <li>{st(t, 'contract.evidenceTwo', '命中原文与建议均为脱敏演示')}</li>
            </ul>
          </div>
          <div className={fixtureClassNames('asp-risk-item')}>
            <label>
              {activeClause.id === 'privacy'
                ? st(t, 'contract.reviewConclusion', '审阅结论')
                : st(t, 'contract.suggestion', '建议修改为')}
            </label>
            <Input.TextArea
              key={activeClause.id}
              autoSize={{ minRows: 5, maxRows: 8 }}
              defaultValue={st(t, `contract.clause.${activeClause.id}.suggestion`, activeClause.suggestion)}
            />
          </div>
          <Space className={fixtureClassNames('asp-full-width-stack', 'mt-auto', 'pt-12px')} direction='vertical'>
            <Button
              type='primary'
              long
              onClick={() => setReviewState((current) => ({ ...current, [activeClause.id]: 'accepted' }))}
            >
              {activeClause.id === 'privacy'
                ? st(t, 'contract.confirmPassed', '确认通过')
                : st(t, 'contract.accept', '采纳建议（仅本地）')}
            </Button>
            {activeClause.id !== 'privacy' ? (
              <Button long onClick={() => setReviewState((current) => ({ ...current, [activeClause.id]: 'retained' }))}>
                {st(t, 'contract.ignore', '保留原文并说明（仅本地）')}
              </Button>
            ) : null}
          </Space>
        </aside>
      </div>
    </div>
  );
};

const PrototypeState: React.FC<{ agentId: AgentSurfaceId; state: string; t: TFunction }> = ({ agentId, state, t }) => (
  <div className={fixtureClassNames('asp-prototype-state')}>
    {st(t, 'state.label', '原型状态')} · assistant={agentId} · conversation={agentId}-fixture-01 · {state}
  </div>
);
const UnifiedAgentSurface: React.FC<AgentSurfaceVariantProps & { initialForecastMode: ForecastMode }> = ({
  agentId,
  initialForecastMode,
  onAgentChange,
  t,
}) => {
  const [state, setState] = useState(agentId === 'general' ? 'view=home' : 'view=ready');
  useEffect(() => setState(agentId === 'general' ? 'view=home' : 'view=ready'), [agentId]);
  return (
    <div className={fixtureClassNames('agent-surface-prototype')} data-agent={agentId}>
      {agentId === 'general' ? <GeneralSurface agentId={agentId} onAgentChange={onAgentChange} t={t} /> : null}
      {agentId === 'forecast' ? (
        <ForecastSurface
          agentId={agentId}
          initialMode={initialForecastMode}
          onAgentChange={onAgentChange}
          t={t}
          onStateChange={setState}
        />
      ) : null}
      {agentId === 'contract' ? (
        <ContractSurface agentId={agentId} onAgentChange={onAgentChange} t={t} onStateChange={setState} />
      ) : null}
      <PrototypeState agentId={agentId} state={state} t={t} />
    </div>
  );
};

export const AgentSurfaceVariantA: React.FC<AgentSurfaceVariantProps> = (props) => (
  <UnifiedAgentSurface {...props} initialForecastMode='split' />
);
export const AgentSurfaceVariantB: React.FC<AgentSurfaceVariantProps> = (props) => (
  <UnifiedAgentSurface {...props} initialForecastMode='workbench' />
);
export const AgentSurfaceVariantC: React.FC<AgentSurfaceVariantProps> = (props) => (
  <UnifiedAgentSurface {...props} initialForecastMode='conversation' />
);

export const SpecializedAgentSurface: React.FC<{
  agentId: Exclude<AgentSurfaceId, 'general'>;
  onAgentChange: (agentId: AgentSurfaceId) => void;
  stateScope: string;
  t: TFunction;
}> = ({ agentId, onAgentChange, stateScope, t }) => {
  const [, setState] = useState('view=ready');

  return (
    <div
      className={fixtureClassNames('agent-surface-prototype')}
      data-agent={agentId}
      data-testid={`assistant-surface-${agentId}`}
    >
      {agentId === 'forecast' ? (
        <ForecastSurface
          agentId={agentId}
          initialMode='split'
          onAgentChange={onAgentChange}
          onStateChange={setState}
          showAgentSelector={false}
          stateScope={stateScope}
          t={t}
        />
      ) : (
        <ContractSurface
          agentId={agentId}
          onAgentChange={onAgentChange}
          onStateChange={setState}
          showAgentSelector={false}
          stateScope={stateScope}
          t={t}
        />
      )}
    </div>
  );
};
