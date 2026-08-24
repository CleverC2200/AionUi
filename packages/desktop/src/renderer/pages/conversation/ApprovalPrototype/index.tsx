import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type {
  ApprovalActionReceipt,
  ApprovalContact,
  ApprovalFormField,
  ApprovalInstance,
  ApprovalListTopic,
  ApprovalTask,
} from '@/common/types/approval';
import {
  Alert,
  Avatar,
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Spin,
  Tabs,
  Tag,
  Typography,
} from '@arco-design/web-react';
import { Audit, CheckOne, CloseOne, MessageOne, RobotOne, Time, Transfer } from '@icon-park/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import {
  getApprovalActionIdempotencyKey,
  getApprovalVerificationReceipt,
  rememberApprovalActionReceipt,
} from '@/renderer/services/approvalActionAttempts';
import { openExternalUrl } from '@/renderer/utils/platform';
import styles from './ApprovalPrototype.module.css';

type FeishuApprovalInboxProps = {
  pendingItems: ApprovalTask[];
  doneItems: ApprovalTask[];
  loading: boolean;
  error?: unknown;
  onRefresh: () => Promise<unknown>;
  onStartHandling: (item: ApprovalTask, opinion: string) => void;
};

const statusColor = (topic: ApprovalListTopic): 'green' | 'orange' => (topic === 'done' ? 'green' : 'orange');

const cardSummaryText = (item: ApprovalTask): string => {
  const summaries = item.summaries.filter(
    (summary) => summary.key.trim() && summary.value.trim() && !summary.key.includes('创建日期')
  );
  return (summaries.find((summary) => summary.key.includes('事项说明')) ?? summaries[0])?.value ?? '';
};

const cardCreatedAt = (item: ApprovalTask): string | undefined =>
  item.summaries.find((summary) => summary.key.includes('创建日期') && summary.value.trim())?.value;

const formatTimestamp = (value?: string): string => {
  if (!value || value === '0') return '—';
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const displayValue = (field: ApprovalFormField): string => {
  if (field.value == null || field.value === '') return '—';
  if (typeof field.value === 'string' || typeof field.value === 'number' || typeof field.value === 'boolean') {
    return String(field.value);
  }
  if (Array.isArray(field.value)) {
    return field.value
      .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
      .filter(Boolean)
      .join('、');
  }
  return JSON.stringify(field.value);
};

const safeAttachmentUrls = (field: ApprovalFormField): string[] | undefined => {
  if (!field.fieldType.toLowerCase().includes('attachment') || !Array.isArray(field.value)) return undefined;
  return field.value.filter((value): value is string => {
    if (typeof value !== 'string') return false;
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  });
};

const isApproverFormField = (field: ApprovalFormField): boolean => {
  const fieldType = field.fieldType.toLowerCase();
  return fieldType.includes('contact') || /^审批人\s*\d*$/u.test(field.name.trim());
};

const safeFeishuApprovalUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const trustedHost = ['feishu.cn', 'larksuite.com'].some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
    );
    return url.protocol === 'https:' && trustedHost ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const ApprovalFormValue: React.FC<{ field: ApprovalFormField }> = ({ field }) => {
  const { t } = useTranslation();
  const attachments = safeAttachmentUrls(field);
  if (!attachments) return <strong>{displayValue(field)}</strong>;
  if (!attachments.length) return <strong>{t('conversation.attention.approval.form.attachmentUnavailable')}</strong>;
  return (
    <strong>
      {attachments.map((url, index) => (
        <Button
          key={url}
          type='text'
          size='mini'
          onClick={() => void openExternalUrl(url)}
          data-testid={`approval-attachment-${index + 1}`}
        >
          {t('conversation.attention.approval.form.attachment', { index: index + 1 })}
        </Button>
      ))}
    </strong>
  );
};

