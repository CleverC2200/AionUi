import { salesPlan, type GeaSalesPlanActionReceipt, type GeaSalesPlanSku } from '@/common/adapter/ipcBridge';
import { Alert, Button, Checkbox, Input, Modal, Radio, Spin, Tag } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import React, { useEffect, useMemo, useState } from 'react';
import { useSalesPlanAction } from './hooks/useSalesPlanAction';
import {
  salesPlanActionTargetStatus,
  type SalesPlanActionClient,
  type SalesPlanActionErrorKind,
} from './models/salesPlanActionModel';
import { salesPlanSkusMatchVersion } from './models/salesPlanDetailModel';
import { formatExactDecimal, type RegionalApprovalLiveRow } from './regionalApprovalQueryModel';
import type { ApprovalStageId } from './regionalApprovalFixture';
import styles from './RegionalApprovalActionDialog.module.css';

export type LiveActionKind = 'APPROVE' | 'REJECT';

const SIGNED_DECIMAL_PATTERN = /^[+-]?\d+(?:\.\d{1,3})?$/;
const ZERO_DECIMAL_PATTERN = /^[+-]?0+(?:\.0{1,3})?$/;

type AdjustmentSkuState =
  | { status: 'idle' | 'loading' }
  | { status: 'success'; data: GeaSalesPlanSku[] }
  | { status: 'error' };

const confirmedQuantityForStatus = (sku: GeaSalesPlanSku, status: number) => {
  if (status === 5) return sku.areaConfirmedQty ?? sku.provinceConfirmedQty ?? sku.regionConfirmedQty ?? sku.qty;
  if (status === 4) return sku.provinceConfirmedQty ?? sku.regionConfirmedQty ?? sku.qty;
  if (status === 3) return sku.regionConfirmedQty ?? sku.qty;
  return sku.qty;
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
  const [adjustmentValues, setAdjustmentValues] = useState<Record<string, string>>({});
  const [adjustmentSkus, setAdjustmentSkus] = useState<AdjustmentSkuState>({ status: 'idle' });
  const action = useSalesPlanAction({ client });
  const loading = action.state.status === 'loading';
  const canClose = !loading;
  const targetStatus = salesPlanActionTargetStatus(kind, row.status);
  const supportsAdjustments = row.status >= 2 && row.status <= 5;
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
  const invalid =
    !confirmed ||
    targetStatus === undefined ||
    (kind === 'REJECT' && !remark.trim()) ||
    Array.from(remark.trim()).length > 1000 ||
    (kind === 'APPROVE' && adjustmentsInvalid);
  const unknown = t('common.assistantSurface.regionalApproval.liveAction.checksum.unknown');
  const displayDecimal = (value: unknown, currency = false) =>
    typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())
      ? `${currency ? '¥' : ''}${formatExactDecimal(value)}`
      : unknown;
  const organizationPath = [row.areaCode, row.provinceCode, row.orgCode].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
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

  return (
    <Modal
      visible={visible}
      className={styles.modal}
      title={t('common.assistantSurface.regionalApproval.liveAction.title')}
      maskClosable={false}
      closable={canClose}
      focusLock
      onCancel={() => canClose && onClose()}
      footer={
        <div className={styles.footer}>
          <span>{t('common.assistantSurface.regionalApproval.liveAction.footerBoundary')}</span>
          <div>
            <Button disabled={!canClose} onClick={onClose}>
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
              <Button type='primary' disabled={loading || action.state.status === 'success'} onClick={submit}>
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
        <div className={styles.scopeSummary}>
          <span>
            <small>{t('common.assistantSurface.regionalApproval.liveAction.plan')}</small>
            <strong>{row.baseName ?? row.orgCode ?? row.dealerCode}</strong>
          </span>
          <span>
            <small>{t('common.assistantSurface.regionalApproval.liveAction.version')}</small>
            <strong>{row.versionId}</strong>
          </span>
          <span>
            <small>{t('common.assistantSurface.regionalApproval.liveAction.expectedStatus')}</small>
            <strong>{row.status}</strong>
          </span>
          <Tag color='arcoblue'>{t('common.assistantSurface.regionalApproval.liveAction.sessionTag')}</Tag>
        </div>
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
              disabled={loading || action.state.status === 'success'}
              onChange={(value) => {
                setKind(value as LiveActionKind);
                setAttempted(false);
              }}
            >
              <Radio value='APPROVE'>{t('common.assistantSurface.regionalApproval.liveAction.approve')}</Radio>
              <Radio value='REJECT' disabled={row.status === 5}>
                {t('common.assistantSurface.regionalApproval.liveAction.reject')}
              </Radio>
            </Radio.Group>
          </div>
          {row.status === 5 ? (
            <Alert type='info' showIcon content={t('common.assistantSurface.regionalApproval.liveAction.finalNode')} />
          ) : null}
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
                <div className={styles.adjustmentTable} role='table'>
                  <div className={styles.adjustmentTableHeader} role='row'>
                    <span role='columnheader'>
                      {t('common.assistantSurface.regionalApproval.liveAction.adjustments.sku')}
                    </span>
                    <span role='columnheader'>
                      {t('common.assistantSurface.regionalApproval.liveAction.adjustments.currentQty')}
                    </span>
                    <span role='columnheader'>
                      {t('common.assistantSurface.regionalApproval.liveAction.adjustments.adjustQty')}
                    </span>
                  </div>
                  {adjustmentSkus.data.map((sku) => {
                    const value = adjustmentValues[sku.skuCode] ?? '';
                    const invalidValue = value.trim().length > 0 && !SIGNED_DECIMAL_PATTERN.test(value.trim());
                    const inputLabel = t('common.assistantSurface.regionalApproval.liveAction.adjustments.inputLabel', {
                      sku: sku.skuCode,
                    });
                    return (
                      <div className={styles.adjustmentTableRow} role='row' key={sku.id}>
                        <span role='cell'>
                          <strong>{sku.skuCode}</strong>
                          <small>{sku.productCategName}</small>
                        </span>
                        <span role='cell'>{formatExactDecimal(confirmedQuantityForStatus(sku, row.status))}</span>
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
                              setAdjustmentValues((current) => ({ ...current, [sku.skuCode]: nextValue }))
                            }
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
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
              content={t('common.assistantSurface.regionalApproval.liveAction.adjustments.rejectBoundary')}
            />
          )}
          <Checkbox
            checked={confirmed}
            disabled={loading || action.state.status === 'success'}
            aria-label={t('common.assistantSurface.regionalApproval.liveAction.confirmation')}
            onChange={setConfirmed}
          >
            {t('common.assistantSurface.regionalApproval.liveAction.confirmation')}
          </Checkbox>
          {attempted && invalid ? (
            <Alert type='error' showIcon content={t('common.assistantSurface.regionalApproval.liveAction.required')} />
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
  );
};

export default RegionalApprovalLiveActionDialog;
