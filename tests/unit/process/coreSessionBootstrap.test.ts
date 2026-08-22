import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeCoreSessionBootstrap } from '@/process/startup/coreSessionBootstrap';

describe('core session bootstrap startup order', () => {
  const previousSecret = process.env.AIONCORE_BOOTSTRAP_SECRET;

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.AIONCORE_BOOTSTRAP_SECRET;
    else process.env.AIONCORE_BOOTSTRAP_SECRET = previousSecret;
  });

  it('does not consume the ambient secret merely by importing the sequencing module', async () => {
    vi.resetModules();
    process.env.AIONCORE_BOOTSTRAP_SECRET = 'still-ambient';

    await import('@/process/startup/coreSessionBootstrap');

    expect(process.env.AIONCORE_BOOTSTRAP_SECRET).toBe('still-ambient');
  });

  it('consumes the ambient secret before PATH initialization can spawn a child', () => {
    process.env.AIONCORE_BOOTSTRAP_SECRET = 'server-only-secret';
    let childValue = '';

    const result = initializeCoreSessionBootstrap(() => {
      expect(process.env.AIONCORE_BOOTSTRAP_SECRET).toBeUndefined();
      childValue = execFileSync(
        process.execPath,
        ['-e', 'process.stdout.write(process.env.AIONCORE_BOOTSTRAP_SECRET ?? "missing")'],
        { encoding: 'utf8', env: process.env }
      );
      return 'initialized';
    });

    expect(result).toEqual({ bootstrapSecret: 'server-only-secret', initialized: 'initialized' });
    expect(childValue).toBe('missing');
  });
});
