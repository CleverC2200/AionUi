import { salesPlan, type GeaSalesPlanActionReceipt, type GeaSalesPlanSku } from '@/common/adapter/ipcBridge';
import { Alert, Button, Checkbox, Input, Modal, Radio, Spin } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import React, { useEffect, useMemo, useState } from 'react';
import { useSalesPlanAction } from './hooks/useSalesPlanAction';
import {
  salesPlanActionTargetStatus,
  salesPlanApprovalNodeForStatus,
  type SalesPlanActionClient,
  type SalesPlanActionErrorKind,
} from './models/salesPlanActionModel';
import { salesPlanSkuNodeComparison, salesPlanSkusMatchVersion } from './models/salesPlanDetailModel';
import { addExactDecimals, formatExactDecimal, type RegionalApprovalLiveRow } from './regionalApprovalQueryModel';
import type { ApprovalStageId } from './regionalApprovalFixture';
import styles from './RegionalApprovalActionDialog.module.css';

export type LiveActionKind = 'APPROVE' | 'REJECT';

const SIGNED_DECIMAL_PATTERN = /^[+-]?\d+(?:\.\d{1,3})?$/;
const ZERO_DECIMAL_PATTERN = /^[+-]?0+(?:\.0{1,3})?$/;

type AdjustmentSkuState =
  | { status: 'idle' | 'loading' }
  | { status: 'success'; data: GeaSalesPlanSku[] }
  | { status: 'error' };

const decimalText = (value: unknown): string | undefined => {
  if (typeof value === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(value.trim())) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const parseExactDecimal = (value: string) => {
  const match = value.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) return undefined;
  const fraction = match[3] ?? '';
  const coefficient = BigInt(`${match[2]}${fraction}`) * (match[1] === '-' ? BigInt(-1) : BigInt(1));
  return { coefficient, scale: fraction.length };
};

const multiplyExactDecimals = (left: string, right: string, targetScale = 2): string | undefined => {
  const leftDecimal = parseExactDecimal(left);
  const rightDecimal = parseExactDecimal(right);
  if (!leftDecimal || !rightDecimal) return undefined;
  const product = leftDecimal.coefficient * rightDecimal.coefficient;
  const productScale = leftDecimal.scale + rightDecimal.scale;
  const scaleFactor = BigInt(`1${'0'.repeat(Math.max(0, productScale - targetScale))}`);
  const absolute = product < 0 ? -product : product;
  const rounded =
    productScale > targetScale
      ? absolute / scaleFactor + ((absolute % scaleFactor) * BigInt(2) >= scaleFactor ? BigInt(1) : BigInt(0))
      : absolute * BigInt(`1${'0'.repeat(targetScale - productScale)}`);
  const signed = product < 0 ? -rounded : rounded;
  const negative = signed < 0;
  const raw = (negative ? -signed : signed).toString().padStart(targetScale + 1, '0');
  return `${negative ? '-' : ''}${raw.slice(0, -targetScale)}.${raw.slice(-targetScale)}`;
};

const signedDecimal = (value: string, currency = false) => {
  const negative = value.startsWith('-');
  const absolute = negative ? value.slice(1) : value;
  const prefix = negative ? '-' : /^0(?:\.0+)?$/.test(absolute) ? '' : '+';
  return `${prefix}${currency ? '¥' : ''}${formatExactDecimal(absolute)}`;
};

const errorKey = (kind: SalesPlanActionErrorKind) =>
  `common.assistantSurface.regionalApproval.liveAction.errors.${kind}` as const;

