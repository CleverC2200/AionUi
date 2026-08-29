const actionableSelector =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Moves keyboard focus into a message reached from search or the attention inbox. */
export const focusMessageTarget = (target: HTMLElement | null): boolean => {
  if (!target) return false;
  const actionable = target.querySelector<HTMLElement>(actionableSelector);
  const focusTarget = actionable ?? target;
  if (!actionable && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  focusTarget.focus({ preventScroll: true });
  return document.activeElement === target || target.contains(document.activeElement);
};
