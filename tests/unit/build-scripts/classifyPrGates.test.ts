import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const { classifyPrGates } = require('../../../scripts/classify-pr-gates');

describe('classifyPrGates', () => {
  it('keeps documentation-only changes on the lightweight path', () => {
    expect(classifyPrGates(['docs/guides/setup.md', 'README.md'])).toEqual({
      docs_only: true,
      cross_platform_tests: false,
      installer_smoke: false,
      release_scripts: false,
    });
  });

  it('runs Linux checks without cross-platform installers for renderer-only changes', () => {
    expect(classifyPrGates(['packages/desktop/src/renderer/pages/conversation/index.tsx'])).toEqual({
      docs_only: false,
      cross_platform_tests: false,
      installer_smoke: false,
      release_scripts: false,
    });
  });

  it('upgrades native process changes to the cross-platform unit matrix', () => {
    const result = classifyPrGates(['packages/desktop/src/process/services/database/index.ts']);

    expect(result.cross_platform_tests).toBe(true);
    expect(result.installer_smoke).toBe(false);
  });

  it('runs installer smoke tests for packaging inputs', () => {
    const result = classifyPrGates(['packages/shared-scripts/src/prepare-aioncore.js']);

    expect(result.cross_platform_tests).toBe(true);
    expect(result.installer_smoke).toBe(true);
  });

  it('runs release script checks only when their contract changes', () => {
    const result = classifyPrGates(['scripts/prepare-release-assets.sh']);

    expect(result.release_scripts).toBe(true);
  });

  it('fails open to the full gate when the changed-file list is unavailable', () => {
    expect(classifyPrGates([])).toEqual({
      docs_only: false,
      cross_platform_tests: true,
      installer_smoke: true,
      release_scripts: true,
    });
  });
});

describe('PR gate workflow', () => {
  const workflow = readFileSync('.github/workflows/pr-checks.yml', 'utf8');

  it('keeps required check names while routing low-risk changes to lightweight jobs', () => {
    expect(workflow).toContain('name: Unit Tests (${{ matrix.os }})');
    expect(workflow).toContain('name: Build Test (${{ matrix.platform }})');
    expect(workflow).toContain('Fast renderer package test (Linux)');
    expect(workflow).toContain('Record lightweight platform pass');
    expect(workflow).toContain('Record lightweight build pass');
  });

  it('does not leak build-matrix expressions into the standalone i18n job', () => {
    const i18nSection = workflow.split('\n  i18n-check:')[1].split('\n  # Job 4:')[0];

    expect(i18nSection).not.toContain('matrix.platform');
  });
});
