import { describe, expect, it, vi } from 'vitest';
import { GEA_REMOTE_SERVICE_POLICY } from '@/common/config/geaManagedServices';

const mocks = vi.hoisted(() => ({
  captureEvent: vi.fn(),
}));

vi.mock('@sentry/electron/renderer', () => ({
  captureEvent: mocks.captureEvent,
  flush: vi.fn(),
  withScope: vi.fn(),
}));

import { submitFeedbackReport } from '@/renderer/services/feedback/submitFeedbackReport';

describe('GEA remote services policy', () => {
  it('keeps official update and feedback channels disabled', () => {
    expect(GEA_REMOTE_SERVICE_POLICY.autoUpdateEnabled).toBe(false);
    expect(GEA_REMOTE_SERVICE_POLICY.feedbackSubmissionEnabled).toBe(false);
  });

  it('rejects feedback before collecting or submitting diagnostics', async () => {
    await expect(
      submitFeedbackReport({
        collectLogs: true,
        description: 'should stay local',
        module: 'test',
        moduleLabel: 'Test',
      })
    ).rejects.toThrow('GEA feedback service is not configured');

    expect(mocks.captureEvent).not.toHaveBeenCalled();
  });
});
