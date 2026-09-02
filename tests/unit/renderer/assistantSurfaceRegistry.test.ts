import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BUSINESS_ASSISTANT_GROUPS,
  BUSINESS_ASSISTANT_SURFACES,
  DEFAULT_ASSISTANT_SURFACE,
  getAssistantSurface,
  getAssistantSurfaceFromPath,
  isAssistantSurfaceAvailable,
} from '@renderer/pages/assistantSurface/registry';

describe('assistant surface registry', () => {
  it('resolves registered specialized surfaces', () => {
    expect(getAssistantSurface('forecast')?.route).toBe('/assistant-surface/forecast');
    expect(getAssistantSurface('forecast')?.fixtureOnly).toBe(false);
    expect(getAssistantSurface('forecast')?.managed).toBe(true);
    expect(getAssistantSurface('forecast')?.component).toBe('forecast-reference');
    expect(getAssistantSurface('forecast')?.defaultView).toBe('workbench');
    expect(getAssistantSurface('forecast')?.businessMenu?.badge).toBeUndefined();
    expect(getAssistantSurfaceFromPath('/assistant-surface/forecast')).toBe(getAssistantSurface('forecast'));
  });

  it('does not expose the removed Contract menu, route, or page module', () => {
    expect.soft(BUSINESS_ASSISTANT_GROUPS.map((group) => group.id)).not.toContain('contracts');
    expect.soft(BUSINESS_ASSISTANT_SURFACES.map((surface) => surface.id)).not.toContain('contract');
    expect.soft(getAssistantSurface('contract')).toBeUndefined();
    expect.soft(getAssistantSurfaceFromPath('/assistant-surface/contract')).toBe(DEFAULT_ASSISTANT_SURFACE);
    for (const pageFile of [
      'packages/desktop/src/renderer/pages/assistantSurface/ContractAssistantSurface.tsx',
      'packages/desktop/src/renderer/pages/assistantSurface/workbenches/ContractReferenceWorkbench.tsx',
      'packages/desktop/src/renderer/pages/assistantSurface/workbenches/ContractReferenceWorkbench.module.css',
    ]) {
      expect.soft(existsSync(resolve(process.cwd(), pageFile)), pageFile).toBe(false);
    }
  });

  it('keeps existing pages on the General surface', () => {
    expect(getAssistantSurfaceFromPath('/guid')).toBe(DEFAULT_ASSISTANT_SURFACE);
    expect(getAssistantSurfaceFromPath('/conversation/fixture')).toBe(DEFAULT_ASSISTANT_SURFACE);
  });

  it('fails closed to General for unknown surface routes', () => {
    expect(getAssistantSurfaceFromPath('/assistant-surface/unknown')).toBe(DEFAULT_ASSISTANT_SURFACE);
  });

  it('keeps the Forecast business surface available when the development flag is absent', () => {
    expect(isAssistantSurfaceAvailable(DEFAULT_ASSISTANT_SURFACE)).toBe(true);
    expect(isAssistantSurfaceAvailable(getAssistantSurface('forecast')!)).toBe(true);
  });
});
