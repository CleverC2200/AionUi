import { focusMessageTarget } from '@/renderer/pages/conversation/Messages/focusMessageTarget';
import { describe, expect, it } from 'vitest';

describe('focusMessageTarget', () => {
  it('focuses the first actionable control in a recovered request', () => {
    const target = document.createElement('div');
    const button = document.createElement('button');
    target.append(button);
    document.body.append(target);

    expect(focusMessageTarget(target)).toBe(true);

    expect(document.activeElement).toBe(button);
    target.remove();
  });

  it('makes a non-interactive message programmatically focusable', () => {
    const target = document.createElement('div');
    document.body.append(target);

    expect(focusMessageTarget(target)).toBe(true);

    expect(target).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(target);
    target.remove();
  });

  it('reports when the browser did not move focus into the target', () => {
    const target = document.createElement('div');
    target.focus = () => {};
    document.body.append(target);

    expect(focusMessageTarget(target)).toBe(false);

    target.remove();
  });
});
