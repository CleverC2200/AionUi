/** @vitest-environment node */
import { afterEach, expect, it, vi } from 'vitest';
import { modelInference } from '@/common/adapter/ipcBridge';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('sends only analysis input without a conversation and forwards cancellation', async () => {
  const receipt = { status: 'ok', provider_id: 'p', model: 'current-model', answer: '{"sku":"advice"}' };
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data: receipt }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal('window', { __backendPort: 43123 });
  const controller = new AbortController();
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  await expect(
    modelInference.invoke({
      question: 'private analysis input',
      signal: controller.signal,
    })
  ).resolves.toEqual(receipt);
  expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:43123/api/models/inference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'private analysis input' }),
    signal: controller.signal,
  });
  expect(debug.mock.calls.flat().join(' ')).not.toContain('private analysis input');
});
