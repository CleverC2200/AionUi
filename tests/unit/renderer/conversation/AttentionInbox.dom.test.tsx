import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import { AttentionInbox } from '@/renderer/pages/conversation/AttentionInbox';
import zhCNConversation from '@/renderer/services/i18n/locales/zh-CN/conversation.json';

const { approvalApi, interactionApi, notificationApi, navigate, talkToButler } = vi.hoisted(() => ({
  approvalApi: {
    list: vi.fn(),
    get: vi.fn(),
    searchContacts: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    transfer: vi.fn(),
  },
  interactionApi: {
    list: vi.fn(),
    reconnectedOn: vi.fn(() => vi.fn()),
  },
  notificationApi: {
    list: vi.fn(),
  },
  navigate: vi.fn(),
  talkToButler: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'user-1' } }),
}));

vi.mock('@/renderer/services/notificationInbox', () => ({
  notificationInboxKey: (userId: string) => `notifications.active.test:${userId}`,
  fetchActiveNotifications: notificationApi.list,
}));

vi.mock('@/renderer/pages/conversation/NotificationInbox', () => ({
  NotificationInbox: () => <div data-testid='embedded-notification-inbox'>Notification inbox</div>,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    feishuApproval: {
      list: { invoke: approvalApi.list },
      get: { invoke: approvalApi.get },
      searchContacts: { invoke: approvalApi.searchContacts },
      approve: { invoke: approvalApi.approve },
      reject: { invoke: approvalApi.reject },
      transfer: { invoke: approvalApi.transfer },
    },
    interactionRequest: {
      list: { invoke: interactionApi.list },
    },
    realtime: { reconnected: { on: interactionApi.reconnectedOn } },
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@/renderer/hooks/assistant/useTalkToButler', () => ({
  useTalkToButler: () => talkToButler,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (key: string, options?: Record<string, unknown>) => {
      const values = options ? Object.values(options).filter((value) => value !== undefined) : [];
      return `${key}${values.length ? `:${values.join(':')}` : ''}`;
    },
  }),
}));

const pendingTask = {
  taskId: 'task-pending',
  instanceCode: 'instance-pending',
  definitionCode: '1DA97CD8-B406-4A76-A39E-CFCB5AFEBB60',
  definitionName: '需求预测测试',
  title: '2026年9月需求预测',
  topic: '1',
  status: '1',
  instanceStatus: '1',
  initiatorId: 'ou_initiator',
  initiatorName: '陈勇浩',
  userId: 'ou_owner',
  supportApiOperate: true,
  summaries: [
    { key: '创建日期', value: '2026年08月20日' },
    { key: '事项说明', value: '计划提报与审批卡片原型' },
    { key: '附件', value: '1 个附件' },
  ],
};

const doneTask = {
  ...pendingTask,
  taskId: 'task-done',
  instanceCode: 'instance-done',
  topic: '2',
  status: '2',
};

const instance = {
  instanceCode: 'instance-pending',
  definitionCode: '1DA97CD8-B406-4A76-A39E-CFCB5AFEBB60',
  definitionName: '需求预测测试',
  serialNumber: '202608200032',
  status: 'PENDING',
  startTime: '1787184000000',
  endTime: '0',
  initiatorId: 'ou_initiator',
  form: [
    { id: 'created-at', name: '创建日期', fieldType: 'date', value: '2026-08-20' },
    { id: 'description', name: '事项说明', fieldType: 'textarea', value: '计划提报与审批卡片原型' },
    {
      id: 'attachment',
      name: '附件',
      fieldType: 'attachmentV2',
      value: ['https://example.invalid/interaction-request-external-api.md'],
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `approver-${index + 1}`,
      name: `审批人${index + 1}`,
      fieldType: 'contact',
      value: `审批人${index + 1}`,
    })),
  ],
  currentNodes: [{ nodeId: 'node-1', nodeName: '审批人1', nodeType: 'SEQUENTIAL', approvers: [] }],
  tasks: [
    {
      id: 'task-pending',
      userId: 'ou_owner',
      userName: '陈勇浩',
      nodeId: 'node-1',
      nodeName: '审批人1',
      status: 'PENDING',
      taskType: 'SEQUENTIAL',
      startTime: '1787184000000',
      endTime: '0',
    },
  ],
  operations: [
    {
      operationType: 'START',
      createTime: '1787184000000',
      userId: 'ou_initiator',
      userName: '陈勇浩',
    },
  ],
  comments: [],
};