const RegionalApprovalLiveActionDialog: React.FC<{
  visible: boolean;
  row: RegionalApprovalLiveRow;
  approvalStage: ApprovalStageId;
  initialAction?: LiveActionKind;
  t: TFunction;
  client?: SalesPlanActionClient;
  onPermissionDenied: (versionId: string) => void;
  onSucceeded: (receipt: GeaSalesPlanActionReceipt) => void | Promise<void>;
  onRefresh: () => void;
  onClose: () => void;
}> = ({
  visible,
  row,
  approvalStage,
  initialAction = 'APPROVE',
  t,
  client,
  onPermissionDenied,
  onSucceeded,
  onRefresh,
  onClose,
}) => {
  const [kind, setKind] = useState<LiveActionKind>(initialAction);
  const [remark, setRemark] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [discardConfirmVisible, setDiscardConfirmVisible] = useState(false);
  const [adjustmentValues, setAdjustmentValues] = useState<Record<string, string>>({});
  const [adjustmentSkus, setAdjustmentSkus] = useState<AdjustmentSkuState>({ status: 'idle' });
  const action = useSalesPlanAction({ client });
  const loading = action.state.status === 'loading';
  const canClose = !loading;
  const targetStatus = salesPlanActionTargetStatus(kind, row.status);
  const approvalNodeOrder = salesPlanApprovalNodeForStatus(row.status);
  const supportsAdjustments = approvalNodeOrder !== undefined && approvalNodeOrder >= 2;
  const adjustmentSource = client?.versionSkus ?? (client ? undefined : salesPlan.versionSkus);
  const adjustments = useMemo(
    () =>
      Object.entries(adjustmentValues)
        .map(([skuCode, adjustQty]) => ({ skuCode, adjustQty: adjustQty.trim() }))
        .filter(({ adjustQty }) => adjustQty && !ZERO_DECIMAL_PATTERN.test(adjustQty)),
    [adjustmentValues]
  );
  const adjustmentsInvalid = Object.values(adjustmentValues).some((value) => {
    const normalized = value.trim();
    return normalized.length > 0 && !SIGNED_DECIMAL_PATTERN.test(normalized);
  });
  const nodeComparisons = useMemo(() => {
    if (adjustmentSkus.status !== 'success') return [];
    return adjustmentSkus.data.map((sku) => {
      const skuCode = String(sku.skuCode);
      const input = adjustmentValues[skuCode]?.trim() ?? '';
      const adjustmentQty = input || '0';
      const adjustmentValid = SIGNED_DECIMAL_PATTERN.test(adjustmentQty);
      const nodeComparison = salesPlanSkuNodeComparison(sku, approvalStage);
      const previousQty = decimalText(nodeComparison.previousQty);
      const price = decimalText(sku.price);
      const storedPreviousAmount = decimalText(nodeComparison.previousAmount);
      const previousAmount =
        storedPreviousAmount ?? (previousQty && price ? multiplyExactDecimals(previousQty, price) : undefined);
      const confirmedQty = previousQty && adjustmentValid ? addExactDecimals([previousQty, adjustmentQty]) : undefined;
      const normalizedConfirmedQty = confirmedQty === '—' ? undefined : confirmedQty;
      return {
        sku,
        skuCode,
        adjustmentQty,
        adjustmentValid,
        previousQty,
        previousAmount,
        confirmedQty: normalizedConfirmedQty,
        confirmedAmount:
          normalizedConfirmedQty && price ? multiplyExactDecimals(normalizedConfirmedQty, price) : undefined,
        amountDelta: adjustmentValid && price ? multiplyExactDecimals(adjustmentQty, price) : undefined,
      };
    });
  }, [adjustmentSkus, adjustmentValues, approvalStage]);
  const nodeTotals = useMemo(() => {
    if (nodeComparisons.length === 0) return undefined;
    const total = (values: Array<string | undefined>) => {
      if (values.some((value) => value === undefined)) return undefined;
      const result = addExactDecimals(values as string[]);
      return result === '—' ? undefined : result;
    };
    return {
      previousQty: total(nodeComparisons.map((item) => item.previousQty)),
      previousAmount: total(nodeComparisons.map((item) => item.previousAmount)),
      adjustmentQty: total(nodeComparisons.map((item) => (item.adjustmentValid ? item.adjustmentQty : undefined))),
      amountDelta: total(nodeComparisons.map((item) => item.amountDelta)),
      confirmedQty: total(nodeComparisons.map((item) => item.confirmedQty)),
      confirmedAmount: total(nodeComparisons.map((item) => item.confirmedAmount)),
    };
  }, [nodeComparisons]);
  const invalid =
    !confirmed ||
    targetStatus === undefined ||
    (kind === 'REJECT' && !remark.trim()) ||
    Array.from(remark.trim()).length > 1000 ||
    (kind === 'APPROVE' && adjustmentsInvalid);
  const unknown = t('common.assistantSurface.regionalApproval.liveAction.checksum.unknown');
  const hasAdjustmentDraft = Object.values(adjustmentValues).some((value) => value.trim().length > 0);
  const displayDecimal = (value: unknown, currency = false) =>
    typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())
      ? `${currency ? '¥' : ''}${formatExactDecimal(value)}`
      : unknown;
  const displayNodeTotal = (quantity: string | undefined, amount: string | undefined) =>
    quantity && amount ? `${formatExactDecimal(quantity)} · ¥${formatExactDecimal(amount)}` : unknown;
  const organizationPath = [
    row.areaName ?? row.regionName,
    row.provinceName ?? row.provinceRegionName,
    row.orgName ?? row.salesGroupName,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const organization = `${row.baseName?.trim() || row.dealerCode?.trim() || unknown} · ${
    organizationPath.length > 0 ? organizationPath.join(' / ') : unknown
  }`;
  const checksum = [
    {
      label: t('common.assistantSurface.regionalApproval.liveAction.checksum.organization'),
      value: organization,
    },
    {
      label: t('common.assistantSurface.regionalApproval.liveAction.checksum.stage'),
      value: t(`common.assistantSurface.regionalApproval.stages.${approvalStage}`),
    },
    {
      label: t('common.assistantSurface.regionalApproval.liveAction.checksum.difference'),
      value: t('common.assistantSurface.regionalApproval.liveAction.checksum.differenceValue', {
        targetQty: displayDecimal(row.targetQty),
        currentQty: displayDecimal(row.currentQty),
        targetAmount: displayDecimal(row.targetAmount, true),
        currentAmount: displayDecimal(row.currentAmount, true),
      }),
    },
    {
      label: t('common.assistantSurface.regionalApproval.liveAction.checksum.scope'),
      value: t('common.assistantSurface.regionalApproval.liveAction.checksum.scopeValue', {
        planCount: 1,
        skuCount: Number.isSafeInteger(row.skuCount) && row.skuCount >= 0 ? row.skuCount : unknown,
      }),
    },
    {
      label: t('common.assistantSurface.regionalApproval.liveAction.checksum.decision'),
      value: t('common.assistantSurface.regionalApproval.liveAction.checksum.decisionValue', {
        action: t(
          kind === 'APPROVE'
            ? 'common.assistantSurface.regionalApproval.liveAction.approve'
            : 'common.assistantSurface.regionalApproval.liveAction.reject'
        ),
        target:
          targetStatus === undefined
            ? unknown
            : t(`common.assistantSurface.regionalApproval.query.status.${targetStatus}`),
      }),
    },
    {
      label: t('common.assistantSurface.regionalApproval.liveAction.checksum.identity'),
      value: t('common.assistantSurface.regionalApproval.liveAction.checksum.identityValue'),
    },
  ];

  useEffect(() => {
    if (!visible || !supportsAdjustments || !adjustmentSource) {
      setAdjustmentSkus({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setAdjustmentSkus({ status: 'loading' });
    void adjustmentSource
      .invoke({ versionId: row.versionId, signal: controller.signal })
      .then((skus) => {
        if (controller.signal.aborted) return;
        setAdjustmentSkus(
          salesPlanSkusMatchVersion(row.versionId, skus) ? { status: 'success', data: skus } : { status: 'error' }
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setAdjustmentSkus({ status: 'error' });
      });
    return () => controller.abort();
  }, [adjustmentSource, row.versionId, supportsAdjustments, visible]);

  const complete = async (promise: Promise<GeaSalesPlanActionReceipt>) => {
    try {
      const receipt = await promise;
      try {
        await onSucceeded(receipt);
      } catch {
        setRefreshFailed(true);
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'kind' in error && error.kind === 'permission') {
        onPermissionDenied(row.versionId);
      }
    }
  };

  const submit = () => {
    setAttempted(true);
    if (invalid || loading || action.state.status === 'success') return;
    void complete(
      action.execute({
        planId: row.planId,
        versionId: row.versionId,
        request: {
          action: kind,
          expectedStatus: row.status,
          ...(remark.trim() ? { remark: remark.trim() } : {}),
          ...(kind === 'APPROVE' && adjustments.length > 0 ? { adjustments } : {}),
        },
      })
    );
  };

  const retry = () => {
    if (loading || action.state.status !== 'error' || !action.state.error.retrySameIntent) return;
    void complete(action.retry());
  };

  const requestClose = () => {
    if (!canClose) return;
    if (hasAdjustmentDraft && action.state.status !== 'success') {
      setDiscardConfirmVisible(true);
      return;
    }
    onClose();
  };

  return (
    <>
      <Modal
        visible={visible}
        className={styles.liveModal}
        title={t('common.assistantSurface.regionalApproval.liveAction.title')}
        maskClosable={false}
        closable={canClose}
        focusLock
        onCancel={requestClose}
        footer={
          <div className={styles.footer}>
            <div>
              <Button disabled={!canClose} onClick={requestClose}>
                {t('common.assistantSurface.regionalApproval.liveAction.close')}
              </Button>
              {action.state.status === 'error' && action.state.error.retrySameIntent ? (
                <Button type='primary' disabled={loading} onClick={retry}>
                  {t('common.assistantSurface.regionalApproval.liveAction.retry')}
                </Button>
              ) : action.state.status === 'error' && action.state.error.kind === 'conflict' ? (
                <Button
                  type='primary'
                  onClick={() => {
                    onRefresh();
                    onClose();
                  }}
                >
                  {t('common.assistantSurface.regionalApproval.liveAction.refresh')}
                </Button>
              ) : (
                <Button
                  type='primary'
                  disabled={invalid || loading || action.state.status === 'success'}
                  onClick={submit}
                >
                  {t(
                    action.state.status === 'success'
                      ? 'common.assistantSurface.regionalApproval.liveAction.completed'
                      : kind === 'APPROVE'
                        ? 'common.assistantSurface.regionalApproval.liveAction.confirmApprove'
                        : 'common.assistantSurface.regionalApproval.liveAction.confirmReject'
                  )}
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className={styles.body} data-testid='regional-approval-live-action-dialog'>
          <section className={styles.businessChecksum} data-testid='regional-approval-live-action-checksum'>
            <h3>{t('common.assistantSurface.regionalApproval.liveAction.checksum.title')}</h3>
            <dl>
              {checksum.map((item) => (
                <div key={String(item.label)}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className={styles.form}>
            <div className={styles.formControl}>
              <span>{t('common.assistantSurface.regionalApproval.liveAction.action')}</span>
              <Radio.Group
                value={kind}
                aria-label={t('common.assistantSurface.regionalApproval.liveAction.action')}
                disabled={targetStatus === undefined || loading || action.state.status === 'success'}
                onChange={(value) => {
                  setKind(value as LiveActionKind);
                  setAttempted(false);
                }}
              >
                <Radio value='APPROVE'>{t('common.assistantSurface.regionalApproval.liveAction.approve')}</Radio>
                <Radio value='REJECT'>{t('common.assistantSurface.regionalApproval.liveAction.reject')}</Radio>
              </Radio.Group>
            </div>
            {targetStatus === undefined ? (
              <Alert
                type='info'
                showIcon
                content={t('common.assistantSurface.regionalApproval.liveAction.finalNode')}
              />
            ) : null}
            {kind === 'APPROVE' && supportsAdjustments ? (
              <section
                className={styles.adjustments}
                aria-label={t('common.assistantSurface.regionalApproval.liveAction.adjustments.title')}
              >
                <div className={styles.adjustmentHeader}>
                  <strong>{t('common.assistantSurface.regionalApproval.liveAction.adjustments.title')}</strong>
                  <span>
                    {t('common.assistantSurface.regionalApproval.liveAction.adjustments.summary', {
                      count: adjustments.length,
                    })}
                  </span>
                </div>
                <p>{t('common.assistantSurface.regionalApproval.liveAction.adjustments.help')}</p>
                {adjustmentSkus.status === 'loading' ? (
                  <div className={styles.loadingState}>
                    <Spin size={18} />
                    <span>{t('common.assistantSurface.regionalApproval.liveAction.adjustments.loading')}</span>
                  </div>
                ) : adjustmentSkus.status === 'error' ? (
                  <Alert
                    type='warning'
                    showIcon
                    content={t('common.assistantSurface.regionalApproval.liveAction.adjustments.loadFailed')}
                  />
                ) : adjustmentSkus.status === 'success' ? (
                  <>
                    <div
                      className={styles.nodeTotals}
                      aria-label={t('common.assistantSurface.regionalApproval.liveAction.adjustments.nodeSummary')}
                    >
                      <span>
                        <small>
                          {t('common.assistantSurface.regionalApproval.liveAction.adjustments.previousTotal')}
                        </small>
                        <strong>{displayNodeTotal(nodeTotals?.previousQty, nodeTotals?.previousAmount)}</strong>
                      </span>
                      <span>
                        <small>
                          {t('common.assistantSurface.regionalApproval.liveAction.adjustments.changeTotal')}
                        </small>
                        <strong>
                          {nodeTotals?.adjustmentQty && nodeTotals.amountDelta
                            ? `${signedDecimal(nodeTotals.adjustmentQty)} · ${signedDecimal(nodeTotals.amountDelta, true)}`
                            : unknown}
                        </strong>
                      </span>
                      <span>
                        <small>
                          {t('common.assistantSurface.regionalApproval.liveAction.adjustments.confirmedTotal')}
                        </small>
                        <strong>{displayNodeTotal(nodeTotals?.confirmedQty, nodeTotals?.confirmedAmount)}</strong>
                      </span>
                    </div>
                    <div className={styles.adjustmentTable} role='table'>
                      <div className={styles.adjustmentTableHeader} role='row'>
                        <span role='columnheader'>
                          {t('common.assistantSurface.regionalApproval.liveAction.adjustments.sku')}
                        </span>
                        <span role='columnheader'>
                          {t('common.assistantSurface.regionalApproval.liveAction.adjustments.previousNode')}
                        </span>
                        <span role='columnheader'>
                          {t('common.assistantSurface.regionalApproval.liveAction.adjustments.adjustQty')}
                        </span>
                        <span role='columnheader'>
                          {t('common.assistantSurface.regionalApproval.liveAction.adjustments.currentNode')}
                        </span>
                      </div>
                      {nodeComparisons.map((comparison) => {
                        const value = adjustmentValues[comparison.skuCode] ?? '';
                        const invalidValue = !comparison.adjustmentValid;
                        const inputLabel = t(
                          'common.assistantSurface.regionalApproval.liveAction.adjustments.inputLabel',
                          {
                            sku: comparison.skuCode,
                          }
                        );
                        return (
                          <div className={styles.adjustmentTableRow} role='row' key={comparison.sku.id}>
                            <span role='cell'>
                              <strong>{comparison.skuCode}</strong>
                              <small>{comparison.sku.productCategName}</small>
                            </span>
                            <span role='cell' className={styles.nodeValue}>
                              <strong>{displayDecimal(comparison.previousQty)}</strong>
                              <small>{displayDecimal(comparison.previousAmount, true)}</small>
                            </span>
                            <span role='cell'>
                              <Input
                                size='small'
                                value={value}
                                status={invalidValue ? 'error' : undefined}
                                disabled={loading || action.state.status === 'success'}
                                aria-label={inputLabel}
                                placeholder={t(
                                  'common.assistantSurface.regionalApproval.liveAction.adjustments.placeholder'
                                )}
                                onChange={(nextValue) =>
                                  setAdjustmentValues((current) => ({ ...current, [comparison.skuCode]: nextValue }))
                                }
                              />
                            </span>
                            <span role='cell' className={styles.nodeValue}>
                              <strong>{displayDecimal(comparison.confirmedQty)}</strong>
                              <small>{displayDecimal(comparison.confirmedAmount, true)}</small>
                              <em>
                                {comparison.adjustmentValid && comparison.amountDelta
                                  ? `${signedDecimal(comparison.adjustmentQty)} · ${signedDecimal(comparison.amountDelta, true)}`
                                  : unknown}
                              </em>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <Alert
                    type='warning'
                    showIcon
                    content={t('common.assistantSurface.regionalApproval.liveAction.adjustments.unavailable')}
                  />
                )}
              </section>
            ) : (
              <Alert
                type='info'
                showIcon
                content={t(
                  kind === 'REJECT'
                    ? 'common.assistantSurface.regionalApproval.liveAction.adjustments.rejectBoundary'
                    : 'common.assistantSurface.regionalApproval.liveAction.adjustments.nodeBoundary'
                )}
              />
            )}
            <div className={styles.formControl}>
              <span>
                {t(
                  kind === 'REJECT'
                    ? 'common.assistantSurface.regionalApproval.liveAction.rejectRemark'
                    : 'common.assistantSurface.regionalApproval.liveAction.approveRemark'
                )}
              </span>
              <Input.TextArea
                value={remark}
                maxLength={1000}
                showWordLimit
                disabled={loading || action.state.status === 'success'}
                status={attempted && kind === 'REJECT' && !remark.trim() ? 'error' : undefined}
                aria-label={t(
                  kind === 'REJECT'
                    ? 'common.assistantSurface.regionalApproval.liveAction.rejectRemark'
                    : 'common.assistantSurface.regionalApproval.liveAction.approveRemark'
                )}
                placeholder={t('common.assistantSurface.regionalApproval.liveAction.remarkPlaceholder')}
                autoSize={{ minRows: 2, maxRows: 4 }}
                onChange={setRemark}
              />
            </div>
            <Checkbox
              checked={confirmed}
              disabled={loading || action.state.status === 'success'}
              aria-label={t('common.assistantSurface.regionalApproval.liveAction.confirmation')}
              onChange={setConfirmed}
            >
              {t('common.assistantSurface.regionalApproval.liveAction.confirmation')}
            </Checkbox>
            {attempted && invalid ? (
              <Alert
                type='error'
                showIcon
                content={t('common.assistantSurface.regionalApproval.liveAction.required')}
              />
            ) : null}
          </div>

          {loading ? (
            <div className={styles.loadingState}>
              <Spin size={20} />
              <span>{t('common.assistantSurface.regionalApproval.liveAction.loading')}</span>
            </div>
          ) : null}
          {action.state.status === 'error' ? (
            <Alert type='error' showIcon content={t(errorKey(action.state.error.kind))} />
          ) : null}
          {action.state.status === 'success' ? (
            <Alert
              type='success'
              showIcon
              content={t('common.assistantSurface.regionalApproval.liveAction.success', {
                from: action.state.receipt.fromStatus,
                to: action.state.receipt.toStatus,
                auditId: action.state.receipt.auditId,
              })}
            />
          ) : null}
          {refreshFailed ? (
            <Alert
              type='warning'
              showIcon
              content={t('common.assistantSurface.regionalApproval.liveAction.refreshFailed')}
            />
          ) : null}
        </div>
      </Modal>
      <Modal
        visible={discardConfirmVisible}
        title={t('common.assistantSurface.regionalApproval.liveAction.adjustments.discardTitle')}
        okText={t('common.assistantSurface.regionalApproval.liveAction.adjustments.discard')}
        cancelText={t('common.assistantSurface.regionalApproval.liveAction.adjustments.keepEditing')}
        okButtonProps={{ status: 'danger' }}
        maskClosable={false}
        focusLock
        onCancel={() => setDiscardConfirmVisible(false)}
        onOk={() => {
          setDiscardConfirmVisible(false);
          onClose();
        }}
      >
        {t('common.assistantSurface.regionalApproval.liveAction.adjustments.discardDescription')}
      </Modal>
    </>
  );
};

export default RegionalApprovalLiveActionDialog;
