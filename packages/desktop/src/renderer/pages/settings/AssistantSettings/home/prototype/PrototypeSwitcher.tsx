/**
 * PROTOTYPE ONLY — variant switcher for the work-center information architecture study.
 */
import { Button } from '@arco-design/web-react';
import { Left, Right } from '@icon-park/react';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export type PrototypeVariant = 'A' | 'B' | 'C';

const VARIANTS: Array<{ key: PrototypeVariant; label: string }> = [
  { key: 'A', label: '上下文检查器' },
  { key: 'B', label: '会话内工作流' },
  { key: 'C', label: '工作总览切换' },
];

const TEAM_VARIANTS: Array<{ key: PrototypeVariant; label: string }> = [
  { key: 'A', label: '会话 + 按需任务面板' },
  { key: 'B', label: '任务侧栏' },
  { key: 'C', label: '按需工作总览' },
];

const JOURNEY_VARIANTS: Array<{ key: PrototypeVariant; label: string }> = [
  { key: 'A', label: '推荐：会话 + 上下文检查器' },
  { key: 'B', label: '引导式工作旅程' },
  { key: 'C', label: '状态工作台' },
];

type PrototypeSwitcherProps = {
  current: PrototypeVariant;
  onChange: (variant: PrototypeVariant) => void;
  study?: 'work-center' | 'team-work' | 'end-to-end';
};

const PrototypeSwitcher: React.FC<PrototypeSwitcherProps> = ({ current, onChange, study = 'work-center' }) => {
  const { t } = useTranslation();
  const variants = study === 'team-work' ? TEAM_VARIANTS : study === 'end-to-end' ? JOURNEY_VARIANTS : VARIANTS;
  const currentIndex = variants.findIndex((variant) => variant.key === current);

  const cycle = (direction: -1 | 1) => {
    const nextIndex = (currentIndex + direction + variants.length) % variants.length;
    onChange(variants[nextIndex].key);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') cycle(-1);
      if (event.key === 'ArrowRight') cycle(1);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const active = variants[currentIndex];

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div className='fixed bottom-18px left-1/2 z-100 flex -translate-x-1/2 items-center gap-4px rounded-full border border-border-2 bg-bg-1 p-4px shadow-lg'>
      <Button
        type='text'
        shape='circle'
        icon={<Left size={15} />}
        aria-label={t('prototype.workCenter.previousVariant', { defaultValue: '上一个原型方案' })}
        onClick={() => cycle(-1)}
      />
      <span className='min-w-150px px-8px text-center text-12px font-500 text-t-primary'>
        {active.key} ·{' '}
        {t(
          study === 'end-to-end'
            ? `prototype.endToEnd.variant.${active.key}`
            : `prototype.workCenter.variant.${active.key}`,
          { defaultValue: active.label }
        )}
      </span>
      <Button
        type='text'
        shape='circle'
        icon={<Right size={15} />}
        aria-label={t('prototype.workCenter.nextVariant', { defaultValue: '下一个原型方案' })}
        onClick={() => cycle(1)}
      />
    </div>
  );
};

export default PrototypeSwitcher;
