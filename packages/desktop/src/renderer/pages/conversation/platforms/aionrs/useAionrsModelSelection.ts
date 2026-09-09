/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { GEA_PERSONAL_PROVIDER_PREFIX } from '@/common/config/geaPersonalModel';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import { useCallback, useEffect, useMemo, useState } from 'react';

export type AionrsModelSelection = {
  current_model?: TProviderWithModel;
  providers: IProvider[];
  getAvailableModels: (provider: IProvider) => string[];
  handleSelectModel: (provider: IProvider, modelName: string) => Promise<void>;
  getDisplayModelName: (modelName?: string) => string;
};

export type UseAionrsModelSelectionOptions = {
  initialModel: TProviderWithModel | undefined;
  onSelectModel: (provider: IProvider, modelName: string) => Promise<boolean>;
};

export const useAionrsModelSelection = ({
  initialModel,
  onSelectModel,
}: UseAionrsModelSelectionOptions): AionrsModelSelection => {
  const [current_model, setCurrentModel] = useState<TProviderWithModel | undefined>(initialModel);

  useEffect(() => {
    setCurrentModel(initialModel);
  }, [initialModel?.id, initialModel?.use_model]);

  const { providers: allProviders, getAvailableModels, formatModelLabel } = useModelProviderList();

  // AionCore does not support Google Auth — filter it out
  const providers = useMemo(
    () => allProviders.filter((p) => !p.platform?.toLowerCase().includes('gemini-with-google-auth')),
    [allProviders]
  );

  const handleSelectModel = useCallback(
    async (provider: IProvider, modelName: string) => {
      const selected = {
        ...(provider as unknown as TProviderWithModel),
        use_model: modelName,
      } as TProviderWithModel;
      const ok = await onSelectModel(provider, modelName);
      if (ok) {
        setCurrentModel(selected);
      }
    },
    [onSelectModel]
  );

  const getDisplayModelName = useCallback(
    (modelName?: string) => {
      if (!modelName) return '';
      const label = formatModelLabel(current_model, modelName);
      const maxLength = 20;
      return label.length > maxLength ? `${label.slice(0, maxLength)}...` : label;
    },
    [current_model, formatModelLabel]
  );

  // Personal gateway URLs are process-local. A persisted conversation selection
  // becomes usable only when the current provider list contains a restored route.
  const restoredProvider = current_model?.id.startsWith(GEA_PERSONAL_PROVIDER_PREFIX)
    ? providers.find(
        (provider) => provider.id === current_model.id && getAvailableModels(provider).includes(current_model.use_model)
      )
    : undefined;
  const resolvedModel = current_model?.id.startsWith(GEA_PERSONAL_PROVIDER_PREFIX)
    ? restoredProvider
      ? ({ ...restoredProvider, use_model: current_model.use_model } as TProviderWithModel)
      : undefined
    : current_model;

  return {
    current_model: resolvedModel,
    providers,
    getAvailableModels,
    handleSelectModel,
    getDisplayModelName,
  };
};
