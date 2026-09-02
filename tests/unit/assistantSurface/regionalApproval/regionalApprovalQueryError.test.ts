import { describe, expect, it } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { classifyRegionalApprovalQueryError } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/useRegionalApprovalQuery';

const backendError = (status: number) =>
  new BackendHttpError({
    method: 'GET',
    path: '/api/gea/sales-plan/plans',
    status,
    body: { code: `STATUS_${status}`, error: 'test' },
  });

describe('classifyRegionalApprovalQueryError', () => {
  it('keeps permission, expired identity, timeout, and availability states stable', () => {
    expect(classifyRegionalApprovalQueryError(backendError(401))).toBe('expired');
    expect(classifyRegionalApprovalQueryError(backendError(403))).toBe('permission');
    expect(classifyRegionalApprovalQueryError(backendError(504))).toBe('timeout');
    expect(classifyRegionalApprovalQueryError(backendError(502))).toBe('unavailable');
    expect(classifyRegionalApprovalQueryError(new TypeError('network disconnected'))).toBe('unavailable');
  });

  it('distinguishes an intentional cancellation from the hook timeout boundary', () => {
    const aborted = new DOMException('aborted', 'AbortError');
    expect(classifyRegionalApprovalQueryError(aborted)).toBe('cancelled');
    expect(classifyRegionalApprovalQueryError(aborted, true)).toBe('timeout');
  });
});
