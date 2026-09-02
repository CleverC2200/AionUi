import { expect, test } from '../fixtures';

const PERIOD_ID = '9007199254740993';
const PLAN_ID = 'p-jxs-2026-09-00001';
const VERSION_ID = '9007199254741000';

test.describe('Sales-plan returned-version resubmission', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.AIONUI_ASSISTANT_SURFACE_FIXTURES !== '1' ||
        process.env.AIONUI_E2E_AUTH_BYPASS !== '1' ||
        process.env.AIONUI_E2E_SALES_PLAN_QUERY !== '1',
      'Run with the isolated Assistant Surface, E2E auth-bypass, and sales-plan query flags.'
    );
    await page.addInitScript(
      ({ periodId, planId, versionId }) => {
        const originalFetch = window.fetch.bind(window);
        const version = {
          id: versionId,
          planId,
          seq: 4,
          periodId,
          planTypeCode: 'MONTHLY',
          dealerCode: '9007199254740997',
          orgCode: 'ORG-E2E',
          provinceCode: 'PROVINCE-E2E',
          areaCode: 'AREA-E2E',
          baseName: 'E2E 退回基地',
          status: 9,
          effective: true,
          targetQty: '1.234',
          targetAmount: '2.47',
        };
        const realSku = {
          id: '9007199254741100',
          versionId,
          skuCode: '9007199254741200',
          productCategName: 'E2E 真实品类',
          baseQty: '1.000',
          qty: '1.234',
          price: '2.0000',
          amt: '2.47',
          amtBase: '2.00',
        };
        window.fetch = async (input, init) => {
          const rawUrl =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
          const url = new URL(rawUrl, window.location.href);
          // oxlint-disable-next-line eslint-plugin-unicorn/consistent-function-scoping -- addInitScript serializes this closure.
          const json = (data: unknown, status = 200) =>
            new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });

          if (url.pathname === '/api/system/current-user') {
            return json({ id: 'e2e-current-user', username: 'E2E 当前用户' });
          }
          if (!url.pathname.startsWith('/api/gea/sales-plan/')) return originalFetch(input, init);
          if (url.pathname.endsWith('/actions')) {
            return json(undefined, 500);
          }
          if (url.pathname.endsWith('/periods')) {
            return json({
              records: [
                {
                  periodId,
                  tenantId: '9007199254740994',
                  periodMonth: '2026-09',
                  planType: '月度计划',
                  planTypeCode: 'MONTHLY',
                  status: 'OPEN',
                },
              ],
              total: 1,
              size: 100,
              current: 1,
              pages: 1,
            });
          }
          if (url.pathname === `/api/gea/sales-plan/plans/${planId}`) {
            return json({
              currentVersion: version,
              skus: [{ ...realSku, versionId: 'stale-version', skuCode: '1', qty: '999.000' }],
              versions: [],
              logs: [],
            });
          }
          if (url.pathname === `/api/gea/sales-plan/plans/versions/${versionId}/skus`) {
            return json([realSku]);
          }
          if (url.pathname.endsWith('/plans')) {
            const record = {
              planId,
              versionId,
              seq: 4,
              periodId,
              planTypeCode: 'MONTHLY',
              dealerCode: '9007199254740997',
              orgCode: 'ORG-E2E',
              provinceCode: 'PROVINCE-E2E',
              areaCode: 'AREA-E2E',
              baseName: 'E2E 退回基地',
              status: 9,
              returnReason: '补充真实销量证据',
              targetQty: '1.234',
              targetAmount: '2.47',
              skuCount: 1,
              currentQty: '1.234',
              currentAmount: '2.47',
            };
            return json({
              records: [record],
              total: 1,
              size: 2,
              current: 1,
              pages: 1,
            });
          }
          return json(undefined, 404);
        };
      },
      { periodId: PERIOD_ID, planId: PLAN_ID, versionId: VERSION_ID }
    );
    await page.goto(`${page.url().split('#')[0]}#/guid`);
    await page.reload();
  });

  test('derives the documented channel from the business plan ID and opens returned-plan resubmission', async ({
    page,
  }) => {
    await page.getByTestId('assistant-surface-switcher').click();
    const modeDrawer = page.locator('.arco-drawer-wrapper:visible').last();
    await modeDrawer.getByTestId('assistant-surface-option-business').click();

    const workbench = page.getByTestId('regional-approval-workbench');
    await expect(workbench).toBeVisible();
    await expect(workbench.getByText('E2E 退回基地', { exact: true }).first()).toBeVisible();
    await expect(workbench.getByTestId('regional-approval-current-stage')).toHaveText('大区审批');
    await expect(workbench.getByRole('combobox', { name: '队列类型' })).toHaveCount(0);
    await expect(workbench.getByRole('button', { name: '审批 E2E 退回基地' })).toBeDisabled();
    const resubmitButton = workbench.getByRole('button', { name: '重提 E2E 退回基地' });
    await expect(resubmitButton).toBeEnabled();
    await resubmitButton.click();
    const dialog = page.getByRole('dialog', { name: '真实销售计划退回重提' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/1 个 SKU · 提报汇总 1.234 · ¥2.47/)).toBeVisible();
    await expect(dialog.getByRole('checkbox')).not.toBeChecked();
    await dialog.getByRole('button', { name: '确认重提' }).click();
    await expect(dialog.getByText('请先确认真实重提范围。')).toBeVisible();
  });
});
