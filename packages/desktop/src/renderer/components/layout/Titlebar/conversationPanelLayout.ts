import { useEffect, useState } from 'react';

export type ConversationPanelSide = 'left' | 'right';

const STORAGE_KEY = 'conversation-extension-panel-side';
const CHANGE_EVENT = 'aionui-conversation-panel-side-change';

export function readConversationPanelSide(): ConversationPanelSide {
  if (typeof window === 'undefined') return 'right';
  try {
    return localStorage.getItem(STORAGE_KEY) === 'left' ? 'left' : 'right';
  } catch {
    return 'right';
  }
}

export function setConversationPanelSide(side: ConversationPanelSide): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, side);
  } catch {
    // The live layout can still update when persistence is unavailable.
  }
  window.dispatchEvent(new CustomEvent<ConversationPanelSide>(CHANGE_EVENT, { detail: side }));
}

export function useConversationPanelSide(): ConversationPanelSide {
  const [side, setSide] = useState<ConversationPanelSide>(() => readConversationPanelSide());

  useEffect(() => {
    const handleChange = (event: Event) => {
      const next = (event as CustomEvent<ConversationPanelSide>).detail;
      if (next === 'left' || next === 'right') setSide(next);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setSide(readConversationPanelSide());
    };
    window.addEventListener(CHANGE_EVENT, handleChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handleChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return side;
}
