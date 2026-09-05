import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_GEN_ENV_KEYS } from '@/common/config/imageGenerationMcpEnv';
import { BUILTIN_IMAGE_GEN_NAME, type IMcpServer, type IProvider } from '@/common/config/storage';
import {
  ensureBuiltinGeaMcpServerAvailable,
  resolveImageGenerationMigrationConfig,
  runBackendMigrations,
} from '@/process/utils/runBackendMigrations';

const {
  batchImportServersMock,
  configFileGetMock,
  configFileSetMock,
  httpRequestMock,
  listServersMock,
  testMcpConnectionMock,
  toggleServerMock,
  updateServerMock,
} = vi.hoisted(() => ({
  batchImportServersMock: vi.fn(),
  configFileGetMock: vi.fn(),
  configFileSetMock: vi.fn(),
  httpRequestMock: vi.fn(),
  listServersMock: vi.fn(),
  testMcpConnectionMock: vi.fn(),
  toggleServerMock: vi.fn(),
  updateServerMock: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: httpRequestMock,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {
    listServers: { invoke: listServersMock },
    batchImportServers: { invoke: batchImportServersMock },
    updateServer: { invoke: updateServerMock },
    toggleServer: { invoke: toggleServerMock },
    testMcpConnection: { invoke: testMcpConnectionMock },
  },
}));

vi.mock('@/common/config/configMigration', () => ({
  migrateConfigStorage: vi.fn().mockResolvedValue(undefined),
  migrateLegacyMcpConfigToDb: vi.fn().mockResolvedValue(undefined),
  migrateProviders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/process/utils/initStorage', () => ({
  getBuiltinMcpScriptPath: (name: string) => `/mock/${name}.js`,
  getBundledChromeDevtoolsMcpPath: () => '/mock/chrome-devtools-mcp/build/src/index.js',
}));

vi.mock('@/process/utils/migrateAssistants', () => ({
  migrateAssistantsToBackend: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/process/backend', () => ({
  resolveBinaryPath: vi.fn(() => '/mock/aioncore'),
}));

const provider: IProvider = {
  id: 'provider-1',
  platform: 'gemini',
  name: 'Gemini',
  base_url: 'https://generativelanguage.googleapis.com',
  api_key: 'provider-key',
  models: ['gemini-image'],
  enabled: true,
};

const imageEnv = {
  [IMAGE_GEN_ENV_KEYS.providerId]: 'provider-1',
  [IMAGE_GEN_ENV_KEYS.platform]: 'gemini',
  [IMAGE_GEN_ENV_KEYS.baseUrl]: 'https://generativelanguage.googleapis.com',
  [IMAGE_GEN_ENV_KEYS.apiKey]: 'provider-key',
  [IMAGE_GEN_ENV_KEYS.model]: 'gemini-image',
};

const imageServer = (): IMcpServer => ({
  id: 'image-server-id',
  name: BUILTIN_IMAGE_GEN_NAME,
  description: 'Built-in image generation tool powered by AI models. Configure the model in Settings > Tools.',
  enabled: true,
  builtin: true,
  transport: {
    type: 'stdio',
    command: 'node',
    args: ['/mock/builtin-mcp-image-gen.js'],
    env: imageEnv,
  },
  created_at: 1,
  updated_at: 1,
  original_json: JSON.stringify(
    {
      mcpServers: {
        [BUILTIN_IMAGE_GEN_NAME]: {
          command: 'node',
          args: ['/mock/builtin-mcp-image-gen.js'],
          env: imageEnv,
        },
      },
    },
    null,
    2
  ),
});

const legacyGeaServer = (): IMcpServer => ({
  id: 'legacy-gea-id',
  name: 'gea',
  enabled: true,
  builtin: false,
  transport: {
    type: 'sse',
    url: 'https://gea.synear.cn/gea-boot/ai/gateway/mcp/proxy/sse',
  },
  created_at: 1,
  updated_at: 1,
  original_json: '{}',
});

const legacyChromeDevtoolsServer = (packageVersion = 'chrome-devtools-mcp@latest'): IMcpServer => ({
  id: 'chrome-devtools-id',
  name: 'chrome-devtools',
  description: 'Default MCP server: chrome-devtools',
  enabled: false,
  builtin: true,
  last_test_status: 'error',
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', packageVersion],
  },
  created_at: 1,
  updated_at: 1,
  original_json: JSON.stringify(
    {
      mcpServers: {
        'chrome-devtools': {
          command: 'npx',
          args: ['-y', packageVersion],
        },
      },
    },
    null,
    2
  ),
});

