import type { ApprovalActionReceipt } from '@/common/types/approval';

type ApprovalAction = 'approve' | 'reject' | 'transfer';

type StoredAttempts = {
  idempotencyKeys: Record<string, string>;
  verificationReceipts: Record<string, ApprovalActionReceipt>;
};

const STORAGE_KEY = 'aionui:feishu-approval-action-attempts:v1';
const emptyAttempts = (): StoredAttempts => ({ idempotencyKeys: {}, verificationReceipts: {} });

const readAttempts = (): StoredAttempts => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '') as Partial<StoredAttempts>;
    return {
      idempotencyKeys: parsed.idempotencyKeys ?? {},
      verificationReceipts: parsed.verificationReceipts ?? {},
    };
  } catch {
    return emptyAttempts();
  }
};

let attempts = readAttempts();

const persistAttempts = (): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attempts));
  } catch {
    // The in-memory guard remains effective when browser storage is unavailable.
  }
};

const attemptKey = (action: ApprovalAction, instanceCode: string, taskId: string): string =>
  `${action}:${instanceCode}:${taskId}`;
const receiptKey = (instanceCode: string, taskId: string): string => `${instanceCode}:${taskId}`;

export const getApprovalActionIdempotencyKey = (
  action: ApprovalAction,
  instanceCode: string,
  taskId: string
): string => {
  const key = attemptKey(action, instanceCode, taskId);
  const current = attempts.idempotencyKeys[key];
  if (current) return current;
  const created = `approval:${key}:${crypto.randomUUID()}`;
  attempts.idempotencyKeys[key] = created;
  persistAttempts();
  return created;
};

export const rememberApprovalActionReceipt = (receipt: ApprovalActionReceipt): void => {
  if (receipt.status !== 'unknown_external_write') return;
  attempts.verificationReceipts[receiptKey(receipt.instanceCode, receipt.taskId)] = receipt;
  persistAttempts();
};

export const getApprovalVerificationReceipt = (
  instanceCode: string,
  taskId: string
): ApprovalActionReceipt | undefined => attempts.verificationReceipts[receiptKey(instanceCode, taskId)];
