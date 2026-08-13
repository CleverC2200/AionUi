/**
 * PROTOTYPE ONLY — unified work-center and end-to-end journey variants, switchable via
 * /prototype/work-center?scenario=journey&variant=A. No real data or mutations.
 */
import { Button, Radio } from '@arco-design/web-react';
import { AlarmClock, Peoples, Plus, Robot, SettingTwo } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import PrototypeSwitcher, { type PrototypeVariant } from './PrototypeSwitcher';
import { JourneyVariantA, JourneyVariantB, JourneyVariantC, type JourneyStep } from './journeyVariants';
import { TeamVariantA, TeamVariantB, TeamVariantC } from './teamVariants';
import { VariantA, VariantB, VariantC, type PrototypeScenario } from './variants';

const SCENARIOS: Array<{ key: PrototypeScenario; label: string }> = [
  { key: 'journey', label: '完整旅程' },
  { key: 'catalog', label: '企业助手' },
  { key: 'running', label: '执行中' },
  { key: 'attention', label: '需要介入' },
  { key: 'deliverable', label: '交付完成' },
  { key: 'error', label: 'GEA 错误' },
  { key: 'team', label: 'Team 协作' },
];

const isVariant = (value: string | null): value is PrototypeVariant => value === 'A' || value === 'B' || value === 'C';
const isScenario = (value: string | null): value is PrototypeScenario =>
  SCENARIOS.some((scenario) => scenario.key === value);
const isJourneyStep = (value: string | null): value is JourneyStep =>
  value === 'catalog' ||
  value === 'detail' ||
  value === 'preparing' ||
  value === 'running' ||
  value === 'attention' ||
  value === 'resumed' ||
  value === 'deliverable' ||
  value === 'receipt' ||
  value === 'team' ||
  value === 'error';

const PrototypeNavItem: React.FC<{
  active?: boolean;
  icon: React.ReactNode;
  label: string;
}> = ({ active, icon, label }) => (
  <Button
    className={`!h-36px !justify-start !rounded-9px !px-10px ${active ? '!bg-fill-2 !text-t-primary' : '!text-t-secondary'}`}
    type='text'
    long
    icon={icon}
  >
    {label}
  </Button>
);

const StandalonePrototypeFrame: React.FC<React.PropsWithChildren<{ teamActive?: boolean }>> = ({
  children,
  teamActive,
}) => {
  const { t } = useTranslation();
  return (
    <div className='flex h-screen min-h-0 bg-bg-0'>
      <aside className='hidden w-260px shrink-0 flex-col border-r border-border-2 bg-bg-1 p-10px md:flex'>
        <div className='flex h-52px items-center gap-10px px-10px text-18px font-650 text-t-primary'>
          <div className='flex size-26px items-center justify-center rounded-full bg-danger-6 text-10px font-700 text-white'>
            GEA
          </div>
          GEAUi
        </div>
        <div className='mt-4px flex flex-col gap-3px'>
          <PrototypeNavItem
            icon={<Plus size={16} />}
            label={t('prototype.workCenter.shell.newChat', { defaultValue: '新会话' })}
          />
          <PrototypeNavItem
            active={!teamActive}
            icon={<Robot size={16} />}
            label={t('prototype.workCenter.shell.assistants', { defaultValue: '助手' })}
          />
          <PrototypeNavItem
            icon={<AlarmClock size={16} />}
            label={t('prototype.workCenter.shell.scheduledTasks', { defaultValue: '定时任务' })}
          />
        </div>
        <div className='mt-12px border-t border-border-2 pt-12px'>
          <PrototypeNavItem
            active={teamActive}
            icon={<Peoples size={16} />}
            label={t('prototype.workCenter.shell.teams', { defaultValue: '团队' })}
          />
        </div>
        <div className='mt-auto border-t border-border-2 pt-10px'>
          <PrototypeNavItem
            icon={<SettingTwo size={16} />}
            label={t('prototype.workCenter.shell.settings', { defaultValue: '设置' })}
          />
        </div>
      </aside>
      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex h-48px shrink-0 items-center justify-center border-b border-border-2 bg-bg-1 text-16px font-650 text-t-primary md:hidden'>
          GEAUi
        </div>
        <main className='min-h-0 flex-1'>{children}</main>
      </div>
    </div>
  );
};