const ApprovalListCard: React.FC<{
  item: ApprovalTask;
  topic: ApprovalListTopic;
  selected: boolean;
  onSelect: () => void;
}> = ({ item, topic, selected, onSelect }) => {
  const { t } = useTranslation();
  const initiator = item.initiatorName || item.initiatorId || t('conversation.attention.approval.detail.unknownUser');
  const summary = cardSummaryText(item);
  const createdAt = cardCreatedAt(item);
  return (
    <Button
      type='text'
      long
      className={`${styles.listCard} ${selected ? styles.listCardSelected : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={t('conversation.attention.approval.card.openReal', { title: item.title })}
      data-testid={`approval-card-${item.taskId}`}
    >
      <span className={styles.listCardContent}>
        <span className={styles.cardTopline}>
          <Tag size='small' icon={<Audit theme='outline' size='12' />}>
            {item.definitionName}
          </Tag>
          <Tag size='small' color={statusColor(topic)}>
            {t(`conversation.attention.approval.status.${topic}`)}
          </Tag>
        </span>
        <Typography.Text className={styles.cardTitle}>{item.title}</Typography.Text>
        <span className={styles.cardMeta}>{initiator}</span>
        {summary ? (
          <span className={styles.cardSummary} data-testid='approval-card-summary'>
            <RobotOne className={styles.cardSummaryIcon} theme='outline' size='15' />
            <span className={styles.cardSummaryText} title={summary}>
              {summary}
            </span>
          </span>
        ) : null}
        {createdAt ? <span className={styles.cardFooter}>{createdAt}</span> : null}
      </span>
    </Button>
  );
};

const ReceiptFeedback: React.FC<{ receipt?: ApprovalActionReceipt }> = ({ receipt }) => {
  const { t } = useTranslation();
  if (!receipt) return null;
  return (
    <Alert
      showIcon
      type={receipt.status === 'succeeded' ? 'success' : 'warning'}
      content={t(`conversation.attention.approval.actions.receipt.${receipt.status}`)}
      data-testid='approval-action-receipt'
    />
  );
};

const ApprovalDetail: React.FC<{
  item: ApprovalTask;
  topic: ApprovalListTopic;
  opinion: string;
  onOpinionChange: (value: string) => void;
  onStartHandling: () => void;
  onRefresh: () => Promise<unknown>;
}> = ({ item, topic, opinion, onOpinionChange, onStartHandling, onRefresh }) => {
  const { t } = useTranslation();
  const [action, setAction] = useState<'approve' | 'reject' | 'transfer'>();
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ApprovalActionReceipt | undefined>(() =>
    getApprovalVerificationReceipt(item.instanceCode, item.taskId)
  );
  const [actionError, setActionError] = useState('');
  const [contactQuery, setContactQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState<ApprovalContact>();
  const detailContentRef = useRef<HTMLDivElement>(null);
  const feishuApprovalUrl = safeFeishuApprovalUrl(item.link);
  const {
    data: detail,
    error,
    isLoading,
    mutate,
  } = useSWR<ApprovalInstance>(item.instanceCode ? `approval-instance:${item.instanceCode}` : null, () =>
    ipcBridge.feishuApproval.get.invoke({ instanceCode: item.instanceCode })
  );
  const { data: contacts, isLoading: contactsLoading } = useSWR(
    action === 'transfer' && contactQuery.trim().length >= 2 ? `approval-contacts:${contactQuery.trim()}` : null,
    () => ipcBridge.feishuApproval.searchContacts.invoke({ query: contactQuery.trim() })
  );

  useEffect(() => {
    setAction(undefined);
    setReceipt(getApprovalVerificationReceipt(item.instanceCode, item.taskId));
    setActionError('');
    setContactQuery('');
    setSelectedContact(undefined);
  }, [item.instanceCode, item.taskId]);

  useEffect(() => {
    if (detail) detailContentRef.current?.scrollTo?.({ top: 0 });
  }, [detail, item.taskId, topic]);

  const confirmAction = async (): Promise<void> => {
    if (!action || submitting) return;
    if (action === 'transfer' && !selectedContact) return;
    setSubmitting(true);
    const idempotencyKey = getApprovalActionIdempotencyKey(action, item.instanceCode, item.taskId);
    setActionError('');
    try {
      const actionRequest = {
        instanceCode: item.instanceCode,
        taskId: item.taskId,
        comment: opinion.trim() || undefined,
        idempotencyKey,
      };
      const result =
        action === 'approve'
          ? await ipcBridge.feishuApproval.approve.invoke(actionRequest)
          : action === 'reject'
            ? await ipcBridge.feishuApproval.reject.invoke(actionRequest)
            : await ipcBridge.feishuApproval.transfer.invoke({
                ...actionRequest,
                transferUserId: selectedContact!.openId,
              });
      setReceipt(result);
      rememberApprovalActionReceipt(result);
      setAction(undefined);
      if (result.status === 'succeeded') {
        await Promise.all([onRefresh(), mutate()]);
      }
    } catch (writeError) {
      if (isBackendHttpError(writeError) && writeError.status === 409) {
        await Promise.allSettled([onRefresh(), mutate()]);
      }
      setActionError(
        isBackendHttpError(writeError) && writeError.backendMessage
          ? writeError.backendMessage
          : t('conversation.attention.approval.actions.actionFailed')
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className='py-48px flex-center'>
        <Spin aria-label={t('common.loading')} />
      </div>
    );
  }
  if (error || !detail) {
    return (
      <Alert
        type='error'
        showIcon
        content={
          <div className='flex items-center justify-between gap-8px'>
            <span>{t('conversation.attention.approval.detail.loadFailed')}</span>
            <div className='flex items-center gap-8px'>
              <Button size='mini' onClick={() => void mutate()}>
                {t('common.retry')}
              </Button>
              {!item.supportApiOperate && feishuApprovalUrl ? (
                <Button size='mini' onClick={() => void openExternalUrl(feishuApprovalUrl)}>
                  {t('conversation.attention.approval.actions.openInFeishu')}
                </Button>
              ) : null}
            </div>
          </div>
        }
      />
    );
  }

  const attachmentCount = detail.form.reduce((count, field) => {
    if (!field.fieldType.toLowerCase().includes('attachment') || !Array.isArray(field.value)) return count;
    return count + field.value.length;
  }, 0);
  const formFields = detail.form.filter((field) => !isApproverFormField(field));
  const approverFields = detail.form.filter(isApproverFormField);
  const formSection = (
    <section className={styles.section}>
      <Typography.Title heading={6} className={styles.sectionTitle}>
        {t('conversation.attention.approval.form.title')}
      </Typography.Title>
      <div className={styles.metricGrid}>
        {formFields.map((field) => (
          <div key={field.id} className={`${styles.formField} ${styles.formFieldFull}`} data-form-span='full'>
            <span>{field.name}</span>
            <ApprovalFormValue field={field} />
          </div>
        ))}
        {approverFields.length ? (
          <div className={styles.formApproverGrid} data-testid='approval-form-approvers'>
            {approverFields.map((field) => (
              <div key={field.id} className={`${styles.formField} ${styles.formApproverField}`} data-form-span='single'>
                <span>{field.name}</span>
                <ApprovalFormValue field={field} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );

  return (
    <div className={styles.detail} data-testid={`approval-detail-${item.taskId}`}>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <div>
            <Typography.Title heading={5} className={styles.detailTitle}>
              {detail.definitionName}
            </Typography.Title>
            <div className={styles.detailIdentity}>
              <Avatar size={30} className={`${styles.avatar} ${styles.purple}`}>
                {(item.initiatorName || '?').slice(0, 1)}
              </Avatar>
              <span>{item.initiatorName || detail.initiatorId}</span>
            </div>
          </div>
          <Tag color={statusColor(topic)}>{t(`conversation.attention.approval.status.${topic}`)}</Tag>
        </div>
        <div className={styles.detailMeta}>
          <span>{t('conversation.attention.approval.detail.number', { id: detail.serialNumber })}</span>
          <span>
            {t('conversation.attention.approval.detail.createdAt', { time: formatTimestamp(detail.startTime) })}
          </span>
        </div>
      </header>

      <div ref={detailContentRef} className={styles.detailContent}>
        <ReceiptFeedback receipt={receipt} />
        {actionError ? <Alert showIcon type='error' content={actionError} /> : null}
        {topic === 'done' ? (
          <section className={styles.section}>
            <Typography.Title heading={6} className={styles.sectionTitle}>
              {t('conversation.attention.approval.result.title')}
            </Typography.Title>
            <div className={styles.resultGrid}>
              <div>
                <span>{t('conversation.attention.approval.result.status')}</span>
                <strong className={styles.resultSuccess}>{t('conversation.attention.approval.status.done')}</strong>
              </div>
              <div>
                <span>{t('conversation.attention.approval.result.tasks')}</span>
                <strong>{t('conversation.attention.approval.result.items', { count: detail.tasks.length })}</strong>
              </div>
              <div>
                <span>{t('conversation.attention.approval.result.records')}</span>
                <strong>
                  {t('conversation.attention.approval.result.items', { count: detail.operations.length })}
                </strong>
              </div>
              <div>
                <span>{t('conversation.attention.approval.result.attachments')}</span>
                <strong>{t('conversation.attention.approval.result.files', { count: attachmentCount })}</strong>
              </div>
            </div>
          </section>
        ) : (
          formSection
        )}

        <section className={styles.section}>
          <Typography.Title heading={6} className={styles.sectionTitle}>
            {t('conversation.attention.approval.flow.title')}
          </Typography.Title>
          <div className={styles.flow}>
            {detail.operations.map((record, index) => {
              const actor = record.userName || record.userId || '—';
              return (
                <div className={styles.flowStage} key={`${record.createTime}:${record.operationType}:${index}`}>
                  <div className={styles.flowRail} aria-hidden='true'>
                    {record.operationType === 'PASS' ? (
                      <CheckOne theme='filled' size='18' />
                    ) : (
                      <Time theme='outline' size='18' />
                    )}
                  </div>
                  <div className={styles.flowBody}>
                    <div className={styles.flowHeading}>
                      <Typography.Text className={styles.flowTitle}>
                        {t(`conversation.attention.approval.operation.${record.operationType}`, {
                          defaultValue: record.operationType,
                        })}
                      </Typography.Text>
                      <Typography.Text className={styles.flowTime}>
                        {formatTimestamp(record.createTime)}
                      </Typography.Text>
                    </div>
                    <div className={styles.flowOwner}>
                      <Avatar size={28} className={`${styles.avatar} ${styles.purple}`}>
                        {Array.from(actor)[0] || '—'}
                      </Avatar>
                      <span className={styles.ownerName}>{actor}</span>
                    </div>
                    {record.comment ? (
                      <div className={styles.opinion}>
                        <span>{t('conversation.attention.approval.flow.manualOpinion')}</span>
                        <p>{record.comment}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {detail.currentNodes.map((node, index) => (
              <div className={`${styles.flowStage} ${styles.flowStageCurrent}`} key={node.nodeId || index}>
                <div className={styles.flowRail} aria-hidden='true'>
                  <Time theme='filled' size='18' />
                </div>
                <div className={styles.flowBody}>
                  <div className={styles.flowHeading}>
                    <Typography.Text className={styles.flowTitle}>
                      {node.nodeName || t('conversation.attention.approval.flow.currentNode')}
                    </Typography.Text>
                    <Tag size='small' color='arcoblue'>
                      {t('conversation.attention.approval.status.waiting')}
                    </Tag>
                  </div>
                  <div className={styles.currentHint}>{t('conversation.attention.approval.flow.currentHint')}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {detail.comments.length ? (
          <section className={styles.section}>
            <Typography.Title heading={6} className={styles.sectionTitle}>
              {t('conversation.attention.approval.comments.title')}
            </Typography.Title>
            <div className={styles.flow}>
              {detail.comments.map((comment) => (
                <div className={styles.flowBody} key={comment.id}>
                  <div className={styles.flowHeading}>
                    <Typography.Text className={styles.flowTitle}>{comment.userName || comment.userId}</Typography.Text>
                    <Typography.Text className={styles.flowTime}>{formatTimestamp(comment.createTime)}</Typography.Text>
                  </div>
                  <Typography.Paragraph>{comment.comment}</Typography.Paragraph>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {topic === 'done' ? formSection : null}
      </div>

      {topic === 'pending' ? (
        <div className={styles.opinionComposer}>
          <label className={styles.opinionLabel} htmlFor={`approval-opinion-${item.taskId}`}>
            {t('conversation.attention.approval.actions.opinionLabel')}
          </label>
          <Input.TextArea
            id={`approval-opinion-${item.taskId}`}
            value={opinion}
            onChange={onOpinionChange}
            autoSize={{ minRows: 4, maxRows: 7 }}
            maxLength={500}
            placeholder={t('conversation.attention.approval.actions.opinionPlaceholderReal')}
            data-testid='approval-opinion-input'
          />
        </div>
      ) : null}

      <footer className={`${styles.actionBar} ${topic === 'pending' ? styles.actionBarPending : ''}`}>
        {topic === 'done' ? (
          <div className={styles.doneHint}>
            <CheckOne theme='filled' size='18' />
            {t('conversation.attention.approval.actions.completedReal')}
          </div>
        ) : (
          <div className={styles.actionGroup}>
            <Button
              status='danger'
              icon={<CloseOne theme='outline' />}
              disabled={!item.supportApiOperate || receipt?.status === 'unknown_external_write'}
              onClick={() => setAction('reject')}
            >
              {t('conversation.attention.approval.actions.reject')}
            </Button>
            <Button
              icon={<Transfer theme='outline' />}
              disabled={!item.supportApiOperate || receipt?.status === 'unknown_external_write'}
              onClick={() => setAction('transfer')}
            >
              {t('conversation.attention.approval.actions.transfer')}
            </Button>
            <Button icon={<MessageOne theme='outline' />} onClick={onStartHandling}>
              {t('conversation.attention.approval.actions.handle')}
            </Button>
            <Button
              type='primary'
              icon={<CheckOne theme='outline' />}
              disabled={!item.supportApiOperate || receipt?.status === 'unknown_external_write'}
              onClick={() => setAction('approve')}
            >
              {t('conversation.attention.approval.actions.approve')}
            </Button>
            {!item.supportApiOperate && feishuApprovalUrl ? (
              <Button onClick={() => void openExternalUrl(feishuApprovalUrl)}>
                {t('conversation.attention.approval.actions.openInFeishu')}
              </Button>
            ) : null}
          </div>
        )}
      </footer>

      <Modal
        title={
          action === 'transfer'
            ? t('conversation.attention.approval.actions.confirmTransferTitle')
            : action === 'reject'
              ? t('conversation.attention.approval.actions.confirmRejectTitle')
              : t('conversation.attention.approval.actions.confirmApproveTitle')
        }
        visible={Boolean(action)}
        onCancel={() => setAction(undefined)}
        onOk={() => void confirmAction()}
        okButtonProps={{
          loading: submitting,
          disabled: action === 'transfer' && !selectedContact,
          status: action === 'reject' ? 'danger' : undefined,
        }}
        unmountOnExit={false}
      >
        <Typography.Paragraph>
          {t('conversation.attention.approval.actions.confirmDescription', { title: item.title })}
        </Typography.Paragraph>
        <Typography.Paragraph>
          {t('conversation.attention.approval.actions.confirmOpinion', {
            opinion: opinion.trim() || t('conversation.attention.approval.actions.opinionEmpty'),
          })}
        </Typography.Paragraph>
        {action === 'transfer' ? (
          <Select
            showSearch
            filterOption={false}
            loading={contactsLoading}
            placeholder={t('conversation.attention.approval.actions.contactPlaceholder')}
            onSearch={setContactQuery}
            onChange={(openId) => setSelectedContact(contacts?.find((contact) => contact.openId === openId))}
            data-testid='approval-transfer-contact'
          >
            {(contacts ?? []).map((contact) => (
              <Select.Option key={contact.openId} value={contact.openId}>
                {contact.name} · {contact.department || contact.enterpriseEmail || contact.openId}
              </Select.Option>
            ))}
          </Select>
        ) : null}
        {action === 'transfer' && selectedContact ? (
          <Typography.Paragraph>
            {t('conversation.attention.approval.actions.confirmRecipient', {
              name: selectedContact.name,
              department: selectedContact.department || selectedContact.enterpriseEmail || selectedContact.openId,
              openId: selectedContact.openId,
            })}
          </Typography.Paragraph>
        ) : null}
      </Modal>
    </div>
  );
};

export const FeishuApprovalInbox: React.FC<FeishuApprovalInboxProps> = ({
  pendingItems,
  doneItems,
  loading,
  error,
  onRefresh,
  onStartHandling,
}) => {
  const { t } = useTranslation();
  const [activeStatus, setActiveStatus] = useState<ApprovalListTopic>('pending');
  const [selectedId, setSelectedId] = useState<string>();
  const [opinions, setOpinions] = useState<Record<string, string>>({});
  const items = activeStatus === 'pending' ? pendingItems : doneItems;
  const selectedItem = items.find((item) => item.taskId === selectedId) ?? items[0];
  const selectedOpinion = selectedItem ? (opinions[selectedItem.taskId] ?? '') : '';

  useEffect(() => {
    if (selectedItem && selectedId !== selectedItem.taskId) setSelectedId(selectedItem.taskId);
  }, [selectedId, selectedItem]);

  const tabs = useMemo(
    () => [
      { key: 'pending' as const, count: pendingItems.length },
      { key: 'done' as const, count: doneItems.length },
    ],
    [doneItems.length, pendingItems.length]
  );

  return (
    <div className={styles.workspace} data-testid='approval-inbox'>
      <div className={styles.toolbar}>
        <Tabs activeTab={activeStatus} onChange={(key) => setActiveStatus(key as ApprovalListTopic)}>
          {tabs.map((tab) => (
            <Tabs.TabPane
              key={tab.key}
              title={t(`conversation.attention.approval.tabs.${tab.key}`, { count: tab.count })}
            />
          ))}
        </Tabs>
        <div className={styles.toolbarAside}>
          <Tag size='small' color='arcoblue'>
            {t('conversation.attention.approval.realData')}
          </Tag>
          <Button size='mini' onClick={() => void onRefresh()}>
            {t('common.refresh')}
          </Button>
        </div>
      </div>
      {error ? (
        <Alert
          type='error'
          showIcon
          content={
            <div className='flex items-center justify-between gap-8px'>
              <span>{t('conversation.attention.loadFailed')}</span>
              <Button size='mini' onClick={() => void onRefresh()}>
                {t('common.retry')}
              </Button>
            </div>
          }
        />
      ) : null}
      <div className={styles.workspaceBody}>
        <aside className={styles.listPane}>
          <div className={styles.listHeader}>
            <Typography.Text className={styles.listTitle}>
              {t(`conversation.attention.approval.list.${activeStatus}Title`)}
            </Typography.Text>
            <Typography.Text className={styles.listCount}>
              {t('conversation.attention.approval.list.count', { count: items.length })}
            </Typography.Text>
          </div>
          <div className={styles.listScroll} role='list'>
            {loading ? (
              <Spin className='m-auto' />
            ) : items.length ? (
              items.map((item) => (
                <ApprovalListCard
                  key={item.taskId}
                  item={item}
                  topic={activeStatus}
                  selected={selectedItem?.taskId === item.taskId}
                  onSelect={() => setSelectedId(item.taskId)}
                />
              ))
            ) : (
              <Empty description={t(`conversation.attention.approval.list.${activeStatus}Empty`)} />
            )}
          </div>
        </aside>
        <main className={styles.detailPane}>
          {selectedItem ? (
            <ApprovalDetail
              key={selectedItem.taskId}
              item={selectedItem}
              topic={activeStatus}
              opinion={selectedOpinion}
              onOpinionChange={(opinion) => setOpinions((current) => ({ ...current, [selectedItem.taskId]: opinion }))}
              onStartHandling={() => onStartHandling(selectedItem, selectedOpinion)}
              onRefresh={onRefresh}
            />
          ) : (
            <Empty description={t('conversation.attention.approval.detail.empty')} />
          )}
        </main>
      </div>
    </div>
  );
};
