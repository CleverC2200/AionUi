import { expect, type Locator, type Page } from '@playwright/test';
import { invokeBridge } from './bridge';
import { TEAM_SUPPORTED_BACKENDS } from './teamConfig';

type TeamAgent = { role: string; name: string };
type TeamRecord = { id: string; name: string; agents: TeamAgent[] };

/** UI label patterns for each backend leader type. */
const BACKEND_UI_PATTERN: Record<string, RegExp> = {
  aionrs: /Aion CLI/i,
  claude: /Claude Code/i,
  codex: /Codex/i,
  gemini: /Gemini/i,
};

/**
 * Create a team through the sidebar UI (TeamCreateModal).
 *
 * Uses the real user flow so the TeamCreateModal.onCreated -> refreshTeams()
 * callback runs and the sidebar SWR cache stays in sync. Plain HTTP POST of
 * /api/teams would bypass this, leaving the sidebar empty under Playwright
 * Electron (see mnemo #269).
 *
 * Throws if no supported backend is available — callers should skip the test.
 */
export async function createTeam(page: Page, name: string, leaderType?: string): Promise<string> {
  if (TEAM_SUPPORTED_BACKENDS.size === 0) {
    throw new Error('No supported team backends available — skip this test');
  }

  await page.evaluate(() => {
    window.location.hash = '#/team';
  });
  await page.waitForFunction(() => window.location.hash === '#/team', { timeout: 10_000 }).catch(() => {});

  const modal = await openTeamCreateModal(page);

  const nameInput = modal.locator('[data-testid="team-create-name-input"]');
  await nameInput.fill(name);

  const option = await pickTeamCreateAssistantOption(modal, leaderType);
  if (!option) {
    await closeTeamCreateModal(modal);
    throw new Error(`No assistant option matched leader type "${leaderType ?? 'any'}" — skip this test`);
  }
  await option.click();

  const confirmBtn = modal.locator('.arco-btn-primary');
  await expect(confirmBtn).toBeEnabled({ timeout: 5_000 });
  await confirmBtn.click();

  await page.waitForURL(/\/team\/[^/?#]+/, { timeout: 15_000 });

  const hash = await page.evaluate(() => window.location.hash);
  const match = hash.match(/#\/team\/([^/?#]+)/);
  if (!match) {
    throw new Error(`Could not extract teamId from URL hash: ${hash}`);
  }
  return match[1];
}

export async function openTeamCreateModal(page: Page): Promise<Locator> {
  const existingModal = page.locator('.team-create-modal:visible').last();
  if ((await existingModal.count()) > 0) {
    await closeTeamCreateModal(existingModal);
  }

  await expandMainSidebar(page);

  const createBtn = page.locator('[data-testid="team-create-btn"]').first();
  await createBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await createBtn.click();

  const modal = page.locator('.team-create-modal').last();
  await modal.waitFor({ state: 'visible', timeout: 5_000 });
  return modal;
}

export async function expandMainSidebar(page: Page): Promise<void> {
  const teamSection = page.locator('[data-testid="team-section-toggle"]');
  if (await teamSection.isVisible({ timeout: 1_000 }).catch(() => false)) return;

  const toggle = page.locator('[data-testid="sider-toggle"]');
  await toggle.waitFor({ state: 'visible', timeout: 10_000 });
  const label = (await toggle.getAttribute('aria-label')) ?? '';
  if (/Expand sidebar|展开侧边栏|展开/i.test(label)) {
    await toggle.click();
  }
  await teamSection.waitFor({ state: 'visible', timeout: 10_000 });
}

export async function expandTeamSection(page: Page): Promise<void> {
  await expandMainSidebar(page);
  const toggle = page.locator('[data-testid="team-section-toggle"]');
  await toggle.waitFor({ state: 'visible', timeout: 10_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
}

export async function pickTeamCreateAssistantOption(
  root: Locator | Page,
  leaderType?: string
): Promise<Locator | null> {
  const options = root.locator('[data-testid^="team-create-agent-option-"]');
  await options
    .first()
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(() => {});

  if (!leaderType) {
    const count = await options.count().catch(() => 0);
    const patterns = [...TEAM_SUPPORTED_BACKENDS].map(
      (backend) => BACKEND_UI_PATTERN[backend] ?? new RegExp(backend, 'i')
    );
    for (let i = 0; i < count; i++) {
      const option = options.nth(i);
      const classes = (await option.getAttribute('class').catch(() => '')) ?? '';
      if (classes.includes('cursor-not-allowed')) continue;
      const text = await option.textContent().catch(() => '');
      if (patterns.some((pattern) => pattern.test(text ?? ''))) return option;
    }
    return null;
  }

  const pattern = BACKEND_UI_PATTERN[leaderType] ?? new RegExp(leaderType, 'i');
  const count = await options.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const option = options.nth(i);
    const classes = (await option.getAttribute('class').catch(() => '')) ?? '';
    if (classes.includes('cursor-not-allowed')) continue;
    const text = await option.textContent().catch(() => '');
    if (pattern.test(text ?? '')) return option;
  }
  return null;
}

export async function closeTeamCreateModal(modal: Locator): Promise<void> {
  const cancel = modal
    .locator('.arco-btn')
    .filter({ hasText: /Cancel|取消/i })
    .first();
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click({ force: true });
  } else {
    await modal.locator('button[aria-label="Close"]').click({ force: true });
  }
  await modal.waitFor({ state: 'hidden', timeout: 5_000 });
}

/**
 * Find-or-create a team by name. Returns teamId.
 */
export async function ensureTeam(page: Page, name: string, leaderType?: string): Promise<string> {
  const teams = await invokeBridge<TeamRecord[]>(page, 'team.list', {
    user_id: 'system_default_user',
  }).catch(() => [] as TeamRecord[]);

  const existing = teams.find((t) => t.name === name);
  if (existing) return existing.id;

  return createTeam(page, name, leaderType);
}

/**
 * Delete a team by id via IPC. No-op if team doesn't exist.
 */
export async function deleteTeam(page: Page, id: string): Promise<void> {
  await invokeBridge(page, 'team.remove', { id }).catch(() => {});
}

/**
 * Remove all teams whose name matches `name`. Used for pre-test cleanup.
 *
 * Cleanup is done via IPC — faster and doesn't require the sidebar row to
 * render. After deleting we reload the page so SWR refetches the team list
 * and the sidebar reflects current backend state.
 */
export async function cleanupTeamsByName(page: Page, name: string): Promise<void> {
  const teams = await invokeBridge<TeamRecord[]>(page, 'team.list', {
    user_id: 'system_default_user',
  }).catch(() => [] as TeamRecord[]);

  const matches = teams.filter((t) => t.name === name);
  for (const t of matches) {
    await invokeBridge(page, 'team.remove', { id: t.id }).catch(() => {});
  }

  if (matches.length > 0) {
    const url = page.url();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);
  }
}
