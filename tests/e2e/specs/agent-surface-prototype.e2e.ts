/**
 * Agent Surface prototype E2E.
 *
 * Exercises the real Electron renderer against the prebuilt `out/` assets.
 * Fixture-only: no GEA read/write or external business mutation is performed.
 */
import type { ElectronApplication, Page } from '@playwright/test';
import os from 'os';
import { expect, test } from '../fixtures';
import { createErrorCollector, goToSettings } from '../helpers';
import { httpDelete, httpPost } from '../helpers/httpBridge';

const PROTOTYPE_ROUTE =
  '#/prototype/work-center?scenario=agent-switching&variant=A&agent=forecast&prototype=work-center';

async function openAgentSurfacePrototype(page: Page): Promise<void> {
  await page.goto(`${page.url().split('#')[0]}${PROTOTYPE_ROUTE}`);
  await page.waitForFunction((route) => window.location.hash === route, PROTOTYPE_ROUTE, { timeout: 10_000 });
  await expect(page.getByTestId('work-center-prototype')).toBeVisible();
  await expect(page.getByText('Agent Surface 切换原型', { exact: true })).toBeVisible();
}

async function openWorkModeSwitcher(page: Page): Promise<void> {
  await expect(page.locator('.arco-drawer-wrapper:visible')).toHaveCount(0);
  await page.getByRole('button', { name: '切换工作模式' }).click();
  const wrapper = page.locator('.arco-drawer-wrapper:visible').last();
  await expect(wrapper).toBeVisible();
  await expect(wrapper.getByText('切换工作模式', { exact: true })).toBeVisible();
  const drawer = wrapper.locator('.arco-drawer');
  await expect
    .poll(async () => {
      const box = await drawer.boundingBox();
      return box ? Math.round(box.x) : null;
    })
    .toBe(0);
}

async function closeWorkModeSwitcher(page: Page): Promise<void> {
  const wrapper = page.locator('.arco-drawer-wrapper:visible').last();
  await wrapper.locator('.arco-drawer-close-icon').click();
  await expect(wrapper).toBeHidden();
}

const surfaceContextRevisionFromContent = (content: string): number => {
  const serialized = content.match(/\[\[AION_SURFACE_CONTEXT\]\]\n([^\n]+)\n\[\[\/AION_SURFACE_CONTEXT\]\]/)?.[1];
  return serialized ? Number((JSON.parse(serialized) as { revision?: number }).revision ?? 0) : 0;
};

const setZoomFactor = async (electronApp: ElectronApplication, factor: number): Promise<void> => {
  await electronApp.evaluate(({ BrowserWindow }, nextFactor) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.webContents.isDevToolsOpened());
    window?.webContents.setZoomFactor(nextFactor);
  }, factor);
};

test.describe('Agent Surface prototype entry', () => {
  test('opens directly when the dedicated development flag is enabled', async ({ page }) => {
    test.skip(
      process.env.AIONUI_AGENT_SURFACE_PROTOTYPE !== '1',
      'Run with AIONUI_AGENT_SURFACE_PROTOTYPE=1 to exercise the dedicated Electron entry.'
    );

    await expect(page.getByTestId('work-center-prototype')).toBeVisible();
    await expect(page.getByText('Agent Surface 切换原型', { exact: true })).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).hash)
      .toBe('#/prototype/work-center?scenario=agent-switching&variant=A&agent=forecast&prototype=work-center');
  });
});

test.describe('Agent Surface prototype', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openAgentSurfacePrototype(page);
  });

  test.afterEach(async ({ page }) => {
    if (await page.locator('.arco-drawer-wrapper:visible').count()) {
      await closeWorkModeSwitcher(page);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('loads the forecast split surface without renderer errors', async ({ page }) => {
    const errors = createErrorCollector(page);
    await page.reload();

    await expect(page.getByRole('heading', { name: '有什么可以帮你？' })).toBeVisible();
    await expect(page.getByRole('main', { name: '需求预测工作台' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '经销商核对队列' })).toBeVisible();
    await expect(page.getByText('Fixture 数据 · 不连接 GEA · 不执行真实操作', { exact: true })).toBeVisible();
    expect(errors.critical()).toEqual([]);
  });

  test('switches between conversation, split, and workbench modes without blanking the page', async ({ page }) => {
    const chat = page.getByRole('region', { name: '需求预测对话' });
    const workbench = page.getByRole('main', { name: '需求预测工作台' });

    await page.locator('label[title="工作区全屏"]').click();
    await expect(workbench).toBeVisible();
    await expect(chat).toBeHidden();
    await expect(page.getByTestId('work-center-prototype')).not.toBeEmpty();

    await page.locator('label[title="对话全屏"]').click();
    await expect(chat).toBeVisible();
    await expect(workbench).toBeHidden();

    await page.locator('label[title="对话与工作区双栏"]').click();
    await expect(chat).toBeVisible();
    await expect(workbench).toBeVisible();
  });

  test('drills into SKU review and keeps quantity edits local', async ({ page }) => {
    await page.getByRole('button', { name: '核对 SKU' }).first().click();
    await expect(page.getByText('正在读取 SKU 明细…', { exact: true })).toBeVisible();
    await expect(page.getByText('SKU 明细', { exact: true })).toBeVisible();

    const firstQuantity = page.getByRole('spinbutton').first();
    await firstQuantity.fill('58');
    await firstQuantity.press('Tab');

    await expect(page.getByRole('button', { name: '已调整 1 条' })).toBeVisible();
    await expect(page.getByText(/已产生 1 条本地 Fixture 调整；切换 Agent 不会提交或丢弃。/)).toBeVisible();
    await expect(page.getByRole('button', { name: '提交' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '上传回填' })).toBeDisabled();
  });

  test('switches only between General and Business while preserving fixture boundaries', async ({ page }) => {
    await openWorkModeSwitcher(page);
    await expect(page.getByTestId('prototype-work-mode-option-general')).toBeVisible();
    await expect(page.getByTestId('prototype-work-mode-option-business')).toBeVisible();
    await expect(page.getByText('需求预测 Agent', { exact: true })).toBeHidden();
    await expect(page.getByText('合同审查 Agent', { exact: true })).toBeHidden();
    await expect(page.getByText('企业受管', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Fixture 原型：不连接 GEA，不执行真实业务操作。', { exact: true })).toHaveCount(1);

    await page.getByTestId('prototype-work-mode-option-general').click();
    await expect(page.getByRole('heading', { name: 'Hi，今天有什么安排？' })).toBeVisible();
    await expect(page.getByRole('main', { name: '需求预测工作台' })).toBeHidden();

    await openWorkModeSwitcher(page);
    await page.getByTestId('prototype-work-mode-option-business').click();
    await expect(page.getByRole('main', { name: '需求预测工作台' })).toBeVisible();
  });

  test('shows the selected and unavailable work-mode states without duplicating Fixture labels', async ({ page }) => {
    await openWorkModeSwitcher(page);
    await expect(page.getByTestId('prototype-work-mode-option-business')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('prototype-work-mode-option-general')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Fixture 原型：不连接 GEA，不执行真实业务操作。', { exact: true })).toHaveCount(1);

    await closeWorkModeSwitcher(page);
    await page.goto(`${page.url().split('#')[0]}${PROTOTYPE_ROUTE}&business=unavailable`);
    await expect(page.getByTestId('work-center-prototype')).toBeVisible();
    await openWorkModeSwitcher(page);
    await expect(page.getByTestId('prototype-work-mode-option-business')).toBeDisabled();
    await expect(page.getByText('待接入', { exact: true })).toHaveCount(1);
  });

  test('captures the frozen work-mode switcher at the desktop acceptance widths', async ({ page }) => {
    /* eslint-disable no-await-in-loop -- each viewport captures the same frozen switcher state */
    for (const width of [900, 1280, 1536]) {
      await page.setViewportSize({ width, height: width === 900 ? 800 : 900 });
      await openWorkModeSwitcher(page);
      await expect(page.getByTestId('prototype-work-mode-option-general')).toBeVisible();
      await expect(page.getByTestId('prototype-work-mode-option-business')).toBeVisible();
      await page.screenshot({ path: `tests/e2e/results/work-mode-switcher-prototype-${width}px.png` });
      await closeWorkModeSwitcher(page);
    }
    /* eslint-enable no-await-in-loop */
  });

  test('keeps core controls usable without page-level overflow at 900px', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });

    await expect(page.getByRole('button', { name: '切换工作模式' })).toBeVisible();
    await expect(page.locator('label[title="对话与工作区双栏"]')).toBeVisible();
    await expect(page.getByRole('region', { name: '需求预测对话' })).toBeVisible();
    await expect(page.getByRole('main', { name: '需求预测工作台' })).toBeVisible();
    await expect(page.getByText('2026 年 9 月', { exact: true })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }));
    expect(overflow.document).toBeLessThanOrEqual(1);
    expect(overflow.body).toBeLessThanOrEqual(1);

    await page.screenshot({ path: 'tests/e2e/results/agent-surface-prototype-900px.png' });
  });

  test('fills the Electron content canvas at 1536px without orphaned right or bottom space', async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 916 });

    const prototypeRoot = page.getByTestId('work-center-prototype');
    const surface = page.locator('.agent-surface-prototype');
    const workbench = page.getByRole('main', { name: '需求预测工作台' });
    const [rootBox, surfaceBox, workbenchBox] = await Promise.all([
      prototypeRoot.boundingBox(),
      surface.boundingBox(),
      workbench.boundingBox(),
    ]);

    expect(rootBox).not.toBeNull();
    expect(surfaceBox).not.toBeNull();
    expect(workbenchBox).not.toBeNull();
    expect(rootBox!.width).toBeGreaterThanOrEqual(1535);
    expect(rootBox!.height).toBeGreaterThanOrEqual(915);
    expect(surfaceBox!.width).toBeGreaterThanOrEqual(1535);
    expect(surfaceBox!.height).toBeGreaterThan(800);
    // The workbench stops at the 6px ResizeBox trigger; the Surface itself must
    // still reach the viewport edge so this is a divider, not orphaned whitespace.
    expect(surfaceBox!.x + surfaceBox!.width - (workbenchBox!.x + workbenchBox!.width)).toBeLessThanOrEqual(8);

    await page.screenshot({ path: 'tests/e2e/results/agent-surface-prototype-1536px.png' });
  });
});