const WorkCenterPrototype: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const requestedVariant = params.get('variant');
  const requestedScenario = params.get('scenario');
  const requestedJourneyStep = params.get('stage');
  const variant: PrototypeVariant = isVariant(requestedVariant) ? requestedVariant : 'A';
  const scenario: PrototypeScenario = isScenario(requestedScenario) ? requestedScenario : 'journey';
  const journeyStep: JourneyStep = isJourneyStep(requestedJourneyStep) ? requestedJourneyStep : 'catalog';
  const teamStudy = scenario === 'team';
  const journeyStudy = scenario === 'journey';

  const updateParam = (key: 'variant' | 'scenario' | 'stage', value: string) => {
    const next = new URLSearchParams(location.search);
    next.set('prototype', 'work-center');
    next.set(key, value);
    navigate(`${location.pathname}?${next.toString()}`, { replace: true });
  };

  const content = (
    <div className='flex h-full min-h-0 flex-col overflow-hidden bg-bg-0' data-testid='work-center-prototype'>
      <div className='flex min-h-54px shrink-0 flex-wrap items-center gap-12px border-b border-border-2 px-18px py-8px'>
        <div className='mr-auto min-w-0'>
          <div className='text-14px font-600 text-t-primary'>
            {journeyStudy
              ? t('prototype.endToEnd.title', { defaultValue: '统一 Agent 工作体验 · 端到端原型' })
              : teamStudy
                ? t('prototype.workCenter.teamTitle', { defaultValue: 'Team Work 呈现原型' })
                : t('prototype.workCenter.title', { defaultValue: '会话中心信息架构原型' })}
          </div>
          <div className='mt-2px text-11px text-t-tertiary'>
            {t('prototype.workCenter.fixtureNotice', {
              defaultValue: 'Fixture 数据 · 不连接 GEA · 不执行真实操作',
            })}
          </div>
        </div>
        <div className='max-w-full overflow-x-auto'>
          <Radio.Group
            className='whitespace-nowrap'
            type='button'
            value={scenario}
            onChange={(value) => updateParam('scenario', String(value))}
            aria-label={t('prototype.workCenter.selectScenario', { defaultValue: '选择原型状态' })}
          >
            {SCENARIOS.map((item) => (
              <Radio key={item.key} value={item.key}>
                {t(`prototype.workCenter.scenario.${item.key}`, { defaultValue: item.label })}
              </Radio>
            ))}
          </Radio.Group>
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-hidden'>
        {journeyStudy && variant === 'A' ? (
          <JourneyVariantA t={t} step={journeyStep} onStepChange={(next) => updateParam('stage', next)} />
        ) : null}
        {journeyStudy && variant === 'B' ? (
          <JourneyVariantB t={t} step={journeyStep} onStepChange={(next) => updateParam('stage', next)} />
        ) : null}
        {journeyStudy && variant === 'C' ? (
          <JourneyVariantC t={t} step={journeyStep} onStepChange={(next) => updateParam('stage', next)} />
        ) : null}
        {teamStudy && variant === 'A' ? <TeamVariantA t={t} /> : null}
        {teamStudy && variant === 'B' ? <TeamVariantB t={t} /> : null}
        {teamStudy && variant === 'C' ? <TeamVariantC t={t} /> : null}
        {!teamStudy && !journeyStudy && variant === 'A' ? <VariantA scenario={scenario} t={t} /> : null}
        {!teamStudy && !journeyStudy && variant === 'B' ? <VariantB scenario={scenario} t={t} /> : null}
        {!teamStudy && !journeyStudy && variant === 'C' ? <VariantC scenario={scenario} t={t} /> : null}
      </div>
      <PrototypeSwitcher
        current={variant}
        study={journeyStudy ? 'end-to-end' : teamStudy ? 'team-work' : 'work-center'}
        onChange={(next) => updateParam('variant', next)}
      />
    </div>
  );

  return location.pathname === '/prototype/work-center' ? (
    <StandalonePrototypeFrame teamActive={teamStudy}>{content}</StandalonePrototypeFrame>
  ) : (
    content
  );
};

export default WorkCenterPrototype;
