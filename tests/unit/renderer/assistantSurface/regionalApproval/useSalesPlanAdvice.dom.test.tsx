import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversation, type ConversationModelInferenceResult } from '@/common/adapter/ipcBridge';
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
  it('does not request advice without an active conversation', async () => {
    const invoke = vi.spyOn(conversation.inferModel, 'invoke');
    const { result } = renderHook(() => useSalesPlanAdvice(null, 'scope', 'prompt'));
    await waitFor(() => expect(result.current.state.status).toBe('noSession'));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('uses the selected conversation and ignores a previous scope response', async () => {
    let finishOld!: (value: ConversationModelInferenceResult) => void;
    const invoke = vi
      .spyOn(conversation.inferModel, 'invoke')
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
    const { result, rerender } = renderHook(
      ({ scope }) => useSalesPlanAdvice('current-conversation', scope, 'prompt'),
      { initialProps: { scope: 'scope-a' } }
    );
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
      conversation_id: 'current-conversation',
      question: 'prompt\nscope-b',
      signal: expect.any(AbortSignal),
    });
  });

  it('exposes missing answers and malformed responses as explicit states', async () => {
    vi.spyOn(conversation.inferModel, 'invoke')
      .mockResolvedValueOnce({ status: 'noAnswer', provider_id: 'provider', model: 'model' })
      .mockResolvedValueOnce({ status: 'ok', provider_id: 'provider', model: 'model', answer: 'not JSON' });
    const { result } = renderHook(() => useSalesPlanAdvice('conversation', 'scope', 'prompt'));
    await waitFor(() => expect(result.current.state.status).toBe('noAnswer'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe('failed'));
  });

  it('times out and never replaces the timeout with a late response', async () => {
    vi.useFakeTimers();
    let finish!: (value: ConversationModelInferenceResult) => void;
    vi.spyOn(conversation.inferModel, 'invoke').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { result } = renderHook(() => useSalesPlanAdvice('conversation', 'scope', 'prompt'));
    act(() => vi.advanceTimersByTime(60000));
    expect(result.current.state.status).toBe('timeout');
    await act(async () => {
      finish({ status: 'ok', provider_id: 'provider', model: 'model', answer: '{"sku":"late"}' });
    });
    expect(result.current.state.status).toBe('timeout');
  });

  it('reuses a newly selected model and ignores unrelated conversation updates', async () => {
    const invoke = vi
      .spyOn(conversation.inferModel, 'invoke')
      .mockResolvedValue({ status: 'ok', provider_id: 'p', model: 'model-a', answer: '{"sku":"model A advice"}' });
    vi.spyOn(conversation.get, 'invoke').mockResolvedValue({
      id: 'conversation',
      type: 'aionrs',
      model: { id: 'p', use_model: 'model-b' },
    } as TChatConversation);
    const { result } = renderHook(() => useSalesPlanAdvice('conversation', 'scope', 'prompt'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    const handler = vi.mocked(conversation.listChanged.on).mock.calls.at(-1)![0];
    await act(async () => handler({ conversation_id: 'other', action: 'updated' }));
    expect(invoke).toHaveBeenCalledTimes(1);
    invoke.mockResolvedValue({ status: 'ok', provider_id: 'p', model: 'model-b', answer: '{"sku":"model B advice"}' });
    await act(async () => handler({ conversation_id: 'conversation', action: 'updated' }));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ status: 'ready', answers: { sku: 'model B advice' } })
    );
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('reports a missing configured model and retries a model-switch conflict', async () => {
    const error = (status: number, message: string) =>
      new BackendHttpError({ method: 'POST', path: '/model-inference', status, body: { error: message } });
    const invoke = vi.spyOn(conversation.inferModel, 'invoke').mockRejectedValueOnce(error(400, 'MODEL_NOT_SELECTED'));
    const { result } = renderHook(() => useSalesPlanAdvice('conversation', 'scope', 'prompt'));
    await waitFor(() => expect(result.current.state.status).toBe('noModel'));
    invoke.mockRejectedValueOnce(error(409, 'MODEL_SELECTION_CHANGED')).mockResolvedValueOnce({
      status: 'ok',
      provider_id: 'p',
      model: 'new-model',
      answer: '{"sku":"current advice"}',
    });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