const renderInbox = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AttentionInbox />
    </SWRConfig>
  );

describe('AttentionInbox real Feishu approval integration', () => {
  it('provides a localized label for duplicate-approver removal', () => {
    expect(zhCNConversation.attention.approval.operation.REMOVE_REPEAT).toBe('重复审批人已自动跳过');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    approvalApi.list.mockImplementation(({ topic }: { topic: string }) =>
      Promise.resolve({
        count: 1,
        hasMore: false,
        tasks: topic === 'pending' ? [pendingTask] : [doneTask],
      })
    );
    approvalApi.get.mockResolvedValue(instance);
    approvalApi.searchContacts.mockResolvedValue([
      {
        openId: 'ou_target',
        name: '王审批',
        department: '数智化部',
        isCrossTenant: false,
      },
    ]);
    approvalApi.approve.mockResolvedValue({
      status: 'succeeded',
      instanceCode: pendingTask.instanceCode,
      taskId: pendingTask.taskId,
      idempotencyKey: 'intent',
    });
    approvalApi.reject.mockResolvedValue({
      status: 'succeeded',
      instanceCode: pendingTask.instanceCode,
      taskId: pendingTask.taskId,
      idempotencyKey: 'intent',
    });
    approvalApi.transfer.mockResolvedValue({
      status: 'succeeded',
      instanceCode: pendingTask.instanceCode,
      taskId: pendingTask.taskId,
      idempotencyKey: 'intent',
    });
    interactionApi.list.mockResolvedValue({
      revision: 'attention-r1',
      sync_state: 'complete',
      failed_session_count: 0,
      failure_codes: [],
      items: [
        {
          id: 'interaction-1',
          version: 1,
          conversation_id: 'conversation-1',
          message_id: 'message-1',
          title: '工具执行确认',
          source: { type: 'agent', label: 'Agent' },
        },
      ],
    });
    notificationApi.list.mockResolvedValue({
      revision: 'notifications-r1',
      sync_state: 'fresh',
      failure_codes: [],
      items: [{ id: 'notification-1', status: 'unread' }],
    });
  });

  it('loads real pending and done lists, then renders the real instance form and workflow', async () => {
    renderInbox();
    await waitFor(() => expect(approvalApi.list).toHaveBeenCalledTimes(2));

    const trigger = screen.getByTestId('attention-inbox-trigger');
    await waitFor(() => expect(trigger).toHaveAttribute('aria-label', 'conversation.attention.open:3'));
    fireEvent.click(trigger);

    expect(await screen.findByTestId('approval-inbox')).toBeInTheDocument();
    expect(await screen.findByTestId('approval-card-task-pending')).toHaveAttribute('aria-pressed', 'true');
    const pendingCard = within(screen.getByTestId('approval-card-task-pending'));
    const cardSummary = pendingCard.getByTestId('approval-card-summary');
    expect(cardSummary).toHaveTextContent('计划提报与审批卡片原型');
    expect(cardSummary).not.toHaveTextContent('附件');
    expect(pendingCard.getByText('需求预测测试')).toBeVisible();
    expect(pendingCard.getByText('陈勇浩')).toBeVisible();
    expect(pendingCard.getByText('2026年08月20日')).toBeVisible();
    expect(pendingCard.getAllByText('2026年9月需求预测')).toHaveLength(1);
    const detail = await screen.findByTestId('approval-detail-task-pending');
    expect(detail).toHaveTextContent('需求预测测试');
    expect(detail).toHaveTextContent('计划提报与审批卡片原型');
    expect(within(detail).getByTestId('approval-attachment-1')).toBeVisible();
    expect(within(detail).getByText('创建日期').closest('[data-form-span]')).toHaveAttribute('data-form-span', 'full');
    expect(within(detail).getByText('事项说明').closest('[data-form-span]')).toHaveAttribute('data-form-span', 'full');
    expect(within(detail).getByText('附件').closest('[data-form-span]')).toHaveAttribute('data-form-span', 'full');
    expect(within(detail).getByTestId('approval-form-approvers').children).toHaveLength(5);
    expect(within(detail).getAllByText('审批人1')[0].closest('[data-form-span]')).toHaveAttribute(
      'data-form-span',
      'single'
    );
    expect(detail).not.toHaveTextContent('销售目标金额');
    expect(detail).not.toHaveTextContent('APPROVED');
    expect(detail).not.toHaveTextContent('conversation.attention.approval.tasks.title');
    expect(detail).not.toHaveTextContent('ou_owner');
    expect(detail).not.toHaveTextContent('ou_initiator');

    expect(approvalApi.list).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'done',
        definitionCode: '1DA97CD8-B406-4A76-A39E-CFCB5AFEBB60',
      })
    );

    fireEvent.click(screen.getByText('conversation.attention.approval.tabs.done:1'));
    expect(await screen.findByTestId('approval-card-task-done')).toBeInTheDocument();
    const doneDetail = await screen.findByTestId('approval-detail-task-done');
    const resultTitle = within(doneDetail).getByText('conversation.attention.approval.result.title');
    const flowTitle = within(doneDetail).getByText('conversation.attention.approval.flow.title');
    const formTitle = within(doneDetail).getByText('conversation.attention.approval.form.title');
    expect(resultTitle.compareDocumentPosition(flowTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(flowTitle.compareDocumentPosition(formTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(doneDetail).not.toHaveTextContent('conversation.attention.approval.tasks.title');
    expect(doneDetail).toHaveTextContent('conversation.attention.approval.result.files:1');
  });

  it('loads every approval page before rendering the inbox count', async () => {
    const secondTask = { ...pendingTask, taskId: 'task-page-2', instanceCode: 'instance-page-2' };
    approvalApi.list.mockImplementation(({ topic, pageToken }: { topic: string; pageToken?: string }) => {
      if (topic === 'done') return Promise.resolve({ count: 0, hasMore: false, tasks: [] });
      if (pageToken === 'next-page') return Promise.resolve({ count: 2, hasMore: false, tasks: [secondTask] });
      return Promise.resolve({ count: 2, hasMore: true, pageToken: 'next-page', tasks: [pendingTask] });
    });
    renderInbox();
    await waitFor(() => expect(approvalApi.list).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId('attention-inbox-trigger')).toHaveAttribute(
      'aria-label',
      'conversation.attention.open:4'
    );
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    expect(await screen.findByTestId('approval-card-task-page-2')).toBeInTheDocument();
  });

  it('exposes notifications and approval work from one inbox entry', async () => {
    renderInbox();
    const trigger = screen.getByTestId('attention-inbox-trigger');
    await waitFor(() => expect(trigger).toHaveAttribute('aria-label', 'conversation.attention.open:3'));

    fireEvent.click(trigger);
    expect(screen.queryByTestId('notification-inbox-trigger')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('conversation.notifications.title 1'));
    expect(await screen.findByTestId('embedded-notification-inbox')).toBeVisible();
  });

  it('does not expose an unsafe attachment URL as an open action', async () => {
    approvalApi.get.mockResolvedValue({
      ...instance,
      form: [{ id: 'attachment', name: '附件', fieldType: 'attachmentV2', value: ['javascript:alert(1)'] }],
    });
    renderInbox();
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    const detail = await screen.findByTestId('approval-detail-task-pending');
    expect(within(detail).queryByTestId('approval-attachment-1')).not.toBeInTheDocument();
    expect(detail).toHaveTextContent('conversation.attention.approval.form.attachmentUnavailable');
  });

  it('does not expose an untrusted native-approval fallback link', async () => {
    approvalApi.list.mockImplementation(({ topic }: { topic: string }) =>
      Promise.resolve({
        count: 1,
        hasMore: false,
        tasks:
          topic === 'pending'
            ? [{ ...pendingTask, supportApiOperate: false, link: 'javascript:alert(1)' }]
            : [doneTask],
      })
    );
    renderInbox();
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    await screen.findByTestId('approval-detail-task-pending');

    expect(screen.queryByText('conversation.attention.approval.actions.openInFeishu')).not.toBeInTheDocument();
    expect(screen.getByText('conversation.attention.approval.actions.approve').closest('button')).toBeDisabled();
  });

  it('keeps a trusted Feishu fallback available when third-party approval detail cannot load', async () => {
    approvalApi.list.mockImplementation(({ topic }: { topic: string }) =>
      Promise.resolve({
        count: 1,
        hasMore: false,
        tasks:
          topic === 'pending'
            ? [
                {
                  ...pendingTask,
                  supportApiOperate: false,
                  link: 'https://applink.feishu.cn/client/approval/detail',
                },
              ]
            : [doneTask],
      })
    );
    approvalApi.get.mockRejectedValueOnce(new Error('third-party approval detail unavailable'));

    renderInbox();
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));

    expect(await screen.findByText('conversation.attention.approval.detail.loadFailed')).toBeInTheDocument();
    expect(screen.getByText('conversation.attention.approval.actions.openInFeishu')).toBeVisible();
    expect(screen.queryByText('conversation.attention.approval.actions.approve')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.attention.approval.actions.reject')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.attention.approval.actions.transfer')).not.toBeInTheDocument();
  });

  it('requires confirmation before sending a real approve action with an idempotency key', async () => {
    renderInbox();
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    fireEvent.click(await screen.findByText('conversation.attention.approval.actions.approve'));

    expect(approvalApi.approve).not.toHaveBeenCalled();
    const modal = await screen.findByText('conversation.attention.approval.actions.confirmApproveTitle');
    const modalRoot = modal.closest('.arco-modal') as HTMLElement;
    fireEvent.click(within(modalRoot).getByRole('button', { name: '确定' }));

    await waitFor(() => expect(approvalApi.approve).toHaveBeenCalledTimes(1));
    expect(approvalApi.approve).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceCode: 'instance-pending',
        taskId: 'task-pending',
        idempotencyKey: expect.stringContaining('approval:approve:instance-pending:task-pending:'),
      })
    );
  });

  it('requires confirmation before rejecting with the sign-off opinion', async () => {
    renderInbox();
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    const opinion = await screen.findByTestId('approval-opinion-input');
    fireEvent.change(opinion, { target: { value: '数据依据不足，请补充后重新提交' } });
    fireEvent.click(screen.getByText('conversation.attention.approval.actions.reject'));

    expect(approvalApi.reject).not.toHaveBeenCalled();
    const modal = screen
      .getByText('conversation.attention.approval.actions.confirmRejectTitle')
      .closest('.arco-modal') as HTMLElement;
    fireEvent.click(within(modal).getByRole('button', { name: '确定' }));

    await waitFor(() => expect(approvalApi.reject).toHaveBeenCalledTimes(1));
    expect(approvalApi.reject).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceCode: 'instance-pending',
        taskId: 'task-pending',
        comment: '数据依据不足，请补充后重新提交',
        idempotencyKey: expect.stringContaining('approval:reject:instance-pending:task-pending:'),
      })
    );
  });

  it('searches verified internal contacts before transferring', async () => {
    renderInbox();
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    fireEvent.click(await screen.findByText('conversation.attention.approval.actions.transfer'));

    const select = await screen.findByTestId('approval-transfer-contact');
    fireEvent.click(select);
    const input = select.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '王审批' } });

    await waitFor(() => expect(approvalApi.searchContacts).toHaveBeenCalledWith({ query: '王审批' }));
    fireEvent.click(await screen.findByRole('option', { name: /王审批/ }));
    expect(screen.getByText(/ou_target/)).toBeInTheDocument();
    const modal = screen
      .getByText('conversation.attention.approval.actions.confirmTransferTitle')
      .closest('.arco-modal') as HTMLElement;
    fireEvent.click(within(modal).getByRole('button', { name: '确定' }));

    await waitFor(() =>
      expect(approvalApi.transfer).toHaveBeenCalledWith(
        expect.objectContaining({
          transferUserId: 'ou_target',
          idempotencyKey: expect.stringContaining('approval:transfer:instance-pending:task-pending:'),
        })
      )
    );
  });

  it('preserves the generic InteractionRequest inbox as a separate source', async () => {
    renderInbox();
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    fireEvent.click(await screen.findByText('conversation.attention.sourceTabs.interaction:1'));

    const request = screen.getByTestId('attention-request-interaction-1');
    expect(request).toHaveTextContent('工具执行确认');
    fireEvent.click(request);
    expect(navigate).toHaveBeenCalledWith(
      '/conversation/conversation-1',
      expect.objectContaining({ state: expect.objectContaining({ targetMessageId: 'message-1' }) })
    );
  });

  it('returns a team request to its original member and slot context', async () => {
    interactionApi.list.mockResolvedValueOnce({
      revision: 'attention-team-r1',
      sync_state: 'complete',
      failed_session_count: 0,
      failure_codes: [],
      items: [
        {
          id: 'team-request-1',
          version: 'v1',
          kind: 'permission',
          status: 'pending',
          title: 'Review teammate output',
          source: { type: 'team_agent', label: 'Researcher' },
          conversation_id: 'member-conversation-1',
          team_id: 'team-1',
          slot_id: 'worker-slot',
          turn_id: 'turn-1',
          message_id: 'message-1',
          allowed_actions: ['approve'],
          updated_at: '2026-08-12T00:00:00.000Z',
        },
      ],
    });
    renderInbox();
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    fireEvent.click(await screen.findByText('conversation.attention.sourceTabs.interaction:1'));
    fireEvent.click(await screen.findByTestId('attention-request-team-request-1'));

    expect(navigate).toHaveBeenCalledWith(
      '/team/team-1',
      expect.objectContaining({ state: expect.objectContaining({ targetSlotId: 'worker-slot' }) })
    );
  });

  it('preserves InteractionRequest failure and manual retry behavior', async () => {
    interactionApi.list.mockRejectedValueOnce(new Error('temporary failure'));
    renderInbox();
    await waitFor(() => expect(interactionApi.list).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    fireEvent.click(await screen.findByText('conversation.attention.sourceTabs.interaction:0'));
    expect(await screen.findByText('conversation.attention.interactionLoadFailed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('common.retry'));

    expect(await screen.findByTestId('attention-request-interaction-1')).toHaveTextContent('工具执行确认');
    expect(interactionApi.list).toHaveBeenCalledTimes(2);
  });

  it('shows clearly labeled development fixtures without inflating the real pending count', async () => {
    interactionApi.list.mockResolvedValueOnce({
      revision: 'attention-empty-r1',
      sync_state: 'complete',
      failed_session_count: 0,
      failure_codes: [],
      items: [],
    });
    renderInbox();
    await waitFor(() => expect(interactionApi.list).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId('attention-inbox-trigger')).toHaveAttribute(
      'aria-label',
      'conversation.attention.open:2'
    );
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    fireEvent.click(await screen.findByText('conversation.attention.sourceTabs.interaction:3'));

    expect(await screen.findByTestId('interaction-demo-notice')).toHaveTextContent(
      'conversation.attention.demo.description'
    );
    const demoRequests = within(screen.getByTestId('interaction-request-list')).getAllByRole('button');
    expect(demoRequests).toHaveLength(3);
    demoRequests.forEach((request) => expect(request).toBeDisabled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not hide an unavailable interaction-request route as an empty inbox', async () => {
    interactionApi.list.mockRejectedValueOnce(
      Object.assign(new Error('route unavailable'), {
        name: 'BackendHttpError',
        status: 404,
        code: 'NOT_FOUND',
        backendMessage: 'Route not found.',
      })
    );
    renderInbox();
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    fireEvent.click(await screen.findByText('conversation.attention.sourceTabs.interaction:0'));

    expect(await screen.findByRole('alert')).toHaveTextContent('conversation.attention.interactionLoadFailed');
    expect(screen.queryByText('conversation.attention.interactionEmpty')).not.toBeInTheDocument();
  });

  it('shows partial sync health and marks affected cached items stale', async () => {
    interactionApi.list.mockResolvedValueOnce({
      revision: 'attention-partial-r1',
      sync_state: 'partial',
      failed_session_count: 1,
      failure_codes: ['GEA_SESSION_REJECTED'],
      items: [
        {
          id: 'request-stale',
          version: 'v1',
          kind: 'permission',
          status: 'pending',
          title: 'Confirm production submission',
          source: { type: 'business_system', label: 'Finance' },
          conversation_id: 'conversation-stale',
          allowed_actions: ['proceed_once'],
          stale: true,
        },
      ],
    });
    renderInbox();
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    fireEvent.click(await screen.findByText('conversation.attention.sourceTabs.interaction:1'));
    expect(await screen.findByTestId('attention-sync-warning')).toHaveTextContent(
      'conversation.attention.syncPartial:1'
    );
    expect(screen.getByTestId('attention-request-request-stale-stale')).toHaveTextContent(
      'conversation.attention.stale'
    );
  });

  it('cancels the confirmation without writing', async () => {
    renderInbox();
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    fireEvent.click(await screen.findByText('conversation.attention.approval.actions.approve'));
    const modal = screen
      .getByText('conversation.attention.approval.actions.confirmApproveTitle')
      .closest('.arco-modal') as HTMLElement;
    fireEvent.click(within(modal).getByRole('button', { name: '取消' }));
    expect(approvalApi.approve).not.toHaveBeenCalled();
  });

  it('refreshes authoritative data once after a stale-task conflict', async () => {
    approvalApi.approve.mockRejectedValueOnce({
      name: 'BackendHttpError',
      status: 409,
      code: 'APPROVAL_UPSTREAM_ERROR',
      backendMessage: '审批任务已变化，请刷新后重试',
    });
    renderInbox();
    await waitFor(() => expect(approvalApi.list).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    fireEvent.click(await screen.findByText('conversation.attention.approval.actions.approve'));
    const modal = screen
      .getByText('conversation.attention.approval.actions.confirmApproveTitle')
      .closest('.arco-modal') as HTMLElement;
    fireEvent.click(within(modal).getByRole('button', { name: '确定' }));

    await waitFor(() => expect(approvalApi.list).toHaveBeenCalledTimes(4));
    expect(screen.getByText('审批任务已变化，请刷新后重试')).toBeInTheDocument();
  });

  it('shows a permission failure without marking the approval completed', async () => {
    approvalApi.approve.mockRejectedValueOnce({
      name: 'BackendHttpError',
      status: 403,
      code: 'APPROVAL_UPSTREAM_ERROR',
      backendMessage: '当前飞书账号缺少审批操作权限',
    });
    renderInbox();
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    fireEvent.click(await screen.findByText('conversation.attention.approval.actions.approve'));
    const modal = screen
      .getByText('conversation.attention.approval.actions.confirmApproveTitle')
      .closest('.arco-modal') as HTMLElement;
    fireEvent.click(within(modal).getByRole('button', { name: '确定' }));

    expect(await screen.findByText('当前飞书账号缺少审批操作权限')).toBeInTheDocument();
    expect(screen.queryByTestId('approval-action-receipt')).not.toBeInTheDocument();
  });

  it('keeps an unknown external write locked after the approval view remounts', async () => {
    const unknownTask = { ...pendingTask, taskId: 'task-unknown', instanceCode: 'instance-unknown' };
    approvalApi.list.mockImplementation(({ topic }: { topic: string }) =>
      Promise.resolve({ count: 1, hasMore: false, tasks: topic === 'pending' ? [unknownTask] : [doneTask] })
    );
    approvalApi.get.mockResolvedValue({ ...instance, instanceCode: 'instance-unknown' });
    approvalApi.approve.mockResolvedValueOnce({
      status: 'unknown_external_write',
      instanceCode: unknownTask.instanceCode,
      taskId: unknownTask.taskId,
      idempotencyKey: 'intent-unknown',
    });
    renderInbox();
    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    const approve = await screen.findByText('conversation.attention.approval.actions.approve');
    fireEvent.click(approve);
    const modal = screen
      .getByText('conversation.attention.approval.actions.confirmApproveTitle')
      .closest('.arco-modal') as HTMLElement;
    fireEvent.click(within(modal).getByRole('button', { name: '确定' }));
    expect(await screen.findByTestId('approval-action-receipt')).toHaveTextContent('unknown_external_write');

    fireEvent.click(screen.getByText('conversation.attention.sourceTabs.interaction:1'));
    fireEvent.click(screen.getByText('conversation.attention.sourceTabs.approval:1'));
    expect(await screen.findByTestId('approval-action-receipt')).toBeInTheDocument();
    expect(screen.getByText('conversation.attention.approval.actions.approve').closest('button')).toBeDisabled();
    expect(approvalApi.approve).toHaveBeenCalledTimes(1);
  });

  it('keeps InteractionRequest navigation while reconnect refreshes approvals', async () => {
    interactionApi.list.mockResolvedValue({
      revision: 'r1',
      items: [
        {
          id: 'interaction-team',
          version: 1,
          conversation_id: 'conversation-1',
          team_id: 'team-1',
          slot_id: 'slot-1',
          message_id: 'message-1',
          title: '团队确认',
          source: { type: 'team_agent', label: 'Team' },
        },
      ],
    });
    renderInbox();
    await waitFor(() => expect(interactionApi.list).toHaveBeenCalledTimes(1));
    interactionApi.reconnectedOn.mock.calls[0][0]();
    await waitFor(() => expect(approvalApi.list).toHaveBeenCalledTimes(4));
    expect(interactionApi.list).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('attention-inbox-trigger'));
    fireEvent.click(await screen.findByText('conversation.attention.sourceTabs.interaction:1'));
    fireEvent.click(screen.getByTestId('attention-request-interaction-team'));
    expect(navigate).toHaveBeenCalledWith(
      '/team/team-1',
      expect.objectContaining({
        state: expect.objectContaining({ targetMessageId: 'message-1', targetSlotId: 'slot-1' }),
      })
    );
  });
});
