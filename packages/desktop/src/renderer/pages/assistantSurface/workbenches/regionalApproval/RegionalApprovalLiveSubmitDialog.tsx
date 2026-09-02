import type { GeaSalesPlanPeriod, GeaSalesPlanSubmitReceipt } from '@/common/adapter/ipcBridge';
import { Alert, Button, Checkbox, Modal, Spin, Tag } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import React, { useState } from 'react';
import { useSalesPlanSubmit } from './hooks/useSalesPlanSubmit';
import type { SalesPlanSubmitClient, SalesPlanSubmitErrorKind } from './models/salesPlanSubmitModel';
import { formatExactDecimal, type RegionalApprovalLiveRow } from './regionalApprovalQueryModel';
import styles from './RegionalApprovalActionDialog.module.css';

const errorKey = (kind: SalesPlanSubmitErrorKind) =>
  `common.assistantSurface.regionalApproval.liveSubmit.errors.${kind}` as const;

const RegionalApprovalLiveSubmitDialog: React.FC<{
  visible: boolean;
  row: RegionalApprovalLiveRow;
  period: GeaSalesPlanPeriod;
  t: TFunction;
  client?: SalesPlanSubmitClient;
  onSucceeded: (receipt: GeaSalesPlanSubmitReceipt) => void | Promise<void>;
  onRefresh: () => void;
  onClose: () => void;
}> = ({ visible, row, period, t, client, onSucceeded, onRefresh, onClose }) => {
  const [confirmed, setConfirmed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const submit = useSalesPlanSubmit({
    client,
    period,
    planId: row.planId,
    versionId: row.versionId,
    channelCode: row.channelCode,
  });
  const loading = submit.state.status === 'loading';
  const resultUnknown =
    submit.state.status === 'error' && submit.state.error.kind === 'unavailable' && submit.state.error.retrySameIntent;
  const needsAuthoritativeRefresh =
    submit.state.status === 'error' &&
    ['conflict', 'rateLimited', 'serviceUnavailable', 'retryExhausted'].includes(submit.state.error.kind);
  const canClose = !loading && !resultUnknown;
  const ready = submit.sourceState.status === 'success';

  const complete = async (promise: Promise<GeaSalesPlanSubmitReceipt>) => {
    try {
      const receipt = await promise;
      try {
        await onSucceeded(receipt);
      } catch {
        setRefreshFailed(true);
      }
    } catch {
      // State-specific recovery is rendered below.
    }
  };

  const execute = () => {
    setAttempted(true);
    if (!confirmed || !ready || loading || submit.state.status === 'success') return;
    void complete(submit.execute());
  };

  const retry = () => {
    if (loading || submit.state.status !== 'error' || !submit.state.error.retrySameIntent) return;
    void complete(submit.retry());
  };

  return (
    <Modal
      visible={visible}
      className={styles.modal}
      title={t('common.assistantSurface.regionalApproval.liveSubmit.title')}
      maskClosable={false}
      closable={canClose}
      focusLock
      onCancel={() => canClose && onClose()}
      footer={
        <div className={styles.footer}>
          <span>{t('common.assistantSurface.regionalApproval.liveSubmit.footerBoundary')}</span>
          <div>
            <Button disabled={!canClose} onClick={onClose}>
              {t('common.assistantSurface.regionalApproval.liveSubmit.close')}
            </Button>
            {submit.state.status === 'error' && submit.state.error.retrySameIntent ? (
              <Button type='primary' disabled={loading} onClick={retry}>
                {t('common.assistantSurface.regionalApproval.liveSubmit.retry')}
              </Button>
            ) : needsAuthoritativeRefresh ? (
              <Button
                type='primary'
                onClick={() => {
                  onRefresh();
                  onClose();
                }}
              >
                {t('common.assistantSurface.regionalApproval.liveSubmit.refresh')}
              </Button>
            ) : (
              <Button
                type='primary'
                disabled={!ready || loading || submit.state.status === 'success'}
                onClick={execute}
              >
                {t(
                  submit.state.status === 'success'
                    ? 'common.assistantSurface.regionalApproval.liveSubmit.completed'
                    : 'common.assistantSurface.regionalApproval.liveSubmit.confirm'
                )}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className={styles.body} data-testid='regional-approval-live-submit-dialog'>
        <Alert type='info' showIcon content={t('common.assistantSurface.regionalApproval.liveSubmit.boundary')} />
        <div className={styles.scopeSummary}>
          <span>
            <small>{t('common.assistantSurface.regionalApproval.liveSubmit.plan')}</small>
            <strong>{row.planId}</strong>
          </span>
          <span>
            <small>{t('common.assistantSurface.regionalApproval.liveSubmit.version')}</small>
            <strong>{row.versionId}</strong>
          </span>
          <span>
            <small>{t('common.assistantSurface.regionalApproval.liveSubmit.period')}</small>
            <strong>{period.periodMonth}</strong>
          </span>
          <Tag color='purple'>{t('common.assistantSurface.regionalApproval.liveSubmit.serviceTag')}</Tag>
        </div>

        {submit.sourceState.status === 'loading' ? (
          <div className={styles.loadingState}>
            <Spin size={20} />
            <span>{t('common.assistantSurface.regionalApproval.liveSubmit.loadingSource')}</span>
          </div>
        ) : null}
        {submit.sourceState.status === 'error' ? (
          <>
            <Alert type='error' showIcon content={t(errorKey(submit.sourceState.error.kind))} />
            <Button onClick={submit.retrySource}>{t('common.assistantSurface.regionalApproval.query.retry')}</Button>
          </>
        ) : null}
        {submit.sourceState.status === 'success' ? (
          <div className={styles.adjustmentSummary}>
            <strong>{t('common.assistantSurface.regionalApproval.liveSubmit.sourceReady')}</strong>
            <span>
              {t('common.assistantSurface.regionalApproval.liveSubmit.sourceSummary', {
                count: submit.sourceState.input.sourceSummary.skuCount,
                quantity: formatExactDecimal(submit.sourceState.input.sourceSummary.submittedQty),
                amount: formatExactDecimal(submit.sourceState.input.sourceSummary.submittedAmount),
              })}
            </span>
            <span>
              {t('common.assistantSurface.regionalApproval.liveSubmit.targetSummary', {
                quantity: formatExactDecimal(submit.sourceState.input.request.targetQty),
                amount: formatExactDecimal(submit.sourceState.input.request.targetAmount),
              })}
            </span>
            <span>
              {t('common.assistantSurface.regionalApproval.liveSubmit.submitter', {
                code: submit.sourceState.input.request.submitterCode,
                name: submit.sourceState.input.request.submitterName ?? '—',
              })}
            </span>
          </div>
        ) : null}

        <Checkbox
          checked={confirmed}
          disabled={!ready || loading || submit.state.status === 'success'}
          aria-label={t('common.assistantSurface.regionalApproval.liveSubmit.confirmation')}
          onChange={setConfirmed}
        >
          {t('common.assistantSurface.regionalApproval.liveSubmit.confirmation')}
        </Checkbox>
        {attempted && !confirmed ? (
          <Alert type='error' showIcon content={t('common.assistantSurface.regionalApproval.liveSubmit.required')} />
        ) : null}
        {loading ? (
          <div className={styles.loadingState}>
            <Spin size={20} />
            <span>{t('common.assistantSurface.regionalApproval.liveSubmit.loading')}</span>
          </div>
        ) : null}
        {submit.state.status === 'error' ? (
          <Alert type='error' showIcon content={t(errorKey(submit.state.error.kind))} />
        ) : null}
        {submit.state.status === 'success' ? (
          <Alert
            type='success'
            showIcon
            content={t('common.assistantSurface.regionalApproval.liveSubmit.success', {
              planId: submit.state.receipt.planId,
              versionId: submit.state.receipt.versionId,
              requestId: submit.state.receipt.requestId,
              auditId: submit.state.receipt.auditId,
              replayed: submit.state.receipt.replayed
                ? t('common.assistantSurface.regionalApproval.liveSubmit.replayed')
                : t('common.assistantSurface.regionalApproval.liveSubmit.created'),
            })}
          />
        ) : null}
        {refreshFailed ? (
          <Alert
            type='warning'
            showIcon
            content={t('common.assistantSurface.regionalApproval.liveSubmit.refreshFailed')}
          />
        ) : null}
      </div>
    </Modal>
  );
};

export default RegionalApprovalLiveSubmitDialog;