const legacyBuiltinScriptServer = (
  name: 'aionui-browser' | 'lark-cli',
  lastTestStatus: IMcpServer['last_test_status'] = 'error'
): IMcpServer => ({
  id: `${name}-id`,
  name,
  enabled: name === 'aionui-browser',
  builtin: true,
  last_test_status: lastTestStatus,
  transport: {
    type: 'stdio',
    command: 'node',
    args: [`/mock/builtin-mcp-${name === 'aionui-browser' ? 'browser' : 'lark-cli'}.js`],
  },
  created_at: 1,
  updated_at: 1,
  original_json: '{}',
});

const configFile = {
  get: configFileGetMock,
  set: configFileSetMock,
};

beforeEach(() => {
  vi.clearAllMocks();
  configFileGetMock.mockResolvedValue(undefined);
  configFileSetMock.mockResolvedValue(undefined);
  batchImportServersMock.mockResolvedValue([]);
  updateServerMock.mockImplementation(async ({ id, data }) => ({
    ...imageServer(),
    id,
    ...data,
  }));
  testMcpConnectionMock.mockResolvedValue({ success: false, error: 'Command not found: npx' });
  httpRequestMock.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/api/settings/client') {
      return {
        'tools.imageGenerationModel': {
          id: 'provider-1',
          name: 'Gemini',
          platform: 'gemini',
          use_model: 'gemini-image',
        },
      };
    }
    if (method === 'GET' && path === '/api/providers') {
      return [provider];
    }
    return undefined;
  });
});

describe('resolveImageGenerationMigrationConfig', () => {
  it('uses backend client preference when local config file no longer has the image model', () => {
    const backendConfig = {
      id: 'gemini',
      name: 'Gemini',
      platform: 'gemini',
      base_url: 'https://example.test',
      api_key: 'backend-key',
      use_model: 'gemini-image',
    };

    expect(resolveImageGenerationMigrationConfig({ 'tools.imageGenerationModel': backendConfig }, undefined)).toEqual(
      backendConfig
    );
  });
});

describe('ensureBuiltinGeaMcpServerAvailable', () => {
  it('imports the global GEA gateway before renderer-backed migrations run', async () => {
    listServersMock.mockResolvedValue([]);

    await ensureBuiltinGeaMcpServerAvailable();

    expect(batchImportServersMock).toHaveBeenCalledWith({
      servers: [
        expect.objectContaining({
          name: 'gea-gateway',
          enabled: true,
          builtin: true,
          transport: {
            type: 'stdio',
            command: '/mock/aioncore',
            args: ['mcp-gea-stdio'],
            env: { AIONUI_GEA_AGENT_CODE: 'sales_forecast' },
          },
        }),
      ],
    });
  });

  it('does not duplicate an existing global GEA gateway', async () => {
    listServersMock.mockResolvedValue([
      {
        id: 'gea-gateway',
        name: 'gea-gateway',
        builtin: true,
      },
    ]);

    await ensureBuiltinGeaMcpServerAvailable();

    expect(batchImportServersMock).not.toHaveBeenCalled();
  });
});

