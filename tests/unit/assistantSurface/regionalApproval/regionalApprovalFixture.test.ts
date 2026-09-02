import { describe, expect, it } from 'vitest';
import {
  REGIONAL_APPROVAL_ROWS,
  approvalRowsForStage,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/regionalApprovalFixture';

describe('regionalApprovalFixture', () => {
  it('projects only plans that reached the selected approval stage', () => {
    expect(approvalRowsForStage(REGIONAL_APPROVAL_ROWS, 'customer')).toHaveLength(5);
    expect(approvalRowsForStage(REGIONAL_APPROVAL_ROWS, 'area').map((row) => row.id)).toEqual([
      'north-area',
      'east-area',
      'central-area',
      'hebei-province',
    ]);
    expect(approvalRowsForStage(REGIONAL_APPROVAL_ROWS, 'category').map((row) => row.id)).toEqual(['east-area']);
  });
});
