import { conversation } from '@/common/adapter/ipcBridge';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { useEffect, useRef, useState } from 'react';

export type SalesPlanAdviceState =
  | { key: string; status: 'ready'; answers: Record<string, string> }
  | {
      key: string;
      status: 'loading' | 'noSession' | 'noAnswer' | 'noModel' | 'toolsRequired' | 'failed' | 'timeout';
    };

/** Core resolves the owning conversation's model and performs text-only inference. */
export const useSalesPlanAdvice = (conversationId: string | null, scope: string | undefined, prompt: string) => {
  const key = JSON.stringify([conversationId, scope]);
  const [revision, setRevision] = useState(0);
  const selectedModel = useRef<string | undefined>(undefined);
  useEffect(() => {
    selectedModel.current = undefined;
    let active = true;
    const unsubscribe = conversation.listChanged.on((event) => {
      if (!conversationId || event.conversation_id !== conversationId || event.action !== 'updated') return;
      void conversation.get
        .invoke({ id: conversationId })
        .then((current) => {
          if (!active) return;
          const model = current.type === 'aionrs' ? current.model : undefined;
          const modelKey = JSON.stringify([model?.id, model?.use_model]);
          if (selectedModel.current !== modelKey) {
            selectedModel.current = modelKey;
            setRevision((value) => value + 1);
          }
        })
        .catch(() => {
          if (active) setState({ key, status: 'failed' });
        });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [conversationId, key]);
  const [state, setState] = useState<SalesPlanAdviceState>({ key: '', status: 'loading' });
  useEffect(() => {
    let active = true;
    if (!scope) return;
    if (!conversationId) {
      setState({ key, status: 'noSession' });
      return;
    }
    setState({ key, status: 'loading' });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      active = false;
      controller.abort();
      setState({ key, status: 'timeout' });
    }, 60000);
    void conversation.inferModel
      .invoke({ conversation_id: conversationId, question: `${prompt}\n${scope}`, signal: controller.signal })
      .then((response) => {
        if (!active) return;
        if (response.status !== 'ok') {
          setState({ key, status: response.status });
          return;
        }
        selectedModel.current = JSON.stringify([response.provider_id, response.model]);
        const raw = (response.answer ?? '')
          .trim()
          .replace(/^```(?:json)?\s*/, '')
          .replace(/\s*```$/, '');
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid advice');
        const answers = Object.fromEntries(
          Object.entries(parsed).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0
          )
        );
        setState(Object.keys(answers).length ? { key, status: 'ready', answers } : { key, status: 'noAnswer' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (
          error instanceof BackendHttpError &&
          error.status === 409 &&
          error.message.includes('MODEL_SELECTION_CHANGED')
        ) {
          setRevision((value) => value + 1);
        } else {
          setState({
            key,
            status:
              error instanceof BackendHttpError && error.message.includes('MODEL_NOT_SELECTED') ? 'noModel' : 'failed',
          });
        }
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [conversationId, key, scope, prompt, revision]);
  return {
    state: state.key === key ? state : { key, status: 'loading' as const },
    retry: () => setRevision((value) => value + 1),
  };
};
