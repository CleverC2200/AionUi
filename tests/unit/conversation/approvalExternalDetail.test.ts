import { describe, expect, it } from 'vitest';

import { shouldLoadApprovalInstance } from '@/renderer/pages/conversation/ApprovalPrototype';

describe('Feishu approval detail routing', () => {
  it('does not call the native instance detail API for third-party approvals', () => {
    expect(
      shouldLoadApprovalInstance({
        instanceCode: 'instance-1',
        instanceExternalId: 'external-instance-1',
        taskExternalId: 'external-task-1',
      })
    ).toBe(false);
  });

  it('keeps loading native approval details', () => {
    expect(shouldLoadApprovalInstance({ instanceCode: 'instance-1' })).toBe(true);
  });
});
