import { Collapse } from '@arco-design/web-react';
import React from 'react';
import type { IMcpServer } from '@/common/config/storage';
import McpServerHeader from './McpServerHeader';
import McpServerToolsList from './McpServerToolsList';
import type { McpOAuthStatus } from '@/renderer/hooks/mcp/useMcpOAuth';

interface McpServerItemProps {
  server: IMcpServer;
  isCollapsed: boolean;
  isTestingConnection: boolean;
  oauthStatus?: McpOAuthStatus;
  isLoggingIn?: boolean;
  /** Extension-contributed servers are read-only (no edit/delete) */
  isReadOnly?: boolean;
  /** Server-owned configuration still permits local authentication and connection checks. */
  isConfigurationReadOnly?: boolean;
  isTogglingEnabled?: boolean;
  onToggleCollapse: () => void;
  onTestConnection: (server: IMcpServer) => void;
  onEditServer: (server: IMcpServer) => void;
  onDeleteServer: (serverId: string) => void;
  onOAuthLogin?: (server: IMcpServer) => void;
  onToggleEnabled?: (server: IMcpServer, enabled: boolean) => void;
}

const McpServerItem: React.FC<McpServerItemProps> = ({
  server,
  isCollapsed,
  isTestingConnection,
  oauthStatus,
  isLoggingIn,
  isReadOnly,
  isConfigurationReadOnly,
  isTogglingEnabled,
  onToggleCollapse,
  onTestConnection,
  onEditServer,
  onDeleteServer,
  onOAuthLogin,
  onToggleEnabled,
}) => {
  return (
    <div
      data-testid={`mcp-server-${server.id}`}
      data-server-name={server.name}
      data-readonly={isReadOnly ? 'true' : 'false'}
      data-configuration-readonly={isConfigurationReadOnly ? 'true' : 'false'}
    >
      <Collapse
        key={server.id}
        activeKey={isCollapsed ? ['1'] : []}
        onChange={onToggleCollapse}
        className='mb-4 [&_div.arco-collapse-item-header-title]:flex-1'
      >
        <Collapse.Item
          header={
            <McpServerHeader
              server={server}
              isTestingConnection={isTestingConnection}
              oauthStatus={oauthStatus}
              isLoggingIn={isLoggingIn}
              isReadOnly={isReadOnly}
              isConfigurationReadOnly={isConfigurationReadOnly}
              isTogglingEnabled={isTogglingEnabled}
              onTestConnection={onTestConnection}
              onEditServer={onEditServer}
              onDeleteServer={onDeleteServer}
              onOAuthLogin={onOAuthLogin}
              onToggleEnabled={onToggleEnabled}
            />
          }
          name='1'
          className={'[&_div.arco-collapse-item-content-box]:py-3'}
        >
          <McpServerToolsList server={server} />
        </Collapse.Item>
      </Collapse>
    </div>
  );
};

export default McpServerItem;
