import type { EnterpriseAssistantExtensionViolation } from '@/common/types/agent/enterpriseAssistantCatalog';
import { Alert, Select, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

type CapabilityOption = { id: string; label: string };

type ManagedCapabilityEditorProps = {
  kind: 'mcp' | 'skill';
  requiredIds: string[];
  options: CapabilityOption[];
  selectedIds: string[];
  setSelectedIds: (value: string[]) => void;
  allowExtensions: boolean;
  active: boolean;
  violations: EnterpriseAssistantExtensionViolation[];
};

const violationKind = (violation: EnterpriseAssistantExtensionViolation): 'mcp' | 'skill' | 'shared' => {
  if (violation.code === 'MCP_NOT_ALLOWED' || violation.code === 'BUSINESS_MCP_REPLACEMENT') return 'mcp';
  if (violation.code === 'SKILL_NOT_ALLOWED') return 'skill';
  return 'shared';
};

const ManagedCapabilityEditor: React.FC<ManagedCapabilityEditorProps> = ({
  kind,
  requiredIds,
  options,
  selectedIds,
  setSelectedIds,
  allowExtensions,
  active,
  violations,
}) => {
  const { t } = useTranslation();
  const optionIds = new Set(options.map((option) => option.id));
  const requiredIdSet = new Set(requiredIds);
  const extensionOptions = options.filter((option) => !requiredIdSet.has(option.id));
  const fieldViolations = violations.filter((violation) => {
    const field = violationKind(violation);
    if (field === 'shared' && violation.capability_id) {
      return requiredIdSet.has(violation.capability_id) || optionIds.has(violation.capability_id);
    }
    return field === 'shared' || field === kind;
  });
  const capabilityName =
    kind === 'skill'
      ? t('settings.assistantManagedSkills', { defaultValue: 'Skills' })
      : t('settings.assistantManagedMcps', { defaultValue: 'MCP servers' });

  return (
    <div className='space-y-10px' data-testid={`managed-${kind}-editor`}>
      <div className='rounded-10px border border-border-2 bg-fill-1 px-10px py-9px'>
        <div className='mb-7px flex items-center justify-between gap-8px text-11px text-t-secondary'>
          <span>{t('settings.assistantManagedRequiredCapabilities', { defaultValue: 'Enterprise required' })}</span>
          <Tag size='small'>{t('settings.enterpriseManagedBadge', { defaultValue: 'Enterprise managed' })}</Tag>
        </div>
        <div className='flex flex-wrap gap-6px'>
          {requiredIds.length > 0 ? (
            requiredIds.map((id) => (
              <span
                key={id}
                className='inline-flex items-center gap-5px rounded-8px border border-border-2 bg-bg-2 px-8px py-4px text-11px text-t-primary'
              >
                <span>{options.find((option) => option.id === id)?.label ?? id}</span>
                <span className={optionIds.has(id) ? 'text-success-6' : 'text-warning-6'}>
                  {optionIds.has(id)
                    ? t('settings.assistantManagedCapabilityReady', { defaultValue: 'Ready' })
                    : t('settings.assistantManagedCapabilityMissing', { defaultValue: 'Unavailable' })}
                </span>
              </span>
            ))
          ) : (
            <span className='text-11px text-t-tertiary'>
              {t('settings.assistantManagedNoRequiredCapabilities', { defaultValue: 'None' })}
            </span>
          )}
        </div>
      </div>

      <div>
        <div className='mb-6px text-11px text-t-secondary'>
          {t('settings.assistantManagedMyExtensions', {
            defaultValue: 'My auxiliary {{capability}}',
            capability: capabilityName,
          })}
        </div>
        <Select
          mode='multiple'
          value={selectedIds}
          onChange={(value) => setSelectedIds(((value as string[]) ?? []).filter(Boolean))}
          disabled={!active || !allowExtensions}
          allowClear
          showSearch
          placeholder={t('settings.assistantManagedAddExtensions', {
            defaultValue: 'Add auxiliary {{capability}}',
            capability: capabilityName,
          })}
          data-testid={`select-assistant-managed-${kind}-extensions`}
        >
          {extensionOptions.map((option) => (
            <Select.Option key={option.id} value={option.id}>
              {option.label}
            </Select.Option>
          ))}
        </Select>
        {!allowExtensions ? (
          <div className='mt-6px text-11px text-t-tertiary'>
            {t('settings.assistantManagedExtensionsDisabledForCapability', {
              defaultValue: 'Your enterprise does not allow auxiliary {{capability}} for this assistant.',
              capability: capabilityName,
            })}
          </div>
        ) : null}
      </div>

      {fieldViolations.length > 0 ? (
        <Alert
          type='warning'
          showIcon
          content={fieldViolations
            .map(
              (violation) =>
                violation.message ||
                `${violation.capability_id ? `${violation.capability_id}: ` : ''}${t(
                  `settings.assistantManagedViolation.${violation.code}`,
                  { defaultValue: violation.code }
                )}`
            )
            .join(' · ')}
          data-testid={`managed-${kind}-violations`}
        />
      ) : null}
    </div>
  );
};

export default ManagedCapabilityEditor;
