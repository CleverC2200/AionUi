import { describe, expect, test } from 'vitest';
import {
  BUSINESS_ASSISTANT_GROUPS,
  BUSINESS_ASSISTANT_SURFACES,
  DEFAULT_BUSINESS_ASSISTANT_SURFACE,
  getAssistantSurface,
  validateAssistantSurfaceRegistry,
} from '@/renderer/pages/assistantSurface/registry';

describe('assistant surface registry', () => {
  test('keeps General outside the Business agent menu', () => {
    expect(BUSINESS_ASSISTANT_SURFACES.map((surface) => surface.id)).toEqual(['forecast']);
    expect(BUSINESS_ASSISTANT_SURFACES.some((surface) => surface.id === 'general')).toBe(false);
  });

  test('registers Demand Forecast as the only Business agent menu', () => {
    expect(DEFAULT_BUSINESS_ASSISTANT_SURFACE?.id).toBe('forecast');
    expect(getAssistantSurface('forecast')?.businessMenu).toEqual({
      order: 10,
      icon: 'forecast',
      groupId: 'planning',
    });
    expect(getAssistantSurface('contract')).toBeUndefined();
  });

  test('groups every Business agent under an expandable navigation category', () => {
    expect(BUSINESS_ASSISTANT_GROUPS.map((group) => group.id)).toEqual(['planning']);
    expect(BUSINESS_ASSISTANT_SURFACES.map((surface) => [surface.id, surface.businessMenu.groupId])).toEqual([
      ['forecast', 'planning'],
    ]);
  });

  test('keeps ids, routes, and Business menu order unambiguous', () => {
    expect(validateAssistantSurfaceRegistry()).toEqual([]);
  });
});
