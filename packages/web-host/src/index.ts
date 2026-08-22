import type { WebHostOptions, WebHostHandle } from './types.js';

export type {
  AppMetadata,
  BackendBinaryResolver,
  WebHostLarkAuth,
  WebHostLarkAuthPoll,
  WebHostLarkAuthResult,
  WebHostLarkExternalIdentity,
  WebHostOptions,
  WebHostHandle,
} from './types.js';
export { CoreSessionClient, CoreSessionClientError, getCoreSessionBootstrapSecret } from './core-session-client.js';
export type {
  CoreExternalIdentity,
  CoreExternalIdentityMapping,
  CoreSession,
  CoreSessionRevocation,
} from './core-session-client.js';
export { startStaticServer, stopStaticServer } from './static-server.js';
export type { StaticServerOptions, StaticServerHandle } from './static-server.js';
export {
  createGeaLarkAuth,
  GeaLarkAuthService,
  GeaLarkAuthServiceError,
  GeaMcpGatewayError,
  GeaPersonalModelError,
} from './gea-lark-auth.js';
export type {
  GeaClaimedPersonalModelCredential,
  GeaGatewayAuthSession,
  GeaLarkAuthSession,
  GeaLarkAuthSessionStore,
  GeaMcpGatewayCallResult,
  GeaMcpGatewaySession,
  GeaMcpGatewayTool,
  GeaPersonalModelCredential,
  GeaPersonalModelCredentialStatus,
} from './gea-lark-auth.js';
export { startGeaMcpBridge } from './gea-mcp-bridge.js';
export type { GeaMcpBridgeHandle } from './gea-mcp-bridge.js';

// Backend launcher exports (M4)
export {
  BackendStartupCancelledError,
  BackendLifecycleManager,
  buildSpawnArgs,
  buildSpawnEnv,
  findAvailablePort,
  startBackend,
  stopBackend,
} from './backend-launcher.js';
export type { BackendDirConfig, BackendLaunchOptions, BackendHandle, BackendStartOptions } from './backend-launcher.js';

/**
 * Start WebHost (main entry point).
 *
 * Orchestrates backend-launcher + static-server. web-host itself holds no
 * persistent configuration — callers (Electron main process, `bun run webui`
 * CLI) are responsible for resolving port / allowRemote from their own source
 * of truth (Electron ProcessConfig, CLI flags, env vars).
 */
export async function startWebHost(opts: WebHostOptions): Promise<WebHostHandle> {
  const { startBackend } = await import('./backend-launcher.js');
  const { startStaticServer } = await import('./static-server.js');
  const { getCoreSessionBootstrapSecret } = await import('./core-session-client.js');
  const heldBootstrapSecret = getCoreSessionBootstrapSecret();
  const coreSessionBootstrapSecret = opts.coreSessionBootstrapSecret ?? heldBootstrapSecret;

  // 1. Start backend (M4)
  let backendHandle;
  if (opts.backend.kind === 'ownBackend') {
    backendHandle = await startBackend({
      app: opts.app,
      resolveBackend: opts.backend.resolveBackend,
      dataDir: opts.dataDir,
      logDir: opts.logDir,
      dirs: opts.dirs,
      coreSessionBootstrapSecret,
    });
  } else {
    // useExistingBackend: create a fake handle
    backendHandle = {
      port: opts.backend.port,
      stop: async () => {
        // no-op: external backend
      },
    };
  }

  let staticHandle;
  try {
    // 2. Start static-server (M5)
    staticHandle = await startStaticServer({
      staticDir: opts.staticDir,
      backendPort: backendHandle.port,
      port: opts.port,
      allowRemote: opts.allowRemote ?? false,
      larkAuth: opts.larkAuth,
      coreSessionBootstrapSecret,
    });
  } catch (err) {
    // If static-server fails, clean up backend
    await backendHandle.stop();
    throw err;
  }

  // 3. Return combined handle
  return {
    port: staticHandle.port,
    backendPort: backendHandle.port,
    url: staticHandle.url,
    localUrl: staticHandle.localUrl,
    networkUrl: staticHandle.networkUrl,
    lanIP: staticHandle.lanIP,
    async stop() {
      await staticHandle.stop();
      await backendHandle.stop();
    },
  };
}
