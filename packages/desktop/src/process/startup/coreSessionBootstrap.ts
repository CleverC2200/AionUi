import { getCoreSessionBootstrapSecret } from '@aionui/web-host';

/**
 * Consumes the trusted Core bootstrap secret at the desktop entry boundary.
 * Importing this module alone has no effect.
 */
export function initializeCoreSessionBootstrap<T>(initializeAfterBootstrap: () => T): {
  bootstrapSecret: string;
  initialized: T;
} {
  const bootstrapSecret = getCoreSessionBootstrapSecret();
  return { bootstrapSecret, initialized: initializeAfterBootstrap() };
}
