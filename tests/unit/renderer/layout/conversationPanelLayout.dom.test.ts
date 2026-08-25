import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  readConversationPanelSide,
  setConversationPanelSide,
  useConversationPanelSide,
} from '@/renderer/components/layout/Titlebar/conversationPanelLayout';

describe('conversation extension panel side', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to the right and persists a valid side', () => {
    expect(readConversationPanelSide()).toBe('right');
    setConversationPanelSide('left');
    expect(readConversationPanelSide()).toBe('left');
  });

  it('updates mounted layout consumers in the same window', () => {
    const { result } = renderHook(() => useConversationPanelSide());
    act(() => setConversationPanelSide('left'));
    expect(result.current).toBe('left');
  });
});
