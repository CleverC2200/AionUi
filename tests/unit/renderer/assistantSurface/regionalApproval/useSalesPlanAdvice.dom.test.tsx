import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversation, modelInference, type ConversationModelInferenceResult } from '@/common/adapter/ipcBridge';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { TChatConversation } from '@/common/config/storage';
import { useSalesPlanAdvice } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/hooks/useSalesPlanAdvice';

beforeEach(() => {
  vi.spyOn(conversation.listChanged, 'on').mockReturnValue(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sales plan advice lifecycle', () => {
  it('retains completed advice and retries only missing rows individually without reusing another scope', async () => {
    const finishers: Array<(value: ConversationModelInferenceResult) => void> = [];
    const invoke = vi
      .spyOn(modelInference, 'invoke')
      .mockImplementation(() => new Promise((resolve) => finishers.push(resolve)));
    const rows = Array.from({ length: 10 }, (_, index) => ({ id: `sku-${index}` }));
    const { result, rerender } = renderHook(
      ({ page }) => useSalesPlanAdvice(JSON.stringify({ page, rows }), 'prompt'),
      { initialProps: { page: 1 } }
    );
    const finish = async (index: number) => {
      const requestedRows: Array<{ id: string }> = JSON.parse(invoke.mock.calls[index][0].question.split('\n')[1]).rows;
      await act(async () =>
        finishers[index]({
          status: 'ok',
          provider_id: 'p',
          model: 'default',
          answer: JSON.stringify(Object.fromEntries(requestedRows.map((row) => [row.id, `Advice ${row.id}`]))),
        })
      );
    };
    await finish(0);
    await act(async () => finishers[1]({ status: 'timeout', provider_id: 'p', model: 'default' }));
    expect(result.current.state).toMatchObject({ status: 'partial', completed: 5, total: 10 });
    act(() => result.current.retry());
    expect(result.current.state).toMatchObject({ status: 'loading', completed: 5, answers: { 'sku-0': 'Advice r0' } });
    expect(invoke).toHaveBeenCalledTimes(4);
    await finish(2);
    await finish(3);
    await finish(4);
    await finish(5);
    await finish(6);
    expect(invoke.mock.calls.slice(2).map(([request]) => JSON.parse(request.question.split('\n')[1]).rows)).toEqual(
      Array.from({ length: 5 }, (_, index) => [{ id: `r${index + 5}` }])
    );
    expect(result.current.state).toMatchObject({ status: 'ready', completed: 10, total: 10 });
    expect(invoke).toHaveBeenCalledTimes(7);
    rerender({ page: 2 });
    expect(result.current.state).toMatchObject({ status: 'loading', completed: 0, answers: {} });
    expect(invoke).toHaveBeenCalledTimes(9);
    expect(JSON.parse(invoke.mock.calls[7][0].question.split('\n')[1]).rows).toHaveLength(5);
  });

  it('generates a page in bounded batches and shows completed rows before the whole page finishes', async () => {
    const finishers: Array<(value: ConversationModelInferenceResult) => void> = [];
    const invoke = vi
      .spyOn(modelInference, 'invoke')
      .mockImplementation(() => new Promise((resolve) => finishers.push(resolve)));
    const rows = Array.from({ length: 20 }, (_, index) => ({ id: `region\u0000sku-${index}`, sku: `sku-${index}` }));
    const { result } = renderHook(() => useSalesPlanAdvice(JSON.stringify({ page: 1, total: 205, rows }), 'prompt'));
    expect(invoke).toHaveBeenCalledTimes(2);
    const finishBatch = async (index: number) => {
      const scope = JSON.parse(invoke.mock.calls[index][0].question.split('\n')[1]);
      expect(scope.rows).toHaveLength(5);
      expect(scope.total).toBe(205);
      await act(async () =>
        finishers[index]({
          status: 'ok',
          provider_id: 'p',
          model: 'default',
          answer: JSON.stringify(
            Object.fromEntries(scope.rows.map((row: { id: string; sku: string }) => [row.id, `Advice ${row.sku}`]))
          ),
        })
      );
    };
    await finishBatch(0);
    expect(result.current.state).toMatchObject({
      status: 'loading',
      completed: 5,
      total: 20,
      answers: { ['region\u0000sku-0']: 'Advice sku-0' },
    });
    expect(invoke).toHaveBeenCalledTimes(3);
    await finishBatch(1);
    expect(invoke).toHaveBeenCalledTimes(4);
    await finishBatch(2);
    await finishBatch(3);
    expect(result.current.state).toMatchObject({ status: 'ready', completed: 20, total: 20 });
    expect(Object.keys(result.current.state.answers)).toHaveLength(20);
  });
  it('does not restart pending advice when the right conversation emits updates', async () => {
    vi.useFakeTimers();
    const invoke = vi.spyOn(modelInference, 'invoke').mockImplementation(() => new Promise(() => {}));
    vi.spyOn(conversation.get, 'invoke').mockResolvedValue({
      id: 'conversation',
      type: 'aionrs',
      model: { id: 'p', use_model: 'm' },
    } as TChatConversation);
    const { result } = renderHook(() => useSalesPlanAdvice('scope', 'prompt'));
    await act(async () => {
      vi.advanceTimersByTime(59000);
      for (const [handler] of vi.mocked(conversation.listChanged.on).mock.calls)
        handler({ conversation_id: 'conversation', action: 'updated' });
    });
    act(() => vi.advanceTimersByTime(1000));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.current.state.status).toBe('timeout');
  });
  it('generates advice without creating or reading a conversation', async () => {
    const invoke = vi
      .spyOn(modelInference, 'invoke')
      .mockResolvedValue({ status: 'ok', provider_id: 'p', model: 'default', answer: '{"sku":"advice"}' });
    const get = vi.spyOn(conversation.get, 'invoke');
    const { result } = renderHook(() => useSalesPlanAdvice('scope', 'prompt'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(conversation.listChanged.on).not.toHaveBeenCalled();
  });

  it('stays idle without current page data', () => {
    const invoke = vi.spyOn(modelInference, 'invoke');
    const { result } = renderHook(() => useSalesPlanAdvice(undefined, 'prompt'));
    expect(result.current.state.status).toBe('idle');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('uses only the current scope and ignores a previous scope response', async () => {
    let finishOld!: (value: ConversationModelInferenceResult) => void;
    const invoke = vi
      .spyOn(modelInference, 'invoke')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          })
      )
      .mockResolvedValueOnce({
        status: 'ok',
        provider_id: 'provider',
        model: 'model',
        answer: '{"sku-b":"Review current demand"}',
      });
    const { result, rerender } = renderHook(({ scope }) => useSalesPlanAdvice(scope, 'prompt'), {
      initialProps: { scope: 'scope-a' },
    });
    rerender({ scope: 'scope-b' });
    expect(invoke.mock.calls[0][0].signal?.aborted).toBe(true);
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ status: 'ready', answers: { 'sku-b': 'Review current demand' } })
    );
    await act(async () => {
      finishOld({ status: 'ok', provider_id: 'provider', model: 'model', answer: '{"sku-a":"Stale advice"}' });
    });
    expect(result.current.state).toMatchObject({ status: 'ready', answers: { 'sku-b': 'Review current demand' } });
    expect(invoke).toHaveBeenLastCalledWith({
      question: 'prompt\nscope-b',
      signal: expect.any(AbortSignal),
    });
  });

  it('exposes missing answers and malformed responses as explicit states', async () => {
    vi.spyOn(modelInference, 'invoke')
      .mockResolvedValueOnce({ status: 'noAnswer', provider_id: 'provider', model: 'model' })
      .mockResolvedValueOnce({ status: 'ok', provider_id: 'provider', model: 'model', answer: 'not JSON' });
    const { result } = renderHook(() => useSalesPlanAdvice('scope', 'prompt'));
    await waitFor(() => expect(result.current.state.status).toBe('noAnswer'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe('failed'));
  });

  it('times out and never replaces the timeout with a late response', async () => {
    vi.useFakeTimers();
    let finish!: (value: ConversationModelInferenceResult) => void;
    vi.spyOn(modelInference, 'invoke').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { result } = renderHook(() => useSalesPlanAdvice('scope', 'prompt'));
    act(() => vi.advanceTimersByTime(60000));
    expect(result.current.state.status).toBe('timeout');
    await act(async () => {
      finish({ status: 'ok', provider_id: 'provider', model: 'model', answer: '{"sku":"late"}' });
    });
    expect(result.current.state.status).toBe('timeout');
  });

  it('does not regenerate on parent renders or right conversation changes', async () => {
    const invoke = vi
      .spyOn(modelInference, 'invoke')
      .mockResolvedValue({ status: 'ok', provider_id: 'p', model: 'default', answer: '{"sku":"advice"}' });
    const { result, rerender } = renderHook(
      ({ chat }) => {
        void chat;
        return useSalesPlanAdvice('scope', 'prompt');
      },
      { initialProps: { chat: 'first' } }
    );
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    rerender({ chat: 'second' });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(conversation.listChanged.on).not.toHaveBeenCalled();
  });

  it('reports missing models and never automatically retries conflicts', async () => {
    const error = (status: number, message: string) =>
      new BackendHttpError({ method: 'POST', path: '/model-inference', status, body: { error: message } });
    const invoke = vi.spyOn(modelInference, 'invoke').mockRejectedValueOnce(error(400, 'MODEL_NOT_SELECTED'));
    const { result } = renderHook(() => useSalesPlanAdvice('scope', 'prompt'));
    await waitFor(() => expect(result.current.state.status).toBe('noModel'));
    invoke.mockRejectedValueOnce(error(409, 'MODEL_SELECTION_CHANGED'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe('failed'));
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
