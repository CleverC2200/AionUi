import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { GeaClientResourceKind } from '@/common/adapter/ipcBridge';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

type MessageInstance = ReturnType<typeof import('@arco-design/web-react').Message.useMessage>[0];

type UseGeaResourceSyncOptions = {
  message: Pick<MessageInstance, 'error' | 'info' | 'success' | 'warning'>;
  refresh: () => Promise<unknown>;
  resource: GeaClientResourceKind;
};

export const useGeaResourceSync = ({ message, refresh, resource }: UseGeaResourceSyncOptions) => {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);

  const syncFromGea = useCallback(async () => {
    if (syncing) return;
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

      await refresh();
      if (result.status === 'partial') {
        message.error(t('settings.geaResourceFetchFailed'));
      } else if (result.changed > 0) {
        message.success(t('settings.geaResourceFetchSuccess', { count: result.changed }));
      } else {
        message.info(t('settings.geaResourceNoChanges'));
      }
    } catch (error) {
      const unsupportedRoute = isBackendHttpError(error) && error.status === 404 && error.code === 'NOT_FOUND';
      message.error(unsupportedRoute ? t('settings.geaResourceUnavailable') : t('settings.geaResourceFetchFailed'));
    } finally {
      setSyncing(false);
    }
  }, [message, refresh, resource, syncing, t]);

  return { syncing, syncFromGea };
};
