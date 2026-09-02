import { describe, expect, it } from 'vitest';
import { REGIONAL_APPROVAL_ROWS } from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/regionalApprovalFixture';
import {
  ALL_ORGANIZATIONS,
  buildApprovalCsv,
  paginateApprovalRows,
  projectApprovalRows,
  updateApprovalFilter,
  type ApprovalCsvLabels,
  type ApprovalOrganizationFilters,
} from '@/renderer/pages/assistantSurface/workbenches/regionalApproval/regionalApprovalModel';

const labels: ApprovalCsvLabels = {
  version: '版本',
  stage: '审批阶段',
  organization: '组织',
  area: '大区',
  branch: '分公司',
  department: '经营部',
  customer: '客户',
  quantity: '数量',
  amount: '金额',
  versionValues: { current: '当前版', previous: '上一版', initial: '初始版' },
};

describe('regional approval model', () => {
  it('clears only invalid downstream organization filters after an upstream change', () => {
    const northScope: ApprovalOrganizationFilters = {
      area: 'north',
      branch: 'hebei',
      department: 'shijiazhuang',
      customer: 'yanzhao',
      approval: 'approved',
      health: 'healthy',
    };

    expect(updateApprovalFilter(REGIONAL_APPROVAL_ROWS, northScope, 'area', 'east')).toEqual({
      area: 'east',
      branch: ALL_ORGANIZATIONS,
      department: ALL_ORGANIZATIONS,
      customer: ALL_ORGANIZATIONS,
      approval: 'approved',
      health: 'healthy',
    });
    expect(updateApprovalFilter(REGIONAL_APPROVAL_ROWS, northScope, 'customer', 'northstar')).toEqual({
      area: 'north',
      branch: 'hebei',
      department: 'shijiazhuang',
      customer: 'northstar',
      approval: ALL_ORGANIZATIONS,
      health: ALL_ORGANIZATIONS,
    });
  });

  it('projects rows from the applied four-level organization scope', () => {
    const northRows = projectApprovalRows(REGIONAL_APPROVAL_ROWS, {
      area: 'north',
      branch: ALL_ORGANIZATIONS,
      department: ALL_ORGANIZATIONS,
      customer: ALL_ORGANIZATIONS,
      approval: ALL_ORGANIZATIONS,
      health: ALL_ORGANIZATIONS,
    });
    expect(northRows.map((row) => row.id)).toEqual(['north-area', 'hebei-province']);

    const customerRows = projectApprovalRows(REGIONAL_APPROVAL_ROWS, {
      area: 'north',
      branch: 'hebei',
      department: 'shijiazhuang',
      customer: 'yanzhao',
      approval: ALL_ORGANIZATIONS,
      health: ALL_ORGANIZATIONS,
    });
    expect(customerRows.map((row) => row.id)).toEqual(['hebei-province']);
  });

  it('clamps pagination while retaining total and page size', () => {
    expect(paginateApprovalRows([1, 2, 3, 4, 5], 2, 2)).toEqual({
      rows: [3, 4],
      page: 2,
      pageSize: 2,
      total: 5,
      pageCount: 3,
    });
    expect(paginateApprovalRows([1, 2, 3], 9, 2)).toMatchObject({ rows: [3], page: 2, total: 3 });
  });

  it('builds CSV from only the current applied scope and selected version', () => {
    const eastRows = projectApprovalRows(REGIONAL_APPROVAL_ROWS, {
      area: 'east',
      branch: ALL_ORGANIZATIONS,
      department: ALL_ORGANIZATIONS,
      customer: ALL_ORGANIZATIONS,
      approval: ALL_ORGANIZATIONS,
      health: ALL_ORGANIZATIONS,
    });
    const currentCsv = buildApprovalCsv(eastRows, 'current', 'area', labels);
    const previousCsv = buildApprovalCsv(eastRows, 'previous', 'area', labels);

    expect(currentCsv).toContain('"east-area"');
    expect(currentCsv).toContain('"826400"');
    expect(currentCsv).not.toContain('"north-area"');
    expect(previousCsv).toContain('"上一版"');
    expect(previousCsv).toContain('"801780"');
    expect(previousCsv).not.toContain('"826400"');
  });
});
