/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ManagedVoiceConfiguration, UpdateManagedVoiceConfigurationRequest } from '@/common/types/voice';
import AionModal from '@/renderer/components/base/AionModal';
import { Button, Form, Input, Switch } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type EditableVoiceConfiguration = Omit<
  UpdateManagedVoiceConfigurationRequest,
  'access_key' | 'secret_key' | 'rtc_app_key' | 'llm_api_key'
> & {
  access_key: string;
  secret_key: string;
  rtc_app_key: string;
  llm_api_key: string;
};

type VoiceModelConfigurationModalProps = {
  visible: boolean;
  configuration: ManagedVoiceConfiguration | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (request: UpdateManagedVoiceConfigurationRequest) => void;
};

const emptyConfiguration = (): EditableVoiceConfiguration => ({
  name: '',
  enabled: true,
  rtc_app_id: '',
  access_key: '',
  secret_key: '',
  rtc_app_key: '',
  agent_user_id: 'ChatBot01',
  welcome_message: '',
  asr_app_id: '',
  asr_cluster: '',
  tts_app_id: '',
  tts_cluster: 'volcano_tts',
  tts_voice_type: 'BV001_streaming',
  llm_url: '',
  llm_api_key: '',
  llm_model_name: '',
  system_message: '',
});

const toEditableConfiguration = (configuration: ManagedVoiceConfiguration): EditableVoiceConfiguration => ({
  name: configuration.name,
  enabled: configuration.enabled,
  rtc_app_id: configuration.rtc_app_id,
  access_key: '',
  secret_key: '',
  rtc_app_key: '',
  agent_user_id: configuration.agent_user_id,
  welcome_message: configuration.welcome_message,
  asr_app_id: configuration.asr_app_id,
  asr_cluster: configuration.asr_cluster,
  tts_app_id: configuration.tts_app_id,
  tts_cluster: configuration.tts_cluster,
  tts_voice_type: configuration.tts_voice_type,
  llm_url: configuration.llm_url,
  llm_api_key: '',
  llm_model_name: configuration.llm_model_name,
  system_message: configuration.system_message,
});

const compactSecret = (value: string): string | undefined => value.trim() || undefined;

const configurationSection = (title: string, children: React.ReactNode, hint?: string) => (
  <section className='border-b border-solid border-border-2 pb-4px last:border-b-0'>
    <h3 className='m-0 mb-4px text-14px font-600 text-t-primary'>{title}</h3>
    {hint ? <p className='m-0 mb-14px text-12px leading-5 text-t-secondary'>{hint}</p> : null}
    <div className='grid grid-cols-1 gap-x-16px md:grid-cols-2'>{children}</div>
  </section>
);

