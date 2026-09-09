import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useAionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';

const state = vi.hoisted(() => ({ providers: [] as IProvider[] }));
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useModelProviderList: () => ({
    providers: state.providers,
    getAvailableModels: (provider: IProvider) => provider.models ?? [],
    formatModelLabel: (_provider: unknown, name: string) => name,
  }),
}));
const stale = {
  id: 'gea-personal-old',
  name: 'GEA',
  platform: 'openai',
  base_url: 'http://127.0.0.1:60417/personal/gea-personal-old',
  models: ['model-1'],
  use_model: 'model-1',
} as TProviderWithModel;

beforeEach(() => {
  state.providers = [];
});

describe('GEA personal model selection after process restart', () => {
  it('does not allow sending through an old selection before its provider is restored', () => {
    const { result } = renderHook(() => useAionrsModelSelection({ initialModel: stale, onSelectModel: vi.fn() }));
    expect(result.current.current_model).toBeUndefined();
  });

  it('uses the restored endpoint and stops offering it when reconciliation disables the provider', () => {
    state.providers = [{ ...stale, base_url: 'http://127.0.0.1:63671/personal/gea-personal-old' } as IProvider];
    const { result, rerender } = renderHook(() =>
      useAionrsModelSelection({ initialModel: stale, onSelectModel: vi.fn() })
    );
    expect(result.current.current_model?.base_url).toContain(':63671/');
    state.providers = [];
    rerender();
    expect(result.current.current_model).toBeUndefined();
  });

  it('requires a new selection when the managed model is no longer available', () => {
    state.providers = [{ ...stale, models: ['another-model'] } as IProvider];
    const { result } = renderHook(() => useAionrsModelSelection({ initialModel: stale, onSelectModel: vi.fn() }));
    expect(result.current.current_model).toBeUndefined();
  });
});
