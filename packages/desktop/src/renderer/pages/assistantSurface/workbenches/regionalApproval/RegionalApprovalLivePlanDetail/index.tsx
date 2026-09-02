import type {
  GeaSalesPlanApprovalLog,
  GeaSalesPlanSku,
  GeaSalesPlanSkuDiff,
  GeaSalesPlanVersion,
} from '@/common/adapter/ipcBridge';
import { Alert, Button, Empty, Modal, Select, Spin, Table, Tabs, Tag } from '@arco-design/web-react';
import type { TableColumnProps } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import React from 'react';
import { formatExactDecimal, type RegionalApprovalLiveRow } from '../regionalApprovalQueryModel';
import {
  useSalesPlanDetail,
  type SalesPlanDetailClient,
  type SalesPlanDetailError,
  type SalesPlanDetailState,
} from '../hooks/useSalesPlanDetail';
import styles from './RegionalApprovalLivePlanDetail.module.css';

const errorKey = (error: SalesPlanDetailError) =>
  `common.assistantSurface.regionalApproval.liveDetail.errors.${error}` as const;

const StateBoundary = <T,>({
  state,
  t,
  retry,
  children,
}: {
  state: SalesPlanDetailState<T>;
  t: TFunction;
  retry: () => void;
  children: (data: T) => React.ReactNode;
}) => {
  if (state.status === 'loading') {
    return (
      <div className={styles.state}>
        <Spin />
        <span>{t('common.assistantSurface.regionalApproval.liveDetail.loading')}</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className={styles.state}>
        <Alert type='error' showIcon content={t(errorKey(state.error))} />
        <Button onClick={retry}>{t('common.assistantSurface.regionalApproval.query.retry')}</Button>
      </div>
    );
  }
  if (state.status === 'success') return <>{children(state.data)}</>;
  return <Empty description={t('common.assistantSurface.regionalApproval.liveDetail.notReady')} />;
};