test.describe('Agent Surface production host', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.AIONUI_ASSISTANT_SURFACE_FIXTURES !== '1' || process.env.AIONUI_E2E_AUTH_BYPASS !== '1',
      'Run with the isolated fixture and E2E auth-bypass flags to exercise the protected product host.'
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => {
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith('aionui:assistant-surface:')) sessionStorage.removeItem(key);
      }
    });
    await page.goto(`${page.url().split('#')[0]}#/guid`);
    // Hash navigation alone keeps the prototype-only Main branch mounted from
    // the previous describe block. Reload to exercise the product boot path.
    await page.reload();
    await expect(page.getByTestId('assistant-surface-switcher')).toBeVisible();
  });

  test('switches from unchanged General to Business, then changes Agent from the left menu', async ({ page }) => {
    const errors = createErrorCollector(page);

    await page.getByTestId('assistant-surface-switcher').click();
    const modeDrawer = page.locator('.arco-drawer-wrapper:visible').last();
    await expect(modeDrawer.getByText('切换工作模式', { exact: true })).toBeVisible();
    await expect(modeDrawer.getByTestId('assistant-surface-mode-options').getByRole('button')).toHaveCount(2);
    await expect(modeDrawer.getByTestId('assistant-surface-option-general')).toHaveAttribute('aria-pressed', 'true');
    await expect(modeDrawer.getByTestId('assistant-surface-option-business')).toHaveAttribute('aria-pressed', 'false');
    await expect(modeDrawer.getByText('需求预测 Agent', { exact: true })).toHaveCount(0);
    await expect(modeDrawer.getByText('合同审查 Agent', { exact: true })).toHaveCount(0);
    await expect(modeDrawer.getByText('企业受管', { exact: true })).toHaveCount(1);
    await expect(modeDrawer.getByTestId('assistant-surface-fixture-boundary')).toHaveCount(1);
    await expect
      .poll(async () => {
        const box = await modeDrawer.locator('.arco-drawer').boundingBox();
        return box ? Math.round(box.x) : null;
      })
      .toBe(0);
    await page.screenshot({ path: 'tests/e2e/results/assistant-surface-work-mode-switcher-1280.png' });
    await page.getByTestId('assistant-surface-option-business').click();
    await expect(modeDrawer).toBeHidden();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/assistant-surface/forecast');
    await expect(page.getByTestId('assistant-surface-forecast')).toBeVisible();
    await expect(page.getByTestId('regional-approval-workbench')).toBeVisible();
    await expect(page.getByTestId('assistant-surface-navigation')).toBeVisible();
    await expect(page.getByTestId('assistant-surface-navigation-group-planning')).toBeVisible();
    await expect(page.getByTestId('assistant-surface-navigation-group-contracts')).toBeVisible();
    await expect(page.getByTestId('assistant-surface-navigation-forecast')).toBeVisible();
    await expect(page.getByTestId('assistant-surface-navigation-contract')).toBeVisible();
    await expect(page.getByText('客户管理', { exact: true })).toBeHidden();
    await expect(page.getByTestId('assistant-surface-switcher')).toContainText('GEA 业务版');

    await page.getByTestId('assistant-surface-navigation-group-planning').click();
    await expect(page.getByTestId('assistant-surface-navigation-forecast')).toBeHidden();
    await expect(page.getByTestId('assistant-surface-navigation-contract')).toBeVisible();
    await page.getByTestId('assistant-surface-navigation-group-planning').click();
    await expect(page.getByTestId('assistant-surface-navigation-forecast')).toBeVisible();

    await page.getByTestId('assistant-surface-navigation-contract').click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/assistant-surface/contract');
    await expect(page.getByTestId('assistant-surface-contract')).toBeVisible();
    await expect(page.getByTestId('contract-conversation-region')).toBeVisible();
    await expect(page.getByText('切换工作模式', { exact: true })).toBeHidden();
    await page.waitForTimeout(220);
    await page.screenshot({ path: 'tests/e2e/results/assistant-surface-contract-workbench-1280.png' });

    await page.getByTestId('assistant-surface-switcher').click();
    await page.getByTestId('assistant-surface-option-general').click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/guid');
    await expect(page.getByTestId('assistant-surface-contract')).toBeHidden();
    await expect(page.getByTestId('assistant-surface-navigation')).toBeHidden();
    await expect(page.getByText('新会话', { exact: true })).toBeVisible();
    await expect(page.getByTestId('assistant-surface-switcher')).toContainText('GEAUi');

    await page.getByTestId('assistant-surface-switcher').click();
    await page.getByTestId('assistant-surface-option-business').click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/assistant-surface/contract');
    await expect(page.getByTestId('assistant-surface-contract')).toBeVisible();
    await page.getByTestId('assistant-surface-navigation-forecast').click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/assistant-surface/forecast');
    await expect(page.getByTestId('regional-approval-workbench')).toBeVisible();
    expect(errors.critical()).toEqual([]);
  });

  test('restores forecast board edits independently from contract state', async ({ page }) => {
    await page.getByTestId('assistant-surface-switcher').click();
    await page.getByTestId('assistant-surface-option-business').click();
    await expect(page.getByTestId('forecast-board-region')).toBeVisible();
    await expect(page.getByTestId('forecast-conversation-region')).toBeVisible();
    await expect(page.getByTestId('regional-approval-current-stage')).toHaveText('大区审批');
    const initialForecastRevision = await page.getByTestId('forecast-context-status').textContent();
    await page.getByTestId('regional-approval-stage-category').click();
    await expect(page.getByTestId('regional-approval-current-stage')).toHaveText('品类计划审核');
    await expect(page.getByText('当前 1 条 · 待审批 0 条', { exact: true })).toBeVisible();
    await expect(page.getByText('华东大区', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('华北大区', { exact: true })).toHaveCount(0);
    await expect
      .poll(() => page.getByTestId('forecast-context-status').textContent())
      .not.toBe(initialForecastRevision);
    const forecastRevision = await page.getByTestId('forecast-context-status').textContent();
    expect(forecastRevision).toMatch(/v\d+/);

    await page.getByTestId('assistant-surface-navigation-contract').click();
    await page.getByRole('combobox', { name: '选择风险条款' }).click();
    await page.getByText('7.1 违约责任', { exact: true }).last().click();
    await page.getByTestId('contract-suggestion-draft').fill('仅本地修改：补充责任上限和例外情形。');
    await page.getByRole('button', { name: '采纳建议（仅本地）' }).click();
    await expect(page.getByTestId('contract-active-review-state')).toHaveText('已采纳');

    await page.getByTestId('assistant-surface-navigation-forecast').click();
    await expect(page.getByTestId('regional-approval-current-stage')).toHaveText('品类计划审核');
    await expect(page.getByText('当前 1 条 · 待审批 0 条', { exact: true })).toBeVisible();
    await expect(page.getByText('华东大区', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('华北大区', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('forecast-context-status')).toHaveText(forecastRevision!);
    await expect(page.getByTestId('forecast-conversation-region')).toBeVisible();

    await page.getByTestId('assistant-surface-navigation-contract').click();
    await expect(page.getByTestId('contract-active-review-state')).toHaveText('已采纳');
    await expect(page.getByTestId('contract-suggestion-draft')).toHaveValue('仅本地修改：补充责任上限和例外情形。');
  });

  test('restores the forecast approval stage and queue projection after switching Agents', async ({ page }) => {
    await page.getByTestId('assistant-surface-switcher').click();
    await page.getByTestId('assistant-surface-option-business').click();

    await page.getByTestId('regional-approval-stage-category').click();
    await expect(page.getByTestId('regional-approval-current-stage')).toHaveText('品类计划审核');
    await expect(page.getByText('当前 1 条 · 待审批 0 条', { exact: true })).toBeVisible();
    await expect(page.getByText('华东大区', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('华北大区', { exact: true })).toHaveCount(0);

    await page.getByTestId('assistant-surface-navigation-contract').click();
    await expect(page.getByTestId('assistant-surface-contract')).toBeVisible();
    await page.getByTestId('assistant-surface-navigation-forecast').click();

    await expect(page.getByTestId('regional-approval-current-stage')).toHaveText('品类计划审核');
    await expect(page.getByText('当前 1 条 · 待审批 0 条', { exact: true })).toBeVisible();
    await expect(page.getByText('华东大区', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('华北大区', { exact: true })).toHaveCount(0);
  });

  test('applies stage dimensions, six-level scope, versions, queue evidence, pagination, and CSV export locally', async ({
    page,
  }) => {
    const select = async (label: string, option: string) => {
      const combobox = page.getByRole('combobox', { name: label, exact: true });
      await expect(page.locator('.arco-drawer-wrapper:visible')).toHaveCount(0);
      await combobox.click();
      await expect(combobox).toHaveAttribute('aria-expanded', 'true');
      const popup = page.locator('.arco-trigger:visible:not([class*="exit"]) .arco-select-popup:visible').last();
      await expect(popup).toBeVisible();
      const popupOption = popup.getByRole('option', { name: option, exact: true });
      await expect
        .poll(() =>
          popupOption.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return topElement === element || element.contains(topElement);
          })
        )
        .toBe(true);
      await popupOption.click();
      await expect(popup).toBeHidden();
      await expect(combobox).toContainText(option);
    };

    await page.getByTestId('assistant-surface-switcher').click();
    const modeDrawer = page.locator('.arco-drawer-wrapper:visible').last();
    await page.getByTestId('assistant-surface-option-business').click();
    await expect(modeDrawer).toBeHidden();
    await expect(page.locator('.arco-drawer-wrapper:visible')).toHaveCount(0);
    await expect(page.getByTestId('regional-approval-queue-footer')).toBeVisible();
    await expect(page.getByText('共 4 条', { exact: true })).toBeVisible();
    await expect(page.getByText('华中大区', { exact: true }).first()).toBeVisible();

    const queue = page.getByRole('region', { name: '审批核对队列' });
    await Promise.all(
      [
        '组织 / 范围',
        'AI 核对意见',
        '计划数量',
        '计划金额',
        '数量 / 金额进度',
        '调整',
        '版本对比',
        '退回原因',
        '审批状态',
      ].map((heading) => expect(queue.getByRole('columnheader', { name: heading })).toBeVisible())
    );
    await expect(queue.getByText('3 家客户未提报；2 个 SKU 偏离历史销量')).toBeVisible();

    const dimensionTabs = page.getByRole('tablist', { name: '审批队列维度' });
    await expect(dimensionTabs.getByRole('tab', { name: '按省区' })).toHaveAttribute('aria-selected', 'true');
    await expect(dimensionTabs.getByRole('tab', { name: '按区域' })).toBeVisible();
    await expect(dimensionTabs.getByRole('tab', { name: '按客户' })).toBeVisible();
    await page.getByTestId('regional-approval-stage-category').click();
    await Promise.all(
      ['按大区', '按省区', '按区域', '按基地', '按客户'].map((dimension) =>
        expect(dimensionTabs.getByRole('tab', { name: dimension })).toBeVisible()
      )
    );
    await page.getByTestId('regional-approval-stage-customer').click();
    await expect(dimensionTabs.getByRole('tab')).toHaveCount(1);
    await expect(dimensionTabs.getByRole('tab', { name: '按客户' })).toBeVisible();
    await page.getByTestId('regional-approval-stage-area').click();

    await page.getByRole('switch', { name: '启用品类比较维度' }).click();
    await expect(queue.getByRole('columnheader', { name: '比较类目' })).toBeVisible();

    await select('大区', '华北大区');
    await select('省区', '河北省区');
    await select('区域', '石家庄经销分区');
    await select('客户', '10154901 · 北辰食品商贸');
    await select('审批状态', '待审批');
    await select('健康度', '预警');
    await expect(page.getByText('草稿待应用', { exact: true })).toBeVisible();
    await expect(page.getByText('当前 4 条 · 待审批 2 条', { exact: true })).toBeVisible();

    await select('大区', '华东大区');
    await expect(page.getByRole('combobox', { name: '省区' })).toContainText('全部省区');
    await expect(page.getByRole('combobox', { name: '区域' })).toContainText('全部区域');
    await expect(page.getByRole('combobox', { name: '客户' })).toContainText('全部客户');
    await expect(page.getByRole('combobox', { name: '审批状态' })).toContainText('全部审批状态');
    await expect(page.getByRole('combobox', { name: '健康度' })).toContainText('全部健康度');
    await page.getByRole('button', { name: '查询' }).click();
    await expect(page.getByText('当前 1 条 · 待审批 0 条', { exact: true })).toBeVisible();
    await expect(page.getByText('已应用', { exact: true })).toBeVisible();

    await select('当前查看版本', '上一版');
    await expect(page.getByRole('combobox', { name: '对比版本' })).toContainText('当前版');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const entry = Object.entries(sessionStorage).find(
            ([key]) => key.includes(':forecast:') && key.endsWith(':context-payload')
          );
          if (!entry) return null;
          const snapshot = JSON.parse(entry[1]) as { value?: string };
          return snapshot.value ? JSON.parse(snapshot.value) : null;
        })
      )
      .toMatchObject({
        scope: {
          primaryVersion: 'previous',
          compareVersion: 'current',
          appliedFilters: {
            area: 'east',
            branch: 'all',
            department: 'all',
            customer: 'all',
            approval: 'all',
            health: 'all',
          },
        },
        pagination: { page: 1, pageSize: 20, total: 1 },
      });

    await page.getByRole('button', { name: '查看提报进度' }).click();
    const progressDialog = page.getByRole('dialog');
    await expect(progressDialog).toContainText('共 1 条');
    await expect(progressDialog.getByText('华东大区', { exact: true })).toBeVisible();
    await progressDialog.getByRole('button', { name: '关闭' }).click();

    await page.getByRole('button', { name: '导出当前范围' }).click();
    await expect(page.getByText('已导出 1 条 上一版 样例数据', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '重置' }).click();
    await page.getByRole('combobox', { name: '每页条数' }).click();
    const pageSizePopup = page.locator('.arco-trigger:visible:not([class*="exit"]) .arco-select-popup:visible').last();
    await Promise.all(
      ['10 条/页', '20 条/页', '50 条/页', '100 条/页'].map((size) =>
        expect(pageSizePopup.getByRole('option', { name: size, exact: true })).toBeVisible()
      )
    );
    await pageSizePopup.getByRole('option', { name: '100 条/页', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '每页条数' })).toContainText('100 条/页');

    await page.getByRole('button', { name: '按预警筛选' }).first().click();
    await expect(page.getByRole('combobox', { name: '健康度' })).toContainText('预警');
    await expect(page.getByText('当前 1 条 · 待审批 1 条', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '重置' }).click();
    await page.getByRole('button', { name: '查看 华北大区 证据与调整' }).click();
    await page.getByRole('button', { name: '关闭' }).click();
    await expect(page.getByRole('button', { name: '退回', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '提交至品类审核' })).toBeEnabled();

    const primaryVersion = page.getByRole('combobox', { name: '当前查看版本' });
    await primaryVersion.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('combobox', { name: '对比版本' })).toBeFocused();
    await page.keyboard.press('Tab');
    const area = page.getByRole('combobox', { name: '大区' });
    await expect(area).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(area).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(area).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('forecast-conversation-region')).toBeVisible();
  });

  test('reviews Fixture evidence and keeps explicit SKU adjustments in the Workbench Context', async ({ page }) => {
    const selectDetailOption = async (label: string, option: string) => {
      const combobox = page.getByRole('dialog', { name: '组织计划证据与 SKU 调整' }).getByRole('combobox', {
        name: label,
      });
      await combobox.click();
      await expect(combobox).toHaveAttribute('aria-expanded', 'true');
      const popup = page.locator('.arco-trigger:visible:not([class*="exit"]) .arco-select-popup:visible').last();
      await expect(popup).toBeVisible();
      await popup.getByRole('option', { name: option, exact: true }).click();
      await expect(popup).toBeHidden();
    };

    await page.getByTestId('assistant-surface-switcher').click();
    const modeDrawer = page.locator('.arco-drawer-wrapper:visible').last();
    await page.getByTestId('assistant-surface-option-business').click();
    await expect(modeDrawer).toBeHidden();
    await expect(page.locator('.arco-drawer-wrapper:visible')).toHaveCount(0);

    await page.getByRole('switch', { name: '启用品类比较维度' }).click();

    const openDetail = page.getByRole('button', { name: '查看 华北大区 证据与调整' });
    await openDetail.click();
    const detail = page.getByRole('dialog', { name: '组织计划证据与 SKU 调整' });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('当前证据、AI 建议和保存均为样例数据，不连接生产');
    await expect(detail).toContainText('north-area');
    await expect(detail).toContainText('current · regional-approval-fixture-v3');
    await Promise.all(
      ['按省区', '按区域', '按客户', '按品类'].map((dimension) =>
        expect(detail.getByRole('tab', { name: dimension })).toBeVisible()
      )
    );

    const planQuantity = detail.getByRole('spinbutton', { name: '调整后的计划数量' });
    const planAmount = detail.getByRole('spinbutton', { name: '调整后的计划金额' });
    await planQuantity.fill('12000');
    await planAmount.fill('920000');
    await detail.getByRole('textbox', { name: '业务调整原因' }).fill('E2E Fixture 整单促销调整');
    await expect(planQuantity).toHaveValue('12000');
    await expect(planAmount).toHaveValue('920000');

    const firstSku = page.getByTestId('approval-detail-north-area-FSKU001');
    const firstQuantity = firstSku.getByRole('spinbutton', { name: 'FSKU001 编辑数量' });
    const firstAmount = firstSku.getByRole('spinbutton', { name: 'FSKU001 编辑金额' });
    const initialQuantity = await firstQuantity.inputValue();
    await firstQuantity.fill('75');
    await firstAmount.fill('6200');
    await expect(firstQuantity).toHaveValue('75');
    await expect(firstAmount).toHaveValue('6200');
    await firstSku.getByRole('button', { name: '采纳' }).click();
    await expect(firstSku.getByText('已采纳', { exact: true })).toBeVisible();
    await expect(firstQuantity).not.toHaveValue(initialQuantity);
    await detail.getByRole('button', { name: '整单采纳 AI 建议' }).click();
    await expect(detail.getByText('已采纳', { exact: true })).not.toHaveCount(0);
    await expect(detail.getByText('有未保存调整', { exact: true })).toBeVisible();

    await detail.getByRole('button', { name: '关闭' }).click();
    const guard = page.getByRole('dialog', { name: '存在未保存调整' });
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: '取消' }).click();
    await expect(guard).toBeHidden();
    await expect(detail).toBeVisible();

    await selectDetailOption('证据版本', '上一版');
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: '保留草稿并继续' }).click();
    await expect(guard).toBeHidden();
    await expect(detail.getByRole('combobox', { name: '证据版本' })).toContainText('上一版');
    await expect(detail).toContainText('previous · regional-approval-fixture-v3');

    await selectDetailOption('证据版本', '当前版');
    await expect(firstSku.getByText('已采纳', { exact: true })).toBeVisible();
    await firstSku.getByRole('textbox', { name: 'FSKU001 调整原因' }).fill('E2E Fixture 节庆备货调整');
    await detail.getByRole('button', { name: '保存调整（仅本地）' }).click();
    await expect(detail.getByText('调整已保存到本地看板草稿；尚未发送或提交。')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const entry = Object.entries(sessionStorage).find(
            ([key]) => key.includes(':forecast:') && key.endsWith(':context-payload')
          );
          if (!entry) return null;
          const snapshot = JSON.parse(entry[1]) as { value?: string };
          return snapshot.value ? JSON.parse(snapshot.value) : null;
        })
      )
      .toMatchObject({
        changes: [
          {
            organizationId: 'north-area',
            version: 'current',
            skuId: 'north-area-FSKU001',
            reason: 'E2E Fixture 节庆备货调整',
            suggestionDisposition: 'accepted',
          },
        ],
        metrics: { savedAdjustmentCount: 1 },
      });

    await detail.getByRole('button', { name: '关闭' }).click();
    await expect(detail).toBeHidden();
    const footerDetail = page.getByRole('button', { name: '查看当前行证据' });
    await footerDetail.focus();
    await footerDetail.press('Enter');
    await expect(detail).toBeVisible();
    await expect(firstSku.getByText('已采纳', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '退回', exact: true })).toBeEnabled();
  });

  test('returns and submits a plan through the local Fixture state machine without duplicating results', async ({
    page,
  }) => {
    const selectActionOption = async (label: string, option: string) => {
      const dialog = page.getByRole('dialog', { name: '区域计划审批操作' });
      const combobox = dialog.getByRole('combobox', { name: label });
      await combobox.click();
      await expect(combobox).toHaveAttribute('aria-expanded', 'true');
      const popup = page.locator('.arco-trigger:visible:not([class*="exit"]) .arco-select-popup:visible').last();
      await expect(popup).toBeVisible();
      await popup.getByRole('option', { name: option, exact: true }).click();
      await expect(popup).toBeHidden();
    };

    await page.getByTestId('assistant-surface-switcher').click();
    const modeDrawer = page.locator('.arco-drawer-wrapper:visible').last();
    await page.getByTestId('assistant-surface-option-business').click();
    await expect(modeDrawer).toBeHidden();
    await expect(page.locator('.arco-drawer-wrapper:visible')).toHaveCount(0);

    const queueCheckboxes = await page.getByRole('region', { name: '审批核对队列' }).getByRole('checkbox').all();
    const selectableRows = (
      await Promise.all(
        queueCheckboxes.map(async (checkbox) =>
          (await checkbox.isEnabled()) && (await checkbox.getAttribute('value')) !== null ? checkbox : null
        )
      )
    ).filter((checkbox) => checkbox !== null);
    expect(selectableRows).toHaveLength(2);
    await selectableRows[0].click();
    await selectableRows[1].click();
    await expect(page.getByText('已选择 2 个组织', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: '查看 华北大区 证据与调整' }).click();
    const detail = page.getByRole('dialog', { name: '组织计划证据与 SKU 调整' });
    const firstSku = page.getByTestId('approval-detail-north-area-FSKU001');
    await firstSku.getByRole('button', { name: '采纳' }).click();
    await firstSku.getByRole('textbox', { name: 'FSKU001 调整原因' }).fill('E2E 审批前已保存调整');
    await detail.getByRole('button', { name: '保存调整（仅本地）' }).click();
    await expect(detail.getByText('调整已保存到本地看板草稿；尚未发送或提交。')).toBeVisible();
    await detail.getByRole('button', { name: '关闭' }).click();

    const actionEntry = page.getByRole('button', { name: '退回', exact: true });
    await actionEntry.click();
    const actionDialog = page.getByRole('dialog', { name: '区域计划审批操作' });
    await expect(actionDialog).toContainText('不会调用 GEA、HTTP、IPC 或伪造真实审批回执');
    await expect(actionDialog).toContainText('2 个组织');
    await expect(actionDialog).toContainText('当前版');
    await expect(actionDialog).toContainText('已保存调整1');

    await actionDialog.getByRole('button', { name: '确认退回（仅本地）' }).click();
    await expect(actionDialog.getByText('请补全退回目标、影响范围和退回原因。')).toBeVisible();
    await selectActionOption('退回目标（必填）', '上一审批节点');
    await actionDialog.getByRole('textbox', { name: '退回原因（必填）' }).fill('补齐当前版本高偏差证据');
    await actionDialog.getByRole('button', { name: '确认退回（仅本地）' }).click();
    await expect(actionDialog.getByText('正在执行本地样例操作…').first()).toBeVisible();
    await expect(actionDialog.getByRole('button', { name: '取消执行' })).toBeVisible();
    await expect(actionDialog.getByText('批量操作完成：成功 2 个，失败 0 个。')).toBeVisible();
    await expect(actionDialog.getByRole('button', { name: '已完成（防重复）' })).toBeDisabled();
    await actionDialog.getByRole('button', { name: '关闭' }).click();
    await expect(page.getByText('已退回 · 本地样例')).toHaveCount(2);

    await page.getByTestId('assistant-surface-navigation-contract').click();
    await expect(page.getByTestId('assistant-surface-contract')).toBeVisible();
    await page.getByTestId('assistant-surface-navigation-forecast').click();
    await expect(page.getByText('已退回 · 本地样例')).toHaveCount(2);

    await page.getByTestId('assistant-surface-switcher').click();
    await page.getByTestId('assistant-surface-option-general').click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/guid');
    await page.getByTestId('assistant-surface-switcher').click();
    await page.getByTestId('assistant-surface-option-business').click();
    await expect.poll(() => new URL(page.url()).hash).toBe('#/assistant-surface/forecast');
    await expect(page.getByText('已退回 · 本地样例')).toHaveCount(2);

    await actionEntry.focus();
    await actionEntry.press('Enter');
    await expect(actionDialog).toBeVisible();
    const submitTab = actionDialog.getByRole('tab', { name: '提交审批' });
    await submitTab.focus();
    await submitTab.press('Enter');
    await expect(actionDialog.getByText(/FSKU001 · \d+ → \d+ · E2E 审批前已保存调整/)).toBeVisible();
    const confirmation = actionDialog.getByRole('checkbox', {
      name: '我确认当前组织、版本和已保存调整摘要无误；仅生成本地样例结果。',
    });
    await confirmation.focus();
    await confirmation.press('Space');
    await expect(confirmation).toBeChecked();
    const submit = actionDialog.getByRole('button', { name: '确认提交（仅本地）' });
    await submit.focus();
    await submit.press('Enter');
    await expect(actionDialog.getByText('正在执行本地样例操作…').first()).toBeVisible();
    await expect(actionDialog.getByText('批量操作完成：成功 2 个，失败 0 个。')).toBeVisible();
    await expect(actionDialog.getByRole('button', { name: '已完成（防重复）' })).toBeDisabled();
    await actionDialog.getByRole('button', { name: '关闭' }).click();
    await expect(page.getByText('已提交 · 本地样例')).toHaveCount(2);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const entry = Object.entries(sessionStorage).find(
            ([key]) => key.includes(':forecast:') && key.endsWith(':context-payload')
          );
          if (!entry) return null;
          const snapshot = JSON.parse(entry[1]) as { value?: string };
          return snapshot.value ? JSON.parse(snapshot.value) : null;
        })
      )
      .toMatchObject({
        changes: [expect.objectContaining({ organizationId: 'north-area', version: 'current' })],
        localApprovalResults: [
          expect.objectContaining({ source: 'fixture', kind: 'return' }),
          expect.objectContaining({ source: 'fixture', kind: 'submit' }),
        ],
        metrics: { savedAdjustmentCount: 1, localApprovalResultCount: 2 },
      });

    /* eslint-disable no-await-in-loop -- one Electron window verifies the same local action at each width */
    for (const viewport of [
      { width: 900, height: 900 },
      { width: 1280, height: 800 },
      { width: 1536, height: 960 },
    ]) {
      await page.setViewportSize(viewport);
      await actionEntry.focus();
      await actionEntry.press('Enter');
      const currentDialog = page.getByRole('dialog', { name: '区域计划审批操作' }).last();
      await expect(currentDialog).toBeVisible();
      await expect(currentDialog).toHaveClass(/(?:appear|enter)-done/);
      const dialogBox = await currentDialog.boundingBox();
      expect(dialogBox).not.toBeNull();
      expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport.width);
      await currentDialog.getByRole('button', { name: '关闭' }).click();
      await expect(page.getByTestId('assistant-surface-navigation')).toBeVisible();
      await expect(page.getByTestId('forecast-board-region')).toBeVisible();
      await expect(page.getByTestId('forecast-conversation-region')).toBeVisible();
    }
    /* eslint-enable no-await-in-loop */
  });

  test('shares unread state across modes and follows the Notification target without guessing from source', async ({
    page,
  }) => {
    const targetConversation = await httpPost<{ id?: string }>(page, '/api/conversations', {
      name: `E2E Notification Target ${Date.now()}`,
      type: 'acp',
      extra: { workspace: os.tmpdir(), custom_workspace: true, backend: 'codex', session_mode: 'full-access' },
    });
    const targetConversationId = targetConversation.id;
    expect(targetConversationId).toBeTruthy();
    if (!targetConversationId) throw new Error('Notification target conversation was not created');
    const notification = {
      id: 'business-message-e2e',
      version: 'v1',
      status: 'unread',
      kind: 'event',
      severity: 'warning',
      title: '【省区审批】进度更新通知',
      summary: '郑州省区最新提报进度为 52%，存在客户未提报和版本差异。',
      body: [
        '## 未提报客户（3）',
        '北辰食品商贸、晨星冷链商贸、嘉禾冷冻商贸',
        '## SKU 与预测数量差异（4）',
        'FSKU001 等 4 个 SKU 需要复核',
        '## 审批建议',
        '先补齐缺失证据，再进入需求预测 Agent。',
        '## 版本差异明细',
        'V1.2 → V1.3，共 5 项差异。',
      ].join('\n'),
      dismissible: false,
      source: 'gea.forecast.approval',
      target: { type: 'conversation', conversationId: targetConversationId },
      created_at: '2026-08-30T01:44:00Z',
    };

    await page.addInitScript((initialNotification) => {
      const secondaryNotification = {
        ...initialNotification,
        id: 'business-message-source-e2e',
        title: 'AionCore 调度通知',
        summary: '后台调度已完成，请查看通知详情。',
        source: 'aioncore.scheduler',
        target: { type: 'notification' },
        created_at: '2026-08-30T01:45:00Z',
      };
      type NotificationFetchStub = {
        originalFetch: typeof window.fetch;
        notification: typeof initialNotification;
        secondaryNotification: typeof secondaryNotification;
        listRequests: number;
        lastReadCommand?: { expected_version?: string; idempotency_key?: string };
      };
      const host = window as typeof window & { __aionNotificationFetchStub?: NotificationFetchStub };
      const originalFetch = window.fetch.bind(window);
      host.__aionNotificationFetchStub = {
        originalFetch,
        notification: initialNotification,
        secondaryNotification,
        listRequests: 0,
      };
      const jsonHeaders = { 'Content-Type': 'application/json' };

      const jsonResponse = (data: unknown) =>
        new Response(JSON.stringify({ success: true, data }), {
          status: 200,
          headers: jsonHeaders,
        });

      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const pathname = new URL(url, window.location.href).pathname;
        if (!pathname.startsWith('/api/notifications')) return originalFetch(input, init);

        const state = host.__aionNotificationFetchStub;
        if (!state) return originalFetch(input, init);
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method === 'GET' && pathname === '/api/notifications') {
          state.listRequests += 1;
          return jsonResponse({
            revision: `revision-${state.notification.version}`,
            items: [state.notification, state.secondaryNotification],
            sync_state: 'fresh',
            last_synced_at: '2026-08-30T01:44:01Z',
            failure_codes: [],
          });
        }
        if (method === 'GET' && pathname === `/api/notifications/${state.notification.id}`) {
          return jsonResponse(state.notification);
        }
        if (method === 'POST' && pathname === `/api/notifications/${state.notification.id}/read`) {
          const rawBody =
            typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '{}';
          state.lastReadCommand = JSON.parse(rawBody) as NotificationFetchStub['lastReadCommand'];
          state.notification = { ...state.notification, version: 'v2', status: 'read' };
          return jsonResponse({
            receipt_id: 'receipt-read-business-message-e2e',
            notification_id: state.notification.id,
            version: state.notification.version,
            status: state.notification.status,
          });
        }
        return originalFetch(input, init);
      };
    }, notification);

    try {
      await page.reload();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const host = window as typeof window & {
              __aionNotificationFetchStub?: { listRequests: number };
            };
            return host.__aionNotificationFetchStub?.listRequests ?? 0;
          })
        )
        .toBeGreaterThan(0);
      await page.getByTestId('attention-inbox-trigger').click();
      const generalNotificationTab = page.getByRole('tab').filter({ hasText: /通知|Notifications/ });
      await expect(generalNotificationTab).toBeVisible();
      await expect(generalNotificationTab).toContainText('2');
      await generalNotificationTab.click();
      await expect(page.getByTestId(`notification-${notification.id}`)).toBeVisible();
      await page.getByTestId('attention-inbox-close').click();

      await page.getByTestId('assistant-surface-switcher').click();
      await page.getByTestId('assistant-surface-option-business').click();
      await expect(page.getByTestId('business-message-unread-count')).toHaveText('2');
      await page.getByTestId('assistant-surface-navigation-messages').click();
      await expect.poll(() => new URL(page.url()).hash).toBe('#/assistant-surface/forecast/messages');
      await expect(page.getByRole('heading', { name: '消息待办' })).toBeVisible();
      await expect(page.getByTestId('forecast-conversation-region')).toBeVisible();
      await expect(page.getByTestId('forecast-context-status')).toHaveCount(0);

      const inbox = page.getByRole('main', { name: '消息待办' });
      const listPanel = inbox.locator('section').first();
      const messageButton = page.getByTestId(`business-message-${notification.id}`);
      const messageTable = listPanel.locator('.arco-table');
      await expect(messageTable).toBeVisible();
      const messageLayout = await messageButton.evaluate((button) => {
        const cell = button.closest('td');
        const row = button.closest('tr');
        const table = button.closest('table');
        const panel = table?.closest('section');
        const lead = button.querySelector('[class*="messageLead"]');
        const title = button.querySelector('[class*="messageTitle"]');
        if (!cell || !row || !table || !panel || !lead || !title) return null;
        const panelBox = panel.getBoundingClientRect();
        const tableBox = table.getBoundingClientRect();
        const rowBox = row.getBoundingClientRect();
        const cellBox = cell.getBoundingClientRect();
        const buttonBox = button.getBoundingClientRect();
        const leadBox = lead.getBoundingClientRect();
        const titleBox = title.getBoundingClientRect();
        return {
          panel: { x: panelBox.x, right: panelBox.right, width: panelBox.width },
          table: { x: tableBox.x, right: tableBox.right, width: tableBox.width },
          row: { x: rowBox.x, right: rowBox.right, width: rowBox.width },
          cell: { x: cellBox.x, right: cellBox.right, width: cellBox.width },
          button: { x: buttonBox.x, right: buttonBox.right, width: buttonBox.width },
          lead: { x: leadBox.x, right: leadBox.right, width: leadBox.width },
          title: { x: titleBox.x, right: titleBox.right, width: titleBox.width },
        };
      });
      expect(messageLayout).not.toBeNull();
      expect(messageLayout!.table.x).toBeGreaterThanOrEqual(messageLayout!.panel.x - 1);
      expect(messageLayout!.table.right).toBeLessThanOrEqual(messageLayout!.panel.right + 1);
      expect(messageLayout!.row.width).toBeGreaterThanOrEqual(messageLayout!.table.width - 1);
      expect(messageLayout!.button.x).toBeGreaterThanOrEqual(messageLayout!.cell.x);
      expect(messageLayout!.button.right).toBeLessThanOrEqual(messageLayout!.cell.right);
      expect(messageLayout!.button.width).toBeGreaterThanOrEqual(messageLayout!.cell.width - 34);
      expect(messageLayout!.title.x).toBeGreaterThanOrEqual(messageLayout!.lead.right);
      expect(messageLayout!.title.x - messageLayout!.lead.right).toBeLessThanOrEqual(8);

      const sourceHeader = messageTable.getByRole('columnheader', { name: '来源' });
      const timeHeader = messageTable.getByRole('columnheader', { name: '时间' });
      const statusHeader = messageTable.getByRole('columnheader', { name: '状态' });
      const detailButton = messageButton.locator('xpath=ancestor::tr').getByRole('button', { name: '打开消息详情' });
      const [statusBox, detailButtonBox] = await Promise.all([statusHeader.boundingBox(), detailButton.boundingBox()]);
      expect(statusBox).not.toBeNull();
      expect(detailButtonBox).not.toBeNull();
      expect(statusBox!.x).toBeLessThan(detailButtonBox!.x);
      if (messageLayout!.panel.width <= 760) {
        await expect(sourceHeader).toBeHidden();
      } else {
        const sourceBox = await sourceHeader.boundingBox();
        expect(sourceBox).not.toBeNull();
        expect(sourceBox!.x).toBeLessThan(statusBox!.x);
      }
      if (messageLayout!.panel.width <= 620) {
        await expect(timeHeader).toBeHidden();
      } else {
        const timeBox = await timeHeader.boundingBox();
        expect(timeBox).not.toBeNull();
        expect(timeBox!.x).toBeLessThan(statusBox!.x);
      }

      const sourceFilter = inbox.getByRole('combobox', { name: '消息来源' });
      await sourceFilter.click();
      const sourcePopup = page.locator('.arco-trigger:visible:not([class*="exit"]) .arco-select-popup:visible').last();
      await expect(sourcePopup.getByRole('option', { name: 'gea.forecast.approval', exact: true })).toBeVisible();
      await expect(sourcePopup.getByRole('option', { name: 'aioncore.scheduler', exact: true })).toBeVisible();
      await sourcePopup.getByRole('option', { name: 'aioncore.scheduler', exact: true }).click();
      await expect(messageButton).toBeHidden();
      await expect(page.getByTestId('business-message-business-message-source-e2e')).toBeVisible();
      await sourceFilter.click();
      const allSourcesPopup = page
        .locator('.arco-trigger:visible:not([class*="exit"]) .arco-select-popup:visible')
        .last();
      await allSourcesPopup.getByRole('option', { name: '全部来源', exact: true }).click();
      await expect(messageButton).toBeVisible();

      await messageButton.click();
      await expect(page.getByRole('dialog')).toContainText(notification.title);
      await expect(page.getByRole('tab', { name: '未提报客户（3）' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'SKU 与预测数量差异（4）' })).toBeVisible();
      await expect(page.getByRole('tab', { name: '审批建议' })).toBeVisible();
      await expect(page.getByRole('tab', { name: '版本差异明细' })).toBeVisible();
      await expect(page.getByRole('dialog')).toContainText('已读');
      await expect(page.getByTestId('business-message-unread-count')).toHaveText('1');
      const readCommand = await page.evaluate(() => {
        const host = window as typeof window & {
          __aionNotificationFetchStub?: {
            lastReadCommand?: { expected_version?: string; idempotency_key?: string };
          };
        };
        return host.__aionNotificationFetchStub?.lastReadCommand;
      });
      expect(readCommand).toEqual({
        expected_version: 'v1',
        idempotency_key: 'notification:business-message-e2e:v1:read',
      });
      await page.getByRole('button', { name: '打开目标' }).click();

      await expect.poll(() => new URL(page.url()).hash).toBe(`#/conversation/${targetConversationId}`);
      await page.goBack();
      await expect.poll(() => new URL(page.url()).hash).toBe('#/assistant-surface/forecast/messages');
      await expect(page.getByRole('heading', { name: '消息待办' })).toBeVisible();

      await page.getByTestId('assistant-surface-switcher').click();
      await page.getByTestId('assistant-surface-option-general').click();
      await expect.poll(() => new URL(page.url()).hash).toBe('#/guid');
      await page.getByTestId('attention-inbox-trigger').click();
      const refreshedGeneralNotificationTab = page.getByRole('tab').filter({ hasText: /通知|Notifications/ });
      await expect(refreshedGeneralNotificationTab).toBeVisible();
      await expect(refreshedGeneralNotificationTab).toContainText('1');
    } finally {
      await page.evaluate(() => {
        const host = window as typeof window & {
          __aionNotificationFetchStub?: { originalFetch: typeof window.fetch };
        };
        if (host.__aionNotificationFetchStub) window.fetch = host.__aionNotificationFetchStub.originalFetch;
        delete host.__aionNotificationFetchStub;
      });
      await httpDelete(page, `/api/conversations/${encodeURIComponent(targetConversationId)}`).catch(() => {});
    }
  });

  test('embeds an existing real Conversation in the active Agent rail', async ({ page }) => {
    const name = `E2E Agent Surface ${Date.now()}`;
    const conversation = await httpPost<{ id?: string }>(page, '/api/conversations', {
      name,
      type: 'acp',
      extra: { workspace: os.tmpdir(), custom_workspace: true, backend: 'codex', session_mode: 'full-access' },
    });
    expect(conversation.id).toBeTruthy();

    try {
      await page.getByTestId('assistant-surface-switcher').click();
      await page.getByTestId('assistant-surface-option-business').click();
      await page.getByTestId('forecast-conversation-select').click();
      await page.getByText(new RegExp(name)).last().click();

      await expect(page.getByTestId('forecast-conversation-region')).toContainText(name);
      await expect(page.locator('[data-conversation-chat-region]')).toBeVisible();
      await expect(page.getByTestId('sendbox-input')).toBeVisible();
      await expect(page.getByText(/下一轮同步 v\d+/).first()).toBeVisible();
      await page.screenshot({ path: 'tests/e2e/results/assistant-surface-real-conversation-1280.png' });
    } finally {
      if (conversation.id) {
        await httpDelete(page, `/api/conversations/${encodeURIComponent(conversation.id)}`).catch(() => {});
      }
    }
  });

  test('preserves one Workbench while keeping Conversation drafts, Turns, and Context receipts isolated', async ({
    page,
  }) => {
    const firstName = `E2E Surface Context A ${Date.now()}`;
    const secondName = `E2E Surface Context B ${Date.now()}`;
    const firstConversation = await httpPost<{ id?: string }>(page, '/api/conversations', {
      name: firstName,
      type: 'acp',
      extra: { workspace: os.tmpdir(), custom_workspace: true, backend: 'codex', session_mode: 'full-access' },
    });
    const secondConversation = await httpPost<{ id?: string }>(page, '/api/conversations', {
      name: secondName,
      type: 'acp',
      extra: { workspace: os.tmpdir(), custom_workspace: true, backend: 'codex', session_mode: 'full-access' },
    });
    expect(firstConversation.id).toBeTruthy();
    expect(secondConversation.id).toBeTruthy();

    const firstConversationId = firstConversation.id!;
    const secondConversationId = secondConversation.id!;
    await page.evaluate(
      ({ conversationIds }) => {
        type SentTurn = { text: string; content: string; turnId: string };
        type AttemptOutcome = 'success' | 'failure' | 'cancel';
        type SendAttempt = { content: string; outcome: AttemptOutcome };
        type FetchStubState = {
          originalFetch: typeof window.fetch;
          turns: Record<string, SentTurn>;
          attempts: Record<string, SendAttempt[]>;
          nextOutcome: Record<string, AttemptOutcome>;
        };
        const host = window as typeof window & { __aionSurfaceFetchStub?: FetchStubState };
        const originalFetch = window.fetch.bind(window);
        const turns: Record<string, SentTurn> = {};
        const attempts: Record<string, SendAttempt[]> = {};
        const nextOutcome: Record<string, AttemptOutcome> = {};
        host.__aionSurfaceFetchStub = { originalFetch, turns, attempts, nextOutcome };

        window.fetch = async (input, init) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          const match = new URL(url, window.location.href).pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
          const conversationId = match ? decodeURIComponent(match[1]) : null;
          if (!conversationId || !conversationIds.includes(conversationId)) return originalFetch(input, init);

          const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
          if (method === 'POST') {
            const rawBody = typeof init?.body === 'string' ? init.body : '';
            const content = (JSON.parse(rawBody) as { content?: string }).content ?? '';
            const outcome = nextOutcome[conversationId] ?? 'success';
            nextOutcome[conversationId] = 'success';
            (attempts[conversationId] ??= []).push({ content, outcome });
            if (outcome === 'cancel') throw new DOMException('fixture cancelled', 'AbortError');
            if (outcome === 'failure') {
              return new Response(
                JSON.stringify({ success: false, code: 'FIXTURE_SEND_FAILED', error: 'Fixture send failed' }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
              );
            }
            const turnId = `turn-${conversationId}`;
            turns[conversationId] = {
              text: content.split('\n\n[[AION_SURFACE_CONTEXT]]')[0] ?? '',
              content,
              turnId,
            };
            return new Response(
              JSON.stringify({
                msg_id: `message-${conversationId}`,
                turn_id: turnId,
                runtime: {
                  state: 'running',
                  can_send_message: true,
                  has_task: true,
                  task_status: 'running',
                  is_processing: true,
                  pending_confirmations: 0,
                  turn_id: turnId,
                  supports_midturn_delivery: true,
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }

          const turn = turns[conversationId];
          return new Response(
            JSON.stringify({
              items: turn
                ? [
                    {
                      id: `message-${conversationId}`,
                      msg_id: `message-${conversationId}`,
                      conversation_id: conversationId,
                      type: 'text',
                      content: { content: turn.text },
                      position: 'right',
                      status: 'finish',
                      backend_turn_id: turn.turnId,
                      created_at: Date.now(),
                    },
                  ]
                : [],
              oldest_cursor: null,
              newest_cursor: null,
              has_more_before: false,
              has_more_after: false,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        };
      },
      { conversationIds: [firstConversationId, secondConversationId] }
    );

    const contextRevision = async () => {
      const text = await page.getByTestId('forecast-context-status').textContent();
      return Number(text?.match(/v(\d+)/)?.[1] ?? 0);
    };
    const sharedRevision = async (conversationId: string) =>
      page.evaluate((id) => {
        const entry = Object.entries(sessionStorage).find(([key]) =>
          key.includes(`:conversation:${id}:last-shared-revision`)
        );
        const snapshot = entry ? (JSON.parse(entry[1]) as { value?: number }) : null;
        return Number(snapshot?.value ?? 0);
      }, conversationId);
    const sentTurn = (conversationId: string) =>
      page.evaluate((id) => {
        const host = window as typeof window & {
          __aionSurfaceFetchStub?: {
            turns: Record<string, { text: string; content: string; turnId: string }>;
          };
        };
        return host.__aionSurfaceFetchStub?.turns[id] ?? null;
      }, conversationId);
    const sendAttempts = (conversationId: string) =>
      page.evaluate((id) => {
        const host = window as typeof window & {
          __aionSurfaceFetchStub?: {
            attempts: Record<string, Array<{ content: string; outcome: 'success' | 'failure' | 'cancel' }>>;
          };
        };
        return host.__aionSurfaceFetchStub?.attempts[id] ?? [];
      }, conversationId);
    const setNextSendOutcome = (conversationId: string, outcome: 'success' | 'failure' | 'cancel') =>
      page.evaluate(
        ({ id, nextOutcome }) => {
          const host = window as typeof window & {
            __aionSurfaceFetchStub?: {
              nextOutcome: Record<string, 'success' | 'failure' | 'cancel'>;
            };
          };
          if (host.__aionSurfaceFetchStub) host.__aionSurfaceFetchStub.nextOutcome[id] = nextOutcome;
        },
        { id: conversationId, nextOutcome: outcome }
      );
    const selectConversation = async (name: string) => {
      await page.getByTestId('forecast-conversation-select').click();
      await page.getByText(new RegExp(name)).last().click();
    };

    try {
      await page.getByTestId('assistant-surface-switcher').click();
      await page.getByTestId('assistant-surface-option-business').click();

      await selectConversation(firstName);
      await expect.poll(contextRevision).toBe(1);
      const queueCheckboxes = await page.getByRole('region', { name: '审批核对队列' }).getByRole('checkbox').all();
      const firstWritable = (
        await Promise.all(
          queueCheckboxes.map(async (checkbox) =>
            (await checkbox.isEnabled()) && (await checkbox.getAttribute('value')) !== null ? checkbox : null
          )
        )
      ).find((checkbox) => checkbox !== null);
      expect(firstWritable).toBeTruthy();
      await firstWritable!.click();
      await expect(page.getByText('已选择 1 个组织', { exact: true })).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const entry = Object.entries(sessionStorage).find(
              ([key]) => key.includes(':forecast:') && key.endsWith(':context-payload')
            );
            if (!entry) return [];
            const snapshot = JSON.parse(entry[1]) as { value?: string };
            const context = snapshot.value ? (JSON.parse(snapshot.value) as { selectedEntities?: unknown[] }) : null;
            return context?.selectedEntities ?? [];
          })
        )
        .toHaveLength(1);
      await page.getByTestId('regional-approval-stage-category').click();
      await expect(page.getByTestId('regional-approval-current-stage')).toHaveText('品类计划审核');
      await expect(page.getByText('当前 1 条 · 待审批 0 条', { exact: true })).toBeVisible();
      await expect(page.getByText('华东大区', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('华北大区', { exact: true })).toHaveCount(0);
      await expect.poll(contextRevision).toBeGreaterThan(1);

      await page.getByRole('button', { name: '查看 华东大区 证据与调整' }).click();
      const detail = page.getByRole('dialog', { name: '组织计划证据与 SKU 调整' });
      const firstSku = page.getByTestId('approval-detail-east-area-FSKU001');
      await firstSku.getByRole('button', { name: '采纳' }).click();
      await firstSku.getByRole('textbox', { name: 'FSKU001 调整原因' }).fill('Conversation A 触发的本地调整');
      await detail.getByRole('button', { name: '保存调整（仅本地）' }).click();
      await expect(detail.getByText('调整已保存到本地看板草稿；尚未发送或提交。')).toBeVisible();
      await detail.getByRole('button', { name: '关闭' }).click();
      await expect(detail).toBeHidden();
      await expect.poll(contextRevision).toBeGreaterThan(2);
      const pendingRevisionAfterEdit = await contextRevision();

      const firstDraft = 'Conversation A 未发送草稿';
      const secondDraft = 'Conversation B 未发送草稿';
      const firstTurn = 'Conversation A Turn';
      const secondTurn = 'Conversation B Turn';
      const firstPostTurnDraft = 'Conversation A Turn 后草稿';
      const secondPostTurnDraft = 'Conversation B Turn 后草稿';
      const sendbox = page.getByTestId('sendbox-input');

      await sendbox.fill(firstDraft);

      await selectConversation(secondName);
      await expect(page.getByTestId('regional-approval-current-stage')).toHaveText('品类计划审核');
      await expect(page.getByText('当前 1 条 · 待审批 0 条', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '查看 华东大区 证据与调整' }).click();
      await expect(
        page.getByTestId('approval-detail-east-area-FSKU001').getByText('已采纳', { exact: true })
      ).toBeVisible();
      await page.getByRole('dialog', { name: '组织计划证据与 SKU 调整' }).getByRole('button', { name: '关闭' }).click();
      await expect(sendbox).toHaveValue('');
      await sendbox.fill(secondDraft);

      await selectConversation(firstName);
      await expect(page.getByTestId('regional-approval-current-stage')).toHaveText('品类计划审核');
      await expect(page.getByText('当前 1 条 · 待审批 0 条', { exact: true })).toBeVisible();
      await expect(sendbox).toHaveValue(firstDraft);
      await expect.poll(contextRevision).toBe(pendingRevisionAfterEdit);

      await sendbox.fill(firstTurn);
      const firstRevision = await contextRevision();
      expect(firstRevision).toBe(pendingRevisionAfterEdit);
      await setNextSendOutcome(firstConversationId, 'cancel');
      await page.getByTestId('sendbox-send-btn').click();
      await expect.poll(async () => (await sendAttempts(firstConversationId)).length).toBe(1);
      await expect.poll(() => sharedRevision(firstConversationId)).toBe(0);
      await expect(page.getByTestId('forecast-context-status')).toHaveText(`下一轮同步 v${firstRevision}`);

      await sendbox.fill(firstTurn);
      await expect(page.getByTestId('sendbox-send-btn')).toBeEnabled();
      await setNextSendOutcome(firstConversationId, 'failure');
      await page.getByTestId('sendbox-send-btn').click();
      await expect.poll(async () => (await sendAttempts(firstConversationId)).length).toBe(2);
      await expect.poll(() => sharedRevision(firstConversationId)).toBe(0);
      await expect(page.getByTestId('forecast-context-status')).toHaveText(`下一轮同步 v${firstRevision}`);

      await sendbox.fill(firstTurn);
      await expect(page.getByTestId('sendbox-send-btn')).toBeEnabled();
      await page.getByTestId('sendbox-send-btn').click();
      await expect.poll(async () => (await sentTurn(firstConversationId))?.text).toBe(firstTurn);
      const firstSentTurn = await sentTurn(firstConversationId);
      expect(firstSentTurn?.content).toContain('[[AION_SURFACE_CONTEXT]]');
      expect(surfaceContextRevisionFromContent(firstSentTurn?.content ?? '')).toBe(firstRevision);
      await expect(sendbox).toHaveValue('');
      await expect.poll(() => sharedRevision(firstConversationId)).toBe(firstRevision);
      const firstAttempts = await sendAttempts(firstConversationId);
      expect(firstAttempts.map(({ outcome }) => outcome)).toEqual(['cancel', 'failure', 'success']);
      expect(firstAttempts.map(({ content }) => surfaceContextRevisionFromContent(content))).toEqual([
        firstRevision,
        firstRevision,
        firstRevision,
      ]);
      await sendbox.fill(firstPostTurnDraft);

      await page.getByRole('button', { name: '查看 华东大区 证据与调整' }).click();
      await firstSku.getByRole('textbox', { name: 'FSKU001 调整原因' }).fill('发送成功后的第二次 Workbench 变化');
      await detail.getByRole('button', { name: '保存调整（仅本地）' }).click();
      await detail.getByRole('button', { name: '关闭' }).click();
      await expect.poll(contextRevision).toBe(firstRevision + 1);
      const nextWorkbenchRevision = await contextRevision();
      expect(surfaceContextRevisionFromContent(firstSentTurn?.content ?? '')).toBe(firstRevision);

      await selectConversation(secondName);
      await expect(page.getByText(firstTurn, { exact: true })).toHaveCount(0);
      await expect(sendbox).toHaveValue(secondDraft);
      await expect(page.getByTestId('forecast-context-status')).toContainText('下一轮同步');
      await sendbox.fill(secondTurn);
      const secondRevision = await contextRevision();
      expect(secondRevision).toBe(nextWorkbenchRevision);
      await page.getByTestId('sendbox-send-btn').click();
      await expect.poll(async () => (await sentTurn(secondConversationId))?.text).toBe(secondTurn);
      const secondSentTurn = await sentTurn(secondConversationId);
      expect(secondSentTurn?.content).toContain('[[AION_SURFACE_CONTEXT]]');
      expect(surfaceContextRevisionFromContent(secondSentTurn?.content ?? '')).toBe(secondRevision);
      await expect(sendbox).toHaveValue('');
      await expect.poll(() => sharedRevision(secondConversationId)).toBe(secondRevision);
      await sendbox.fill(secondPostTurnDraft);

      await selectConversation(firstName);
      await expect(page.getByText(firstTurn, { exact: true })).toBeVisible();
      await expect(page.getByText(secondTurn, { exact: true })).toHaveCount(0);
      await expect(sendbox).toHaveValue(firstPostTurnDraft);
      await expect(page.getByTestId('forecast-context-status')).toHaveText(`下一轮同步 v${nextWorkbenchRevision}`);

      await page.getByTestId('assistant-surface-switcher').click();
      await page.getByTestId('assistant-surface-option-general').click();
      await expect.poll(() => new URL(page.url()).hash).toBe('#/guid');
      await expect(page.getByText('新会话', { exact: true })).toBeVisible();

      await page.getByTestId('assistant-surface-switcher').click();
      await page.getByTestId('assistant-surface-option-business').click();
      await expect.poll(() => new URL(page.url()).hash).toBe('#/assistant-surface/forecast');
      await expect(page.getByTestId('regional-approval-current-stage')).toHaveText('品类计划审核');
      await expect(page.getByText('当前 1 条 · 待审批 0 条', { exact: true })).toBeVisible();
      await expect(page.getByText('华东大区', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('华北大区', { exact: true })).toHaveCount(0);
      await expect(sendbox).toHaveValue(firstPostTurnDraft);
      await expect(page.getByText(firstTurn, { exact: true })).toBeVisible();
      await expect(page.getByTestId('forecast-context-status')).toHaveText(`下一轮同步 v${nextWorkbenchRevision}`);

      await selectConversation(secondName);
      await expect(sendbox).toHaveValue(secondPostTurnDraft);
      await expect(page.getByText(secondTurn, { exact: true })).toBeVisible();
      await expect(page.getByText(firstTurn, { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('forecast-context-status')).toHaveText(`看板 v${secondRevision}`);
    } finally {
      await page.evaluate(() => {
        const host = window as typeof window & {
          __aionSurfaceFetchStub?: { originalFetch: typeof window.fetch };
        };
        if (host.__aionSurfaceFetchStub) window.fetch = host.__aionSurfaceFetchStub.originalFetch;
        delete host.__aionSurfaceFetchStub;
      });
      await Promise.all(
        [firstConversation, secondConversation].map((conversation) =>
          conversation.id
            ? httpDelete(page, `/api/conversations/${encodeURIComponent(conversation.id)}`).catch(() => {})
            : Promise.resolve()
        )
      );
    }
  });

  test('falls back safely when a surface id is not registered', async ({ page }) => {
    await page.goto(`${page.url().split('#')[0]}#/assistant-surface/not-registered`);
    await expect.poll(() => new URL(page.url()).hash).toBe('#/guid');
    await expect(page.getByTestId('assistant-surface-switcher')).toContainText('GEAUi');

    await page.goto(`${page.url().split('#')[0]}#/assistant-surface/forecast/not-registered`);
    await expect.poll(() => new URL(page.url()).hash).toBe('#/assistant-surface/forecast');
    await expect(page.getByTestId('regional-approval-workbench')).toBeVisible();
  });

  test('fills the product content canvas at all acceptance viewports', async ({ page }) => {
    /* eslint-disable no-await-in-loop -- one Electron window must be resized and verified sequentially */
    for (const viewport of [
      { width: 900, height: 900 },
      { width: 1280, height: 800 },
      { width: 1536, height: 960 },
    ]) {
      await page.setViewportSize(viewport);
      await page.getByTestId('assistant-surface-switcher').click();
      const modeDrawer = page.locator('.arco-drawer-wrapper:visible').last();
      await expect(modeDrawer.getByRole('dialog', { name: '切换工作模式' })).toBeVisible();
      await expect
        .poll(async () => {
          const box = await modeDrawer.locator('.arco-drawer').boundingBox();
          return box ? Math.round(box.x) : null;
        })
        .toBe(0);
      await page.screenshot({
        path: `tests/e2e/results/assistant-surface-work-mode-switcher-${viewport.width}px.png`,
      });
      await page.getByTestId('assistant-surface-option-business').click();
      await expect(modeDrawer).toBeHidden();
      const box = await page.getByTestId('assistant-surface-forecast').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeGreaterThanOrEqual(viewport.width - 1);
      expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewport.height - 1);

      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
      expect(overflow.document).toBeLessThanOrEqual(1);
      expect(overflow.body).toBeLessThanOrEqual(1);

      await expect(page.getByTestId('forecast-board-region')).toBeVisible();
      await expect(page.getByTestId('forecast-conversation-region')).toBeVisible();
      await expect(page.getByTestId('assistant-surface-navigation')).toBeVisible();
      await expect(page.getByTestId('regional-approval-workbench')).toBeVisible();
      await expect(page.locator('.arco-drawer-wrapper:visible')).toHaveCount(0);
      const domainBoxes = await Promise.all(
        [
          page.getByTestId('assistant-surface-navigation'),
          page.getByTestId('forecast-board-region'),
          page.getByTestId('forecast-conversation-region'),
        ].map((domain) => domain.boundingBox())
      );
      expect(domainBoxes.every((domain) => domain !== null)).toBe(true);
      expect(domainBoxes[0]!.x).toBeLessThan(domainBoxes[1]!.x);
      expect(domainBoxes[1]!.x).toBeLessThan(domainBoxes[2]!.x);
      await expect
        .poll(() =>
          page
            .getByTestId('forecast-conversation-region')
            .evaluate((element) => Boolean(element.closest('.arco-drawer')))
        )
        .toBe(false);
      const tableHasInternalHorizontalScroll = await page
        .getByRole('region', { name: '审批核对队列' })
        .locator('.arco-table-container')
        .evaluate((table) => {
          let current: HTMLElement | null = table.parentElement;
          while (current) {
            const overflowX = window.getComputedStyle(current).overflowX;
            if (overflowX === 'auto' || overflowX === 'scroll') return true;
            current = current.parentElement;
          }
          return false;
        });
      expect(tableHasInternalHorizontalScroll).toBe(true);
      await expect(page.getByTestId('regional-approval-stage-customer')).toBeVisible();
      await expect(page.getByTestId('regional-approval-stage-region')).toBeVisible();
      await expect(page.getByTestId('regional-approval-stage-province')).toBeVisible();
      await expect(page.getByTestId('regional-approval-stage-area')).toBeVisible();
      await expect(page.getByTestId('regional-approval-stage-category')).toBeVisible();

      await page.screenshot({
        path: `tests/e2e/results/assistant-surface-forecast-${viewport.width}px.png`,
      });

      await page.getByTestId('assistant-surface-switcher').click();
      await page.getByTestId('assistant-surface-option-general').click();
    }
    /* eslint-enable no-await-in-loop */
  });

  test('supports keyboard selection with the persistent Conversation rail', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    const switcher = page.getByTestId('assistant-surface-switcher');
    await switcher.focus();
    await switcher.press('Enter');
    const modeDrawer = page.locator('.arco-drawer-wrapper:visible').last();
    await expect(modeDrawer.getByRole('dialog', { name: '切换工作模式' })).toBeVisible();
    const businessOption = page.getByTestId('assistant-surface-option-business');
    await businessOption.focus();
    await expect(businessOption).toBeFocused();
    await expect(businessOption).toHaveAttribute('aria-pressed', 'false');
    const focusOutline = await businessOption.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });
    expect(focusOutline.style).not.toBe('none');
    expect(Number.parseFloat(focusOutline.width)).toBeGreaterThan(0);
    await businessOption.press('Escape');
    await expect(modeDrawer).toBeHidden();

    await switcher.focus();
    await switcher.press('Enter');
    await businessOption.focus();
    await businessOption.press('Enter');
    await expect(modeDrawer).toBeHidden();
    await expect(page.getByTestId('assistant-surface-forecast')).toBeVisible();

    await expect(page.getByTestId('forecast-conversation-region')).toBeVisible();
    await expect(page.getByRole('button', { name: '新对话' })).toBeVisible();
    await expect(page.getByTestId('regional-approval-workbench')).toBeVisible();

    const contractMenu = page.getByTestId('assistant-surface-navigation-contract');
    await contractMenu.focus();
    await contractMenu.press('Enter');
    await expect(page.getByTestId('assistant-surface-contract')).toBeVisible();

    // At the 900px recovery width the clause list is intentionally replaced by
    // the header Select, so exercise the keyboard path that remains visible.
    const clauseSelect = page.getByRole('combobox', { name: '选择风险条款' });
    await clauseSelect.focus();
    await clauseSelect.press('Enter');
    await clauseSelect.press('ArrowDown');
    await clauseSelect.press('Enter');
    await expect(page.getByRole('heading', { name: '7.1 违约责任' })).toBeVisible();

    const retainButton = page.getByRole('button', { name: '保留原文并说明（仅本地）' });
    await retainButton.focus();
    await retainButton.press('Enter');
    await expect(page.getByTestId('contract-active-review-state')).toHaveText('保留原文');
  });

  test('exposes the approval queue as a local read-only Fixture context', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId('assistant-surface-switcher').click();
    await page.getByTestId('assistant-surface-option-business').click();

    await expect(page.getByText('样例数据 · 不连接生产', { exact: true })).toBeVisible();
    await expect(page.getByText(/该建议来自样例数据，不连接真实 AI 或审批服务。/)).toBeVisible();
    await expect(page.getByRole('region', { name: '审批核对队列' })).toBeVisible();
    await expect(page.getByText('组织层级', { exact: true })).toBeVisible();
    await expect(page.getByTestId('regional-approval-stage-customer')).toBeVisible();
    await expect(page.getByTestId('regional-approval-stage-region')).toBeVisible();
    await expect(page.getByTestId('regional-approval-stage-province')).toBeVisible();
    await expect(page.getByTestId('regional-approval-stage-area')).toBeVisible();
    await expect(page.getByTestId('regional-approval-stage-category')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const entry = Object.entries(sessionStorage).find(
            ([key]) => key.includes(':forecast:') && key.endsWith(':context-payload')
          );
          if (!entry) return null;
          const snapshot = JSON.parse(entry[1]) as { value?: string };
          return snapshot.value ? JSON.parse(snapshot.value) : null;
        })
      )
      .toMatchObject({
        view: 'regional-approval',
        fixtureState: 'ready',
        scope: {
          planType: 'monthly',
          month: '2026-09',
          approvalStage: 'area',
          authority: 'organization',
        },
        selectedEntities: [],
        changes: [],
        metrics: { visibleCount: 4, pendingCount: 2, warningCount: 1 },
        evidence: { source: 'fixture', permission: 'read-only', completeness: 'skeleton' },
      });
  });

  test('approves a live sales plan through the normal user-session adapter without duplicating the action', async ({
    page,
  }) => {
    test.skip(
      process.env.AIONUI_E2E_SALES_PLAN_QUERY !== '1',
      'Run with the isolated sales-plan query flag so preload enables the live user-session adapter.'
    );
    await page.addInitScript(() => {
      const host = window as typeof window & {
        __aionuiE2ESalesPlanQuery?: boolean;
        __aionSalesPlanActionStub?: {
          originalFetch: typeof window.fetch;
          attempts: Array<{ body: unknown; headers: Record<string, string> }>;
        };
      };
      host.__aionuiE2ESalesPlanQuery = true;
      if (host.__aionSalesPlanActionStub) return;
      const originalFetch = window.fetch.bind(window);
      const attempts: Array<{ body: unknown; headers: Record<string, string> }> = [];
      host.__aionSalesPlanActionStub = { originalFetch, attempts };
      window.fetch = async (input, init) => {
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
          location.href
        );
        // oxlint-disable-next-line eslint-plugin-unicorn/consistent-function-scoping -- addInitScript serializes this closure.
        const json = (data: unknown, status = 200) =>
          new Response(JSON.stringify({ data }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          });
        if (url.pathname === '/api/gea/sales-plan/periods') {
          return json({
            records: [
              {
                periodId: 'period-e2e-action',
                tenantId: 'tenant-server-owned',
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
        if (url.pathname === '/api/gea/sales-plan/plans' && (init?.method ?? 'GET') === 'GET') {
          return json({
            records: [
              {
                planId: 'plan-e2e-action',
                versionId: 'version-e2e-action',
                seq: 3,
                periodId: 'period-e2e-action',
                planTypeCode: 'MONTHLY',
                dealerCode: 'dealer-server-owned',
                orgCode: 'ORG-E2E',
                provinceCode: 'PROVINCE-E2E',
                areaCode: 'AREA-E2E',
                baseName: 'E2E 真实审批计划',
                status: 4,
                returnReason: null,
                targetQty: '120.000',
                targetAmount: '1200.00',
                skuCount: 2,
                currentQty: '118.000',
                currentAmount: '1180.00',
              },
            ],
            total: 1,
            size: 2,
            current: 1,
            pages: 1,
          });
        }
        if (
          url.pathname === '/api/gea/sales-plan/plans/versions/version-e2e-action/actions' &&
          init?.method === 'POST'
        ) {
          const headers = Object.fromEntries(new Headers(init.headers).entries());
          attempts.push({ body: JSON.parse(String(init.body)), headers });
          return json({
            planId: 'plan-e2e-action',
            versionId: 'version-e2e-action',
            fromStatus: 4,
            toStatus: 5,
            replayed: false,
            requestId: headers['x-request-id'],
            traceId: 'trace-e2e-action',
            auditId: 'audit-e2e-action',
          });
        }
        return originalFetch(input, init);
      };
    });

    try {
      await page.reload();
      await expect(page.getByTestId('assistant-surface-switcher')).toBeVisible();
      await page.getByTestId('assistant-surface-switcher').click();
      await page.getByTestId('assistant-surface-option-business').click();
      await expect(page.getByText('GEA · 用户会话队列', { exact: true })).toBeVisible();

      const open = page.getByRole('button', { name: '审批 E2E 真实审批计划' });
      await open.click();
      const dialog = page.getByRole('dialog', { name: '真实销售计划审批' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveClass(/(?:appear|enter)-done/);
      const checksum = dialog.getByTestId('regional-approval-live-action-checksum');
      await expect(checksum).toContainText('E2E 真实审批计划 · AREA-E2E / PROVINCE-E2E / ORG-E2E');
      await expect(checksum).toContainText('目标 120.000 → 当前 118.000');
      await expect(checksum).toContainText('目标 ¥1,200.00 → 当前 ¥1,180.00');
      await expect(checksum).toContainText('1 个计划 · 2 个 SKU');
      await expect(checksum).toContainText('通过 → 品类审批');
      await expect(dialog.getByText(/结果未知时仅以原幂等键重试同一意图/)).toBeVisible();
      await dialog
        .getByText('我已核对当前计划、版本和状态，并确认以当前登录用户执行本次审批。', { exact: true })
        .click();
      const confirm = dialog.getByRole('button', { name: '确认通过' });
      await confirm.click();
      await expect(dialog.getByText(/审计回执 audit-e2e-action/)).toBeVisible();
      await expect(open).toBeDisabled();

      const attempts = await page.evaluate(() => {
        const host = window as typeof window & {
          __aionSalesPlanActionStub?: { attempts: Array<{ body: unknown; headers: Record<string, string> }> };
        };
        return host.__aionSalesPlanActionStub?.attempts ?? [];
      });
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        body: { action: 'APPROVE', expectedStatus: 4 },
        headers: {
          'content-type': 'application/json',
          'idempotency-key': expect.stringMatching(/^gea-sales-plan-action:/),
          'x-request-id': expect.any(String),
        },
      });
      expect(JSON.stringify(attempts[0].body)).not.toMatch(/tenant|user|role|permission|adjustments/i);
    } finally {
      await page.evaluate(() => {
        const host = window as typeof window & {
          __aionuiE2ESalesPlanQuery?: boolean;
          __aionSalesPlanActionStub?: { originalFetch: typeof window.fetch };
        };
        if (host.__aionSalesPlanActionStub) window.fetch = host.__aionSalesPlanActionStub.originalFetch;
        delete host.__aionSalesPlanActionStub;
        delete host.__aionuiE2ESalesPlanQuery;
      });
    }
  });

  test('keeps all three Business domains usable in English, dark theme, reduced motion, and 200% zoom', async ({
    electronApp,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goToSettings(page, 'system');

    const languageSelect = page.locator('.aion-select .arco-select-view').first();
    await languageSelect.click();
    await page.locator('.arco-select-option:has-text("English")').click();
    await page.waitForFunction(() => document.body.textContent?.includes('Language'), { timeout: 5_000 });

    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.setViewportSize({ width: 1800, height: 900 });
    await setZoomFactor(electronApp, 2);
    try {
      await page.evaluate(() => {
        window.location.hash = '#/assistant-surface/forecast';
      });
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(900);
      await expect(page.getByTestId('assistant-surface-forecast')).toBeVisible();
      await expect(page.getByTestId('assistant-surface-navigation')).toBeVisible();
      await expect(page.getByTestId('forecast-board-region')).toBeVisible();
      await expect(page.getByTestId('forecast-conversation-region')).toBeVisible();
      await expect(page.locator('.arco-drawer-wrapper:visible')).toHaveCount(0);
      await expect(page.getByText('Sales plan approval', { exact: true })).toBeVisible();
      await expect(page.getByTestId('regional-approval-current-stage')).toHaveText('Area approval');
      await expect(page.getByRole('region', { name: 'Approval review queue' })).toBeVisible();
      await expect(page.getByTestId('regional-approval-stage-area')).toBeVisible();
      await expect(page.getByRole('button', { name: 'New conversation' })).toBeVisible();

      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
      expect(overflow.document).toBeLessThanOrEqual(1);
      expect(overflow.body).toBeLessThanOrEqual(1);
      await page.screenshot({ path: 'tests/e2e/results/assistant-surface-forecast-english-dark-200pct.png' });
    } finally {
      await setZoomFactor(electronApp, 1);
      await page.setViewportSize({ width: 1280, height: 800 });
    }
  });
});

test.describe('Agent Surface rollback gate', () => {
  test('keeps specialized fixture routes closed when the flag is disabled', async ({ page }) => {
    test.skip(
      process.env.AIONUI_E2E_AUTH_BYPASS !== '1' || process.env.AIONUI_ASSISTANT_SURFACE_FIXTURES === '1',
      'Run with only the isolated E2E auth-bypass flag to verify the rollback boundary.'
    );

    await page.goto(`${page.url().split('#')[0]}#/assistant-surface/forecast`);
    await expect.poll(() => new URL(page.url()).hash).toBe('#/guid');
    await expect(page.getByTestId('assistant-surface-switcher')).toContainText('GEAUi');
    await page.getByTestId('assistant-surface-switcher').click();
    const dialog = page.getByRole('dialog', { name: '切换工作模式' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('assistant-surface-option-general')).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByTestId('assistant-surface-option-business')).toBeVisible();
    await expect(dialog.getByTestId('assistant-surface-option-business')).toBeDisabled();
    await expect(dialog.getByText('待接入', { exact: true })).toHaveCount(1);
    await expect(dialog.getByText('企业受管', { exact: true })).toHaveCount(0);
    await expect(dialog.getByTestId('assistant-surface-fixture-boundary')).toHaveCount(0);
  });
});