describe('runBackendMigrations', () => {
  it('migrates the built-in chrome-devtools MCP away from the unbounded latest tag', async () => {
    const migratedChromeDevtoolsServer: IMcpServer = {
      ...legacyChromeDevtoolsServer(),
      transport: {
        type: 'stdio',
        command: 'node',
        args: ['/mock/chrome-devtools-mcp/build/src/index.js'],
      },
    };
    listServersMock
      .mockResolvedValueOnce([legacyChromeDevtoolsServer()])
      .mockResolvedValueOnce([migratedChromeDevtoolsServer]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledWith({
      id: 'chrome-devtools-id',
      data: {
        builtin: true,
        transport: {
          type: 'stdio',
          command: 'node',
          args: ['/mock/chrome-devtools-mcp/build/src/index.js'],
        },
        original_json: JSON.stringify(
          {
            mcpServers: {
              'chrome-devtools': {
                command: 'node',
                args: ['/mock/chrome-devtools-mcp/build/src/index.js'],
              },
            },
          },
          null,
          2
        ),
      },
    });
    expect(testMcpConnectionMock).toHaveBeenCalledWith(migratedChromeDevtoolsServer);
  });

  it('uses the pinned chrome-devtools MCP version for a fresh bootstrap', async () => {
    listServersMock.mockResolvedValue([]);

    await runBackendMigrations(configFile as never);

    expect(batchImportServersMock).toHaveBeenCalledWith({
      servers: expect.arrayContaining([
        expect.objectContaining({
          name: 'chrome-devtools',
          transport: {
            type: 'stdio',
            command: 'node',
            args: ['/mock/chrome-devtools-mcp/build/src/index.js'],
          },
        }),
      ]),
    });
  });

  it('moves the transitional pinned npx config to the bundled MCP entry', async () => {
    const transitionalServer = legacyChromeDevtoolsServer('chrome-devtools-mcp@0.16.0');
    listServersMock.mockResolvedValue([transitionalServer]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledWith({
      id: 'chrome-devtools-id',
      data: expect.objectContaining({
        transport: {
          type: 'stdio',
          command: 'node',
          args: ['/mock/chrome-devtools-mcp/build/src/index.js'],
        },
      }),
    });
  });

  it('preserves a customized chrome-devtools MCP package version', async () => {
    const customChromeDevtoolsServer: IMcpServer = {
      ...legacyChromeDevtoolsServer(),
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'chrome-devtools-mcp@1.7.0'],
      },
      last_test_status: 'connected',
      original_json: JSON.stringify({
        mcpServers: {
          'chrome-devtools': {
            command: 'npx',
            args: ['-y', 'chrome-devtools-mcp@1.7.0'],
          },
        },
      }),
    };
    listServersMock.mockResolvedValue([customChromeDevtoolsServer]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).not.toHaveBeenCalled();
    expect(testMcpConnectionMock).not.toHaveBeenCalled();
  });

  it.each([
    ['aionui-browser', 'error'],
    ['aionui-browser', 'disconnected'],
    ['lark-cli', 'error'],
    ['lark-cli', 'disconnected'],
  ] as const)(
    'retests a %s server with stale status %s after upgrading its bundled launcher',
    async (name, lastTestStatus) => {
      const existingServer = legacyBuiltinScriptServer(name, lastTestStatus);
      const updatedServer: IMcpServer = {
        ...existingServer,
        transport: {
          ...existingServer.transport,
          env: { AIONUI_BUNDLED_MCP_REVISION: '3' },
        },
      };
      listServersMock.mockResolvedValue([existingServer]);
      updateServerMock.mockResolvedValueOnce(updatedServer);
      testMcpConnectionMock.mockResolvedValueOnce({ success: true, tools: [] });

      await runBackendMigrations(configFile as never);

      expect(updateServerMock).toHaveBeenCalledWith({
        id: `${name}-id`,
        data: expect.objectContaining({
          transport: expect.objectContaining({ env: { AIONUI_BUNDLED_MCP_REVISION: '3' } }),
        }),
      });
      expect(testMcpConnectionMock).toHaveBeenCalledWith(updatedServer);
    }
  );

  it('disables the obsolete GEA SSE entry when the managed gateway is bootstrapped', async () => {
    listServersMock.mockResolvedValue([legacyGeaServer()]);

    await runBackendMigrations(configFile as never);

    expect(toggleServerMock).toHaveBeenCalledWith({ id: 'legacy-gea-id' });
  });

  it('does not write image generation business config back to local config storage', async () => {
    listServersMock.mockResolvedValue([imageServer()]);
    configFileGetMock.mockImplementation(async (key: string) => {
      if (key === 'tools.imageGenerationModel') {
        return {
          id: 'provider-1',
          name: 'Gemini',
          platform: 'gemini',
          use_model: 'gemini-image',
          switch: true,
        };
      }
      return undefined;
    });
    httpRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/api/settings/client') {
        return {};
      }
      if (method === 'GET' && path === '/api/providers') {
        return [provider];
      }
      return undefined;
    });

    await runBackendMigrations(configFile as never);

    expect(configFileSetMock).not.toHaveBeenCalledWith('tools.imageGenerationModel', expect.anything());
  });

  it('does not sync the built-in image MCP server when bootstrap makes no effective change', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    listServersMock.mockResolvedValue([imageServer()]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).not.toHaveBeenCalled();
    expect(testMcpConnectionMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      'image-server-id',
      'no',
      'no',
      'no'
    );
  });

  it('does not sync agents when only the stored image MCP JSON representation differs', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    listServersMock.mockResolvedValue([
      {
        ...imageServer(),
        original_json: '{"legacy":true}',
      },
    ]);

    await runBackendMigrations(configFile as never);

    expect(updateServerMock).toHaveBeenCalledOnce();
    expect(testMcpConnectionMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[Migration] image MCP bootstrap decision, server id: %s, transport changed: %s, json changed: %s, will update: %s',
      'image-server-id',
      'no',
      'yes',
      'yes'
    );
  });
});