const RegionalApprovalLivePlanDetail: React.FC<{
  visible: boolean;
  rows: readonly RegionalApprovalLiveRow[];
  row: RegionalApprovalLiveRow;
  t: TFunction;
  client?: SalesPlanDetailClient;
  onClose: () => void;
  onRowChange: (planId: string) => void;
}> = ({ visible, rows, row, t, client, onClose, onRowChange }) => {
  const detail = useSalesPlanDetail({ client, planId: row.planId, initialVersionId: row.versionId });
  const selectFromVersion = (nextVersionId: string) => {
    if (nextVersionId === detail.toVersionId) detail.selectToVersion(detail.fromVersionId);
    detail.selectFromVersion(nextVersionId);
  };
  const selectToVersion = (nextVersionId: string) => {
    if (nextVersionId === detail.fromVersionId) detail.selectFromVersion(detail.toVersionId);
    detail.selectToVersion(nextVersionId);
  };
  const versionLabel = (version: GeaSalesPlanVersion) =>
    t('common.assistantSurface.regionalApproval.liveDetail.versionOption', {
      seq: version.seq,
      id: version.id,
    });
  const skuColumns: TableColumnProps<GeaSalesPlanSku>[] = [
    { title: t('common.assistantSurface.regionalApproval.liveDetail.columns.sku'), dataIndex: 'skuCode', width: 150 },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.category'),
      dataIndex: 'productCategName',
      width: 160,
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.baseQty'),
      width: 120,
      render: (_, sku) => formatExactDecimal(sku.baseQty),
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.qty'),
      width: 120,
      render: (_, sku) => formatExactDecimal(sku.qty),
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.price'),
      width: 120,
      render: (_, sku) => `¥${formatExactDecimal(sku.price)}`,
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.amount'),
      width: 150,
      render: (_, sku) => `¥${formatExactDecimal(sku.amt)}`,
    },
  ];
  const versionColumns: TableColumnProps<GeaSalesPlanVersion>[] = [
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.version'),
      width: 220,
      render: (_, version) => (
        <span className={styles.stack}>
          <strong>{versionLabel(version)}</strong>
          <small>{version.id}</small>
        </span>
      ),
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.status'),
      width: 130,
      render: (_, version) => (
        <Tag color={version.effective ? 'green' : 'gray'}>
          {t(`common.assistantSurface.regionalApproval.query.status.${version.status}`)}
        </Tag>
      ),
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.target'),
      width: 210,
      render: (_, version) => `${formatExactDecimal(version.targetQty)} · ¥${formatExactDecimal(version.targetAmount)}`,
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.submitter'),
      width: 180,
      render: (_, version) => `${version.submitter ?? '—'} · ${version.submitTime ?? '—'}`,
    },
  ];
  const logColumns: TableColumnProps<GeaSalesPlanApprovalLog>[] = [
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.action'),
      dataIndex: 'actionCode',
      width: 130,
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.version'),
      dataIndex: 'versionId',
      width: 190,
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.transition'),
      width: 140,
      render: (_, log) => `${log.fromStatus ?? '—'} → ${log.toStatus}`,
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.operator'),
      width: 180,
      render: (_, log) => log.operatorName ?? log.operatorCode,
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.time'),
      dataIndex: 'actionAt',
      width: 180,
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.remark'),
      width: 220,
      render: (_, log) => log.remark ?? '—',
    },
  ];
  const compareColumns: TableColumnProps<GeaSalesPlanSkuDiff>[] = [
    { title: t('common.assistantSurface.regionalApproval.liveDetail.columns.sku'), dataIndex: 'skuCode', width: 150 },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.change'),
      width: 120,
      render: (_, difference) =>
        t(`common.assistantSurface.regionalApproval.liveDetail.change.${difference.changeType}`),
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.qtyComparison'),
      width: 240,
      render: (_, difference) =>
        `${formatExactDecimal(difference.before?.qty ?? '0')} → ${formatExactDecimal(difference.after?.qty ?? '0')} (${formatExactDecimal(difference.qtyDelta)})`,
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.priceComparison'),
      width: 220,
      render: (_, difference) =>
        `¥${formatExactDecimal(difference.before?.price ?? '0')} → ¥${formatExactDecimal(difference.after?.price ?? '0')}`,
    },
    {
      title: t('common.assistantSurface.regionalApproval.liveDetail.columns.amountDelta'),
      width: 150,
      render: (_, difference) => `¥${formatExactDecimal(difference.amountDelta)}`,
    },
  ];

  return (
    <Modal
      visible={visible}
      className={styles.modal}
      title={t('common.assistantSurface.regionalApproval.liveDetail.title')}
      maskClosable={false}
      autoFocus={false}
      focusLock
      onCancel={onClose}
      footer={
        <Button type='primary' onClick={onClose}>
          {t('common.assistantSurface.regionalApproval.detail.close')}
        </Button>
      }
    >
      <div className={styles.body} data-testid='regional-approval-live-plan-detail'>
        <div className={styles.scopeControls}>
          <div className={styles.field}>
            <span>{t('common.assistantSurface.regionalApproval.liveDetail.plan')}</span>
            <Select
              value={row.planId}
              aria-label={t('common.assistantSurface.regionalApproval.liveDetail.plan')}
              onChange={(planId) => onRowChange(String(planId))}
            >
              {rows.map((candidate) => (
                <Select.Option key={candidate.planId} value={candidate.planId}>
                  {candidate.baseName ?? candidate.orgCode ?? candidate.dealerCode} · {candidate.planId}
                </Select.Option>
              ))}
            </Select>
          </div>
          {detail.overviewState.status === 'success' ? (
            <div className={styles.field}>
              <span>{t('common.assistantSurface.regionalApproval.liveDetail.skuVersion')}</span>
              <Select
                value={detail.selectedVersionId}
                aria-label={t('common.assistantSurface.regionalApproval.liveDetail.skuVersion')}
                onChange={(versionId) => detail.selectVersion(String(versionId))}
              >
                {detail.overviewState.data.versions.map((version) => (
                  <Select.Option key={version.id} value={version.id}>
                    {versionLabel(version)}
                  </Select.Option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className={styles.receipt}>
            <span>{t('common.assistantSurface.regionalApproval.liveDetail.receipt')}</span>
            <strong>{row.planId}</strong>
            <small>{row.versionId}</small>
          </div>
        </div>

        <StateBoundary state={detail.overviewState} t={t} retry={detail.retryOverview}>
          {(overview) => (
            <>
              <div className={styles.summary}>
                <span>
                  <small>{t('common.assistantSurface.regionalApproval.liveDetail.currentVersion')}</small>
                  <strong>{versionLabel(overview.detail.currentVersion)}</strong>
                </span>
                <span>
                  <small>{t('common.assistantSurface.regionalApproval.liveDetail.planId')}</small>
                  <strong>{overview.detail.currentVersion.planId}</strong>
                </span>
                <span>
                  <small>{t('common.assistantSurface.regionalApproval.liveDetail.versionCount')}</small>
                  <strong>{overview.versions.length}</strong>
                </span>
                <span>
                  <small>{t('common.assistantSurface.regionalApproval.liveDetail.logCount')}</small>
                  <strong>{overview.logs.length}</strong>
                </span>
              </div>
              <Tabs type='line' defaultActiveTab='skus' destroyOnHide={false}>
                <Tabs.TabPane key='skus' title={t('common.assistantSurface.regionalApproval.liveDetail.tabs.skus')}>
                  <StateBoundary state={detail.skuState} t={t} retry={detail.retrySkus}>
                    {(skus) => (
                      <Table
                        rowKey='id'
                        columns={skuColumns}
                        data={skus}
                        pagination={false}
                        scroll={{ x: 820 }}
                        noDataElement={
                          <Empty description={t('common.assistantSurface.regionalApproval.liveDetail.emptySkus')} />
                        }
                      />
                    )}
                  </StateBoundary>
                </Tabs.TabPane>
                <Tabs.TabPane
                  key='versions'
                  title={t('common.assistantSurface.regionalApproval.liveDetail.tabs.versions')}
                >
                  <Table
                    rowKey='id'
                    columns={versionColumns}
                    data={overview.versions}
                    pagination={false}
                    scroll={{ x: 760 }}
                  />
                </Tabs.TabPane>
                <Tabs.TabPane key='logs' title={t('common.assistantSurface.regionalApproval.liveDetail.tabs.logs')}>
                  <Table
                    rowKey='id'
                    columns={logColumns}
                    data={overview.logs}
                    pagination={false}
                    scroll={{ x: 1040 }}
                    noDataElement={
                      <Empty description={t('common.assistantSurface.regionalApproval.liveDetail.emptyLogs')} />
                    }
                  />
                </Tabs.TabPane>
                <Tabs.TabPane
                  key='compare'
                  title={t('common.assistantSurface.regionalApproval.liveDetail.tabs.compare')}
                >
                  <div className={styles.compareControls}>
                    <div className={styles.field}>
                      <span>{t('common.assistantSurface.regionalApproval.liveDetail.compareFrom')}</span>
                      <Select
                        value={detail.fromVersionId}
                        aria-label={t('common.assistantSurface.regionalApproval.liveDetail.compareFrom')}
                        onChange={(versionId) => selectFromVersion(String(versionId))}
                      >
                        {overview.versions.map((version) => (
                          <Select.Option key={version.id} value={version.id}>
                            {versionLabel(version)}
                          </Select.Option>
                        ))}
                      </Select>
                    </div>
                    <div className={styles.field}>
                      <span>{t('common.assistantSurface.regionalApproval.liveDetail.compareTo')}</span>
                      <Select
                        value={detail.toVersionId}
                        aria-label={t('common.assistantSurface.regionalApproval.liveDetail.compareTo')}
                        onChange={(versionId) => selectToVersion(String(versionId))}
                      >
                        {overview.versions.map((version) => (
                          <Select.Option key={version.id} value={version.id}>
                            {versionLabel(version)}
                          </Select.Option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <StateBoundary state={detail.compareState} t={t} retry={detail.retryCompare}>
                    {(differences) => (
                      <Table
                        rowKey='skuCode'
                        columns={compareColumns}
                        data={differences}
                        pagination={false}
                        scroll={{ x: 880 }}
                        noDataElement={
                          <Empty description={t('common.assistantSurface.regionalApproval.liveDetail.emptyCompare')} />
                        }
                      />
                    )}
                  </StateBoundary>
                </Tabs.TabPane>
              </Tabs>
            </>
          )}
        </StateBoundary>
      </div>
    </Modal>
  );
};

export default RegionalApprovalLivePlanDetail;
