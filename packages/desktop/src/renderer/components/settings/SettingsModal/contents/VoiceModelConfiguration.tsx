/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ManagedVoiceConfiguration, UpdateManagedVoiceConfigurationRequest } from '@/common/types/voice';
import { clearManagedVoiceCapabilityCache } from '@/renderer/services/voice/voiceCapability';
import { Button, Collapse, Message, Popconfirm, Spin, Switch, Tag, Tooltip } from '@arco-design/web-react';
import { DeleteFour, Heartbeat, Info, SettingTwo, VoiceOne } from '@icon-park/react';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceModelConfigurationModal from './VoiceModelConfigurationModal';

export type VoiceModelConfigurationHandle = {
  openCreate: () => void;
};

const collapseClassName =
  '[&_.arco-collapse-item]:!border-0 [&_.arco-collapse-item]:!rounded-12px [&_.arco-collapse-item]:!overflow-hidden [&_.arco-collapse-item]:!bg-[var(--color-bg-2)] [&_.arco-collapse-item-header]:!bg-[var(--fill-0)] [&_.arco-collapse-item-header]:!pl-36px [&_.arco-collapse-item-header]:!pr-12px [&_.arco-collapse-item-header]:!py-8px [&_.arco-collapse-item-header]:transition-colors [&_.arco-collapse-item-header]:hover:!bg-[var(--color-bg-2)] [&_.arco-collapse-item-header-title]:!min-w-0 [&_.arco-collapse-item-content]:!bg-fill-1 [&_.arco-collapse-item-content-box]:!p-0 [&_.arco-collapse-item-content]:!border-t [&_.arco-collapse-item-content]:!border-[var(--color-border-2)]';

