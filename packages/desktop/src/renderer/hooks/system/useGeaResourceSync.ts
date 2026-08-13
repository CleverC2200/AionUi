import { ipcBridge } from '@/common';
import { isBackendRouteUnavailableError } from '@/common/adapter/httpBridge';
import type { GeaClientResourceKind } from '@/common/adapter/ipcBridge';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type MessageInstance = ReturnType<typeof import('@arco-design/web-react').Message.useMessage>[0];

type UseGeaResourceSyncOptions = {
  available?: boolean;
  message: Pick<MessageInstance, 'error' | 'info' | 'success' | 'warning'>;
  refresh: () => Promise<boolean>;
  resource: GeaClientResourceKind;
};

export const useGeaResourceSync = ({
  available: availableOverride,
  message,
  refresh,
  resource,
}: UseGeaResourceSyncOptions) => {
  const { t } = useTranslation();
  const [detectedAvailable, setDetectedAvailable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const available = availableOverride ?? detectedAvailable;

  useEffect(() => {
    if (availableOverride !== undefined) return;

    let active = true;
    void ipcBridge.assistants.catalog.invoke().then(
      (catalog) => {
        if (!active) return;
        const managed = Array.isArray(catalog)
          ? catalog.some((assistant) => assistant.source === 'managed')
          : catalog.mode === 'managed';
        setDetectedAvailable(managed);
      },
      () => {
        if (active) setDetectedAvailable(false);
      }
    );

    return () => {
      active = false;
    };
  }, [availableOverride]);

  const syncFromGea = useCallback(async () => {
    if (!available) {
      message.warning(t('settings.geaResourceUnavailable'));
      return;
    }
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const result = await ipcBridge.clientResources.syncFromGea.invoke({ resources: [resource] });

      if (result.status === 'notAuthenticated') {
        message.warning(t('settings.geaResourceLoginRequired'));
        return;
      }
      if (result.status === 'unavailable') {
        message.warning(t('settings.geaResourceUnavailable'));
        return;
      }

      const refreshed = await refresh();
      if (!refreshed) {
        message.error(t('settings.geaResourceFetchFailed'));
        return;
      }
      if (result.status === 'partial') {
        message.error(t('settings.geaResourceFetchFailed'));
      } else if (result.changed > 0) {
        message.success(t('settings.geaResourceFetchSuccess', { count: result.changed }));
      } else {
        message.info(t('settings.geaResourceNoChanges'));
      }
    } catch (error) {
      const unsupportedRoute = isBackendRouteUnavailableError(error);
      message.error(unsupportedRoute ? t('settings.geaResourceUnavailable') : t('settings.geaResourceFetchFailed'));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [available, message, refresh, resource, t]);

  return { available, syncing, syncFromGea };
};
