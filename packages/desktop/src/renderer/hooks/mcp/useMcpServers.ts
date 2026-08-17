import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IMcpServer } from '@/common/config/storage';
import { ensureBackendMcpCatalog, isInternalMcpServer } from './catalog';

/**
 * MCP server state hook.
 * Combines backend-managed user servers with extension-contributed servers.
 */
export const useMcpServers = () => {
  const [mcpServers, setMcpServers] = useState<IMcpServer[]>([]);
  const [extensionMcpServers, setExtensionMcpServers] = useState<IMcpServer[]>([]);
  const [isMcpServersLoading, setIsMcpServersLoading] = useState(true);

  const refreshMcpServers = useCallback(async () => {
    setIsMcpServersLoading(true);
    try {
      const { allServers } = await ensureBackendMcpCatalog();
      setMcpServers(
        allServers.map((server) =>
          isInternalMcpServer(server) ? { ...server, last_test_status: 'disconnected' as const } : server
        )
      );
      return true;
    } catch (error) {
      console.error('[useMcpServers] Failed to load MCP catalog:', error);
      return false;
    } finally {
      setIsMcpServersLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshMcpServers();

    void ipcBridge.extensions.getMcpServers
      .invoke()
      .then((extServers) => {
        if (!extServers || extServers.length === 0) {
          setExtensionMcpServers([]);
          return;
        }

        const converted: IMcpServer[] = extServers.map((server) => ({
          id: String(server.id || ''),
          name: String(server.name || ''),
          description: server.description as string | undefined,
          enabled: server.enabled !== false,
          transport: server.transport as IMcpServer['transport'],
          created_at: (server.created_at as number) || Date.now(),
          updated_at: (server.updated_at as number) || Date.now(),
          original_json: String(server.original_json || '{}'),
          builtin: false,
        }));
        setExtensionMcpServers(converted);
      })
      .catch((error) => {
        console.error('[useMcpServers] Failed to load extension MCP servers:', error);
        setExtensionMcpServers([]);
      });
  }, [refreshMcpServers]);

  const saveMcpServers = useCallback((serversOrUpdater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => {
    setMcpServers((prevServers) =>
      typeof serversOrUpdater === 'function' ? serversOrUpdater(prevServers) : serversOrUpdater
    );
    return Promise.resolve();
  }, []);

  return {
    mcpServers,
    isMcpServersLoading,
    allMcpServers: [...mcpServers, ...extensionMcpServers],
    extensionMcpServers,
    setMcpServers,
    saveMcpServers,
    refreshMcpServers,
  };
};