const VoiceModelConfiguration = forwardRef<VoiceModelConfigurationHandle>((_, ref) => {
  const { t } = useTranslation();
  const [configurations, setConfigurations] = useState<ManagedVoiceConfiguration[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [healthId, setHealthId] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConfiguration, setEditingConfiguration] = useState<ManagedVoiceConfiguration | null>(null);

  const loadConfigurations = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setConfigurations(await ipcBridge.voice.listConfigurations.invoke());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfigurations();
  }, [loadConfigurations]);

  const openCreate = useCallback(() => {
    setEditingConfiguration(null);
    setModalVisible(true);
  }, []);

  useImperativeHandle(ref, () => ({ openCreate }), [openCreate]);

  const saveConfiguration = async (request: UpdateManagedVoiceConfigurationRequest) => {
    setSaving(true);
    try {
      if (editingConfiguration) {
        await ipcBridge.voice.updateConfiguration.invoke({
          configuration_id: editingConfiguration.id,
          ...request,
        });
      } else {
        await ipcBridge.voice.createConfiguration.invoke(request);
      }
      clearManagedVoiceCapabilityCache();
      setModalVisible(false);
      await loadConfigurations();
      Message.success(t('settings.voiceConfigurationSaved'));
    } catch {
      Message.error(t('settings.voiceConfigurationSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const setEnabled = async (configuration: ManagedVoiceConfiguration, enabled: boolean) => {
    setSwitchingId(configuration.id);
    try {
      await ipcBridge.voice.setConfigurationEnabled.invoke({ configuration_id: configuration.id, enabled });
      clearManagedVoiceCapabilityCache();
      await loadConfigurations();
    } catch {
      Message.error(t('settings.voiceConfigurationSaveFailed'));
    } finally {
      setSwitchingId(null);
    }
  };

  const deleteConfiguration = async (configuration: ManagedVoiceConfiguration) => {
    try {
      await ipcBridge.voice.deleteConfiguration.invoke({ configuration_id: configuration.id });
      clearManagedVoiceCapabilityCache();
      await loadConfigurations();
      Message.success(t('settings.voiceConfigurationDeleted'));
    } catch {
      Message.error(t('settings.voiceConfigurationDeleteFailed'));
    }
  };

  const checkHealth = async (configuration: ManagedVoiceConfiguration) => {
    setHealthId(configuration.id);
    try {
      const result = await ipcBridge.voice.checkConfigurationHealth.invoke({ configuration_id: configuration.id });
      if (result.status === 'healthy') {
        Message.success(t('settings.voiceHealthSuccess', { latency: result.latency_ms }));
      } else {
        Message.error(t('settings.voiceHealthFailed', { code: result.error_code ?? 'unknown' }));
      }
    } catch {
      Message.error(t('settings.voiceHealthFailed', { code: 'request_failed' }));
    } finally {
      setHealthId(null);
    }
  };

  const modal = (
    <VoiceModelConfigurationModal
      visible={modalVisible}
      configuration={editingConfiguration}
      saving={saving}
      onCancel={() => setModalVisible(false)}
      onSave={(request) => void saveConfiguration(request)}
    />
  );

  if (loading) {
    return (
      <>
        {modal}
        <div className='flex justify-center py-32px'>
          <Spin />
        </div>
      </>
    );
  }

  if (loadFailed) {
    return (
      <>
        {modal}
        <div className='flex flex-col items-center justify-center gap-12px border border-dashed border-border-2 rd-12px py-24px'>
          <span className='text-14px text-t-secondary'>{t('settings.voiceConfigurationLoadFailed')}</span>
          <Button size='small' onClick={() => void loadConfigurations()}>
            {t('common.retry')}
          </Button>
        </div>
      </>
    );
  }

  if (configurations.length === 0) {
    return (
      <>
        {modal}
        <div className='flex flex-col items-center justify-center border border-dashed border-border-2 rd-12px py-24px'>
          <Info size='28' className='mb-8px text-t-secondary' />
          <div className='text-14px font-500 text-t-primary'>{t('settings.voiceConfigurationEmpty')}</div>
          <div className='mt-4px text-12px text-t-secondary'>{t('settings.voiceConfigurationEmptyHint')}</div>
          <Button type='primary' size='small' className='mt-12px' onClick={openCreate}>
            {t('settings.voiceConfigurationAdd')}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {modal}
      <Collapse defaultActiveKey={['volcengine']} bordered expandIconPosition='left' className={collapseClassName}>
        <Collapse.Item
          name='volcengine'
          header={
            <div className='flex min-h-32px w-full min-w-0 items-center justify-between gap-8px'>
              <div className='flex min-w-0 items-center gap-8px'>
                <span className='flex h-28px w-28px shrink-0 items-center justify-center rd-8px bg-primary-1 text-primary-6'>
                  <VoiceOne size='16' />
                </span>
                <span className='truncate text-14px font-500 text-t-primary'>{t('settings.voiceModelVolcengine')}</span>
              </div>
              <span className='shrink-0 text-12px text-t-secondary'>
                {t('settings.voiceConfigurationCount', { count: configurations.length })}
              </span>
            </div>
          }
        >
          <div className='divide-y divide-solid divide-border-2'>
            {configurations.map((configuration) => (
              <div
                key={configuration.id}
                data-testid={`voice-configuration-${configuration.id}`}
                className='group flex min-h-56px items-center gap-10px px-14px py-9px hover:bg-fill-0'
              >
                <div className='min-w-0 flex-1'>
                  <div className='flex min-w-0 items-center gap-8px'>
                    <span className='truncate text-14px font-500 text-t-primary'>{configuration.name}</span>
                    <Tag size='small' color={configuration.enabled ? 'green' : 'gray'} className='shrink-0'>
                      {configuration.enabled ? t('settings.voiceModelEnabled') : t('settings.voiceModelDisabled')}
                    </Tag>
                    {configuration.source === 'environment' ? (
                      <Tooltip content={t('settings.voiceConfigurationManagedHint')}>
                        <Tag size='small' className='hidden shrink-0 md:inline-flex'>
                          {t('settings.voiceConfigurationManaged')}
                        </Tag>
                      </Tooltip>
                    ) : null}
                  </div>
                  <div className='mt-2px truncate text-12px text-t-secondary'>
                    {configuration.llm_model_name || t('settings.voiceConfigurationNoModel')}
                    <span className='mx-6px'>·</span>
                    {configuration.tts_voice_type || t('settings.voiceConfigurationNoVoice')}
                  </div>
                </div>

                <div className='flex shrink-0 items-center gap-4px'>
                  <Tooltip
                    content={
                      configuration.source === 'environment' ? t('settings.voiceConfigurationManagedHint') : undefined
                    }
                  >
                    <Switch
                      size='small'
                      checked={configuration.enabled}
                      disabled={configuration.source === 'environment'}
                      loading={switchingId === configuration.id}
                      onChange={(enabled) => void setEnabled(configuration, enabled)}
                    />
                  </Tooltip>
                  <Tooltip content={t('settings.voiceHealthCheck')}>
                    <Button
                      type='text'
                      size='small'
                      aria-label={t('settings.voiceHealthCheck')}
                      loading={healthId === configuration.id}
                      icon={<Heartbeat size='17' />}
                      onClick={() => void checkHealth(configuration)}
                    />
                  </Tooltip>
                  {configuration.source === 'saved' ? (
                    <Tooltip content={t('settings.voiceConfigurationEdit')}>
                      <Button
                        type='text'
                        size='small'
                        aria-label={t('settings.voiceConfigurationEdit')}
                        icon={<SettingTwo size='17' />}
                        onClick={() => {
                          setEditingConfiguration(configuration);
                          setModalVisible(true);
                        }}
                      />
                    </Tooltip>
                  ) : null}
                  {configuration.source === 'saved' ? (
                    <Popconfirm
                      title={t('settings.voiceConfigurationDeleteConfirm')}
                      onOk={() => void deleteConfiguration(configuration)}
                    >
                      <Tooltip content={t('common.delete')}>
                        <Button
                          type='text'
                          status='danger'
                          size='small'
                          aria-label={t('common.delete')}
                          icon={<DeleteFour size='17' />}
                        />
                      </Tooltip>
                    </Popconfirm>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Collapse.Item>
      </Collapse>
    </>
  );
});

VoiceModelConfiguration.displayName = 'VoiceModelConfiguration';

export default VoiceModelConfiguration;
