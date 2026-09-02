import { describe, expect, it } from 'vitest';
import { extractBusinessDetailSections } from '@/renderer/pages/assistantSurface/components/BusinessMessageInbox';

describe('business message detail sections', () => {
  it('turns business accordion headings into stable horizontal tab sections', () => {
    const body = [
      '审批总体进度 52%',
      '未提报客户（3）',
      '- 北辰食品商贸',
      '- 晨星冷链商贸',
      'SKU 与预测数量差异较大（4）',
      '- FSKU001：差异 2 件',
      '本次审批建议方向',
      '- 先补齐缺失客户，再提交审批',
      '版本差异明细（5）',
      '- V1.2 → V1.3',
    ].join('\n');

    expect(extractBusinessDetailSections(body)).toEqual([
      { key: 'customers', title: '未提报客户（3）', content: '- 北辰食品商贸\n- 晨星冷链商贸' },
      { key: 'sku-difference', title: 'SKU 与预测数量差异较大（4）', content: '- FSKU001：差异 2 件' },
      { key: 'approval', title: '本次审批建议方向', content: '- 先补齐缺失客户，再提交审批' },
      { key: 'version', title: '版本差异明细（5）', content: '- V1.2 → V1.3' },
    ]);
  });

  it('does not invent structured tabs when the notification only has free text', () => {
    expect(extractBusinessDetailSections('请核对最新业务进度。')).toEqual([]);
  });
});
