import { ipcBridge } from '@/common';
import { resolveLocaleKey } from '@/common/utils';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import {
  AssistantCatalog,
  createAionCoreAssistantCatalogAdapter,
  type AssistantCatalogView,
} from '@/common/adapter/assistant';
import { reorderAssistantList } from '@/renderer/pages/settings/AssistantSettings/assistantUtils';
import { selectableAssistants } from '@/renderer/utils/model/assistantSelection';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAssistantOrder } from './useAssistantOrder';

/**
 * Manages the assistant list: loading from backend, sorting, and tracking the
 * active selection. The backend returns a single ordered builtin + user catalog,
 * so no client-side merge logic is needed.
 */
export const useAssistantList = () => {
  const { i18n } = useTranslation();
  const assistantCatalogRef = useRef(
    new AssistantCatalog(createAionCoreAssistantCatalogAdapter(() => ipcBridge.assistants.list.invoke()))
  );
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [catalogView, setCatalogView] = useState<AssistantCatalogView | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const catalogRequestIdRef = useRef(0);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const localeKey = resolveLocaleKey(i18n.language);
  const previousLocaleKeyRef = useRef(localeKey);
  const { assistantOrder, setAssistantOrder } = useAssistantOrder();

  const loadAssistants = useCallback(async () => {
    const requestId = ++catalogRequestIdRef.current;
    setCatalogLoading(true);
    try {
      const view = await assistantCatalogRef.current.load(localeKey);
      if (requestId !== catalogRequestIdRef.current) return;
      const list = view.assistants;
      setCatalogView(view);
      setCatalogError(view.error_code ?? null);
      setAssistants(list);
      setActiveAssistantId((prev) => {
        if (prev && list.some((a) => a.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (error) {
      if (requestId !== catalogRequestIdRef.current) return;
      console.error('Failed to load assistants:', error);
      setCatalogError(error instanceof Error ? error.message : 'ASSISTANT_CATALOG_LOAD_FAILED');
    } finally {
      if (requestId === catalogRequestIdRef.current) setCatalogLoading(false);
    }
  }, [localeKey]);

  const reorderEnabledAssistants = useCallback(
    async (activeId: string, overId: string) => {
      const enabledAssistants = selectableAssistants(assistants, assistantOrder);
      const reorderedAssistants = reorderAssistantList(enabledAssistants, activeId, overId);
      if (reorderedAssistants === enabledAssistants) return;

      try {
        await setAssistantOrder(reorderedAssistants.map((assistant) => assistant.id));
      } catch (error) {
        console.error('Failed to reorder enabled assistants:', error);
        throw error;
      }
    },
    [assistantOrder, assistants, setAssistantOrder]
  );

  useEffect(() => {
    void loadAssistants();
  }, [loadAssistants]);

  useEffect(() => {
    const localeChanged = previousLocaleKeyRef.current !== localeKey;
    previousLocaleKeyRef.current = localeKey;

    if (!localeChanged) {
      return;
    }

    void loadAssistants();
  }, [loadAssistants, localeKey]);

  const activeAssistant = assistants.find((a) => a.id === activeAssistantId) ?? null;

  return {
    assistants,
    setAssistants,
    activeAssistantId,
    setActiveAssistantId,
    activeAssistant,
    loadAssistants,
    reorderEnabledAssistants,
    assistantOrder,
    setAssistantOrder,
    localeKey,
    catalogView,
    catalogError,
    catalogLoading,
  };
};
