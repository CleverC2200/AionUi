import {
  getAssistantSurfaceStateScope,
  readAssistantSurfaceState,
  writeAssistantSurfaceState,
} from '@renderer/pages/assistantSurface/storage';

describe('assistant surface session state', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps Fixture and live business state in separate scopes', () => {
    expect(getAssistantSurfaceStateScope('user-1', 'forecast', true)).toBe('user-1:forecast-fixture-01');
    expect(getAssistantSurfaceStateScope('user-1', 'forecast', false)).toBe('user-1:forecast-live-01');
  });

  it('isolates snapshots by surface and scope', () => {
    writeAssistantSurfaceState('forecast', 'workspace-a', { mode: 'split' });
    writeAssistantSurfaceState('forecast', 'workspace-b', { mode: 'workbench' });

    expect(readAssistantSurfaceState('forecast', 'workspace-a', null)).toEqual({ mode: 'split' });
    expect(readAssistantSurfaceState('forecast', 'workspace-b', null)).toEqual({ mode: 'workbench' });
  });

  it('returns the fallback when stored data is invalid', () => {
    sessionStorage.setItem('aionui:assistant-surface:v1:forecast:workspace', '{');
    expect(readAssistantSurfaceState('forecast', 'workspace', { mode: 'conversation' })).toEqual({
      mode: 'conversation',
    });
  });

  it('rejects snapshots from an incompatible version', () => {
    sessionStorage.setItem(
      'aionui:assistant-surface:v1:forecast:workspace',
      JSON.stringify({ version: 2, value: { mode: 'workbench' } })
    );
    expect(readAssistantSurfaceState('forecast', 'workspace', { mode: 'split' })).toEqual({ mode: 'split' });
  });
});