const VoiceModelConfigurationModal: React.FC<VoiceModelConfigurationModalProps> = ({
  visible,
  configuration,
  saving,
  onCancel,
  onSave,
}) => {
  const { t } = useTranslation();
  const [values, setValues] = useState<EditableVoiceConfiguration>(emptyConfiguration);

  useEffect(() => {
    if (visible) {
      setValues(configuration ? toEditableConfiguration(configuration) : emptyConfiguration());
    }
  }, [configuration, visible]);

  const requiredFields = useMemo(
    () => [
      values.name,
      values.rtc_app_id,
      values.agent_user_id,
      values.asr_app_id,
      values.asr_cluster,
      values.tts_app_id,
      values.tts_cluster,
      values.tts_voice_type,
      values.llm_url,
      values.llm_model_name,
    ],
    [values]
  );
  const existingSecretsComplete = Boolean(
    configuration?.access_key_configured &&
    configuration.secret_key_configured &&
    configuration.rtc_app_key_configured &&
    configuration.llm_api_key_configured
  );
  const enteredSecretsComplete = Boolean(
    values.access_key.trim() && values.secret_key.trim() && values.rtc_app_key.trim() && values.llm_api_key.trim()
  );
  const canSave =
    requiredFields.every((value) => value.trim()) && (existingSecretsComplete || enteredSecretsComplete) && !saving;

  const updateValue = <K extends keyof EditableVoiceConfiguration>(key: K, value: EditableVoiceConfiguration[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const secretPlaceholder = (configured: boolean): string =>
    configured ? t('settings.voiceSecretConfiguredPlaceholder') : t('settings.voiceSecretRequiredPlaceholder');

  const handleSave = () => {
    onSave({
      name: values.name.trim(),
      enabled: values.enabled,
      rtc_app_id: values.rtc_app_id.trim(),
      access_key: compactSecret(values.access_key),
      secret_key: compactSecret(values.secret_key),
      rtc_app_key: compactSecret(values.rtc_app_key),
      agent_user_id: values.agent_user_id.trim(),
      welcome_message: values.welcome_message.trim(),
      asr_app_id: values.asr_app_id.trim(),
      asr_cluster: values.asr_cluster.trim(),
      tts_app_id: values.tts_app_id.trim(),
      tts_cluster: values.tts_cluster.trim(),
      tts_voice_type: values.tts_voice_type.trim(),
      llm_url: values.llm_url.trim(),
      llm_api_key: compactSecret(values.llm_api_key),
      llm_model_name: values.llm_model_name.trim(),
      system_message: values.system_message.trim(),
    });
  };

  return (
    <AionModal
      variant='standard'
      visible={visible}
      onCancel={onCancel}
      unmountOnExit={false}
      autoFocus={false}
      style={{ width: 760, maxWidth: 'calc(100vw - 48px)' }}
      header={{
        title: configuration ? t('settings.voiceConfigurationEdit') : t('settings.voiceConfigurationAdd'),
        subtitle: t('settings.voiceConfigurationModalDescription'),
        showClose: true,
      }}
      footer={{
        render: () => (
          <div className='flex justify-end gap-10px'>
            <Button onClick={onCancel}>{t('common.cancel')}</Button>
            <Button type='primary' loading={saving} disabled={!canSave} onClick={handleSave}>
              {t('common.save')}
            </Button>
          </div>
        ),
      }}
    >
      <Form layout='vertical' className='flex flex-col gap-18px'>
        <div className='grid grid-cols-1 gap-x-16px md:grid-cols-2'>
          <Form.Item label={t('settings.voiceConfigurationName')} required>
            <Input value={values.name} onChange={(value) => updateValue('name', value)} />
          </Form.Item>
          <Form.Item label={t('settings.voiceModelEnable')}>
            <div className='flex h-32px items-center gap-10px'>
              <Switch checked={values.enabled} onChange={(checked) => updateValue('enabled', checked)} />
              <span className='text-13px text-t-secondary'>
                {values.enabled ? t('settings.voiceModelEnabled') : t('settings.voiceModelDisabled')}
              </span>
            </div>
          </Form.Item>
        </div>

        {configurationSection(
          t('settings.voiceConfigurationRtc'),
          <>
            <Form.Item label={t('settings.voiceRtcAppId')} required>
              <Input value={values.rtc_app_id} onChange={(value) => updateValue('rtc_app_id', value)} />
            </Form.Item>
            <Form.Item label={t('settings.voiceRtcAppKey')} required>
              <Input.Password
                value={values.rtc_app_key}
                placeholder={secretPlaceholder(Boolean(configuration?.rtc_app_key_configured))}
                onChange={(value) => updateValue('rtc_app_key', value)}
              />
            </Form.Item>
            <Form.Item label={t('settings.voiceAccessKey')} required>
              <Input.Password
                value={values.access_key}
                placeholder={secretPlaceholder(Boolean(configuration?.access_key_configured))}
                onChange={(value) => updateValue('access_key', value)}
              />
            </Form.Item>
            <Form.Item label={t('settings.voiceSecretKey')} required>
              <Input.Password
                value={values.secret_key}
                placeholder={secretPlaceholder(Boolean(configuration?.secret_key_configured))}
                onChange={(value) => updateValue('secret_key', value)}
              />
            </Form.Item>
            <Form.Item label={t('settings.voiceAgentUserId')} required>
              <Input value={values.agent_user_id} onChange={(value) => updateValue('agent_user_id', value)} />
            </Form.Item>
            <Form.Item label={t('settings.voiceWelcomeMessage')}>
              <Input value={values.welcome_message} onChange={(value) => updateValue('welcome_message', value)} />
            </Form.Item>
          </>,
          t('settings.voiceConfigurationRtcHint')
        )}

        {configurationSection(
          t('settings.voiceConfigurationAsr'),
          <>
            <Form.Item label={t('settings.voiceAsrAppId')} required>
              <Input value={values.asr_app_id} onChange={(value) => updateValue('asr_app_id', value)} />
            </Form.Item>
            <Form.Item label={t('settings.voiceAsrCluster')} required>
              <Input value={values.asr_cluster} onChange={(value) => updateValue('asr_cluster', value)} />
            </Form.Item>
          </>
        )}

        {configurationSection(
          t('settings.voiceConfigurationTts'),
          <>
            <Form.Item label={t('settings.voiceTtsAppId')} required>
              <Input value={values.tts_app_id} onChange={(value) => updateValue('tts_app_id', value)} />
            </Form.Item>
            <Form.Item label={t('settings.voiceTtsCluster')} required>
              <Input value={values.tts_cluster} onChange={(value) => updateValue('tts_cluster', value)} />
            </Form.Item>
            <Form.Item label={t('settings.voiceTtsVoiceType')} required>
              <Input value={values.tts_voice_type} onChange={(value) => updateValue('tts_voice_type', value)} />
            </Form.Item>
          </>
        )}

        {configurationSection(
          t('settings.voiceConfigurationLlm'),
          <>
            <Form.Item label={t('settings.voiceLlmUrl')} required>
              <Input value={values.llm_url} onChange={(value) => updateValue('llm_url', value)} />
            </Form.Item>
            <Form.Item label={t('settings.voiceLlmApiKey')} required>
              <Input.Password
                value={values.llm_api_key}
                placeholder={secretPlaceholder(Boolean(configuration?.llm_api_key_configured))}
                onChange={(value) => updateValue('llm_api_key', value)}
              />
            </Form.Item>
            <Form.Item label={t('settings.voiceLlmModelName')} required>
              <Input value={values.llm_model_name} onChange={(value) => updateValue('llm_model_name', value)} />
            </Form.Item>
            <Form.Item label={t('settings.voiceSystemMessage')} className='md:col-span-2'>
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 5 }}
                value={values.system_message}
                onChange={(value) => updateValue('system_message', value)}
              />
            </Form.Item>
          </>
        )}
      </Form>
    </AionModal>
  );
};

export default VoiceModelConfigurationModal;
