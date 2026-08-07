/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type ManagedVoiceCapability = {
  enabled: boolean;
  provider?: 'volcengine-rtc';
  reason?: string;
};

export type ManagedVoiceConfigurationSource = 'environment' | 'saved' | 'not_configured';

export type ManagedVoiceConfiguration = {
  id: string;
  name: string;
  enabled: boolean;
  provider: 'volcengine-rtc';
  source: ManagedVoiceConfigurationSource;
  rtc_app_id: string;
  access_key_configured: boolean;
  secret_key_configured: boolean;
  rtc_app_key_configured: boolean;
  agent_user_id: string;
  welcome_message: string;
  asr_app_id: string;
  asr_cluster: string;
  tts_app_id: string;
  tts_cluster: string;
  tts_voice_type: string;
  llm_url: string;
  llm_api_key_configured: boolean;
  llm_model_name: string;
  system_message: string;
  created_at: number;
  updated_at: number;
};

export type UpdateManagedVoiceConfigurationRequest = {
  name: string;
  enabled: boolean;
  rtc_app_id: string;
  access_key?: string;
  secret_key?: string;
  rtc_app_key?: string;
  agent_user_id: string;
  welcome_message: string;
  asr_app_id: string;
  asr_cluster: string;
  tts_app_id: string;
  tts_cluster: string;
  tts_voice_type: string;
  llm_url: string;
  llm_api_key?: string;
  llm_model_name: string;
  system_message: string;
};

export type ManagedVoiceHealthResponse = {
  status: 'healthy' | 'unhealthy';
  latency_ms: number;
  error_code?: string;
};

export type VoiceSessionRtcCredentials = {
  app_id: string;
  room_id: string;
  user_id: string;
  token: string;
};

export type VoiceSessionCreateResponse = {
  session_id: string;
  rtc: VoiceSessionRtcCredentials;
  expires_at: number;
};

export type ManagedVoiceSessionMode = 'conversation' | 'dictation';

export type VoiceSessionCreateRequest = {
  conversation_id?: string;
  mode?: ManagedVoiceSessionMode;
};

export type VoiceTurnResponse = {
  text: string;
};

export type VoiceConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'error';

export type VoiceAgentState = 'idle' | 'listening' | 'thinking' | 'speaking';

export type VoiceSessionSnapshot = {
  connection: VoiceConnectionState;
  agent: VoiceAgentState;
  microphoneEnabled: boolean;
  userTranscript: string;
  agentTranscript: string;
  errorCode?: string;
};
