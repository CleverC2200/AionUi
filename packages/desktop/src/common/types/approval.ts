export type ApprovalListTopic = 'pending' | 'done';

export type ApprovalSummary = {
  key: string;
  value: string;
};

export type ApprovalTask = {
  taskId: string;
  instanceCode: string;
  definitionCode: string;
  definitionName: string;
  title: string;
  topic: string;
  status: string;
  instanceStatus: string;
  initiatorId?: string;
  initiatorName?: string;
  userId: string;
  supportApiOperate: boolean;
  link?: string;
  summaries: ApprovalSummary[];
};

export type ApprovalTaskList = {
  count: number;
  hasMore: boolean;
  pageToken?: string;
  tasks: ApprovalTask[];
};

export type ApprovalFormField = {
  id: string;
  customId?: string;
  name: string;
  fieldType: string;
  value: unknown;
};

export type ApprovalNode = {
  nodeId?: string;
  nodeName?: string;
  nodeType?: string;
  approvers: Array<{ taskId?: string; userId?: string }>;
};

export type ApprovalOperation = {
  operationType: string;
  createTime: string;
  userId?: string;
  userName?: string;
  taskId?: string;
  nodeId?: string;
  comment?: string;
};

export type ApprovalInstanceTask = {
  id: string;
  userId: string;
  userName?: string;
  nodeId?: string;
  nodeName?: string;
  status: string;
  taskType?: string;
  startTime: string;
  endTime: string;
};

export type ApprovalInstance = {
  instanceCode: string;
  definitionCode: string;
  definitionName: string;
  serialNumber: string;
  status: string;
  startTime: string;
  endTime: string;
  initiatorId: string;
  departmentId?: string;
  form: ApprovalFormField[];
  currentNodes: ApprovalNode[];
  tasks: ApprovalInstanceTask[];
  operations: ApprovalOperation[];
  comments: Array<{ id: string; userId: string; userName?: string; createTime: string; comment: string }>;
};

export type ApprovalContact = {
  openId: string;
  name: string;
  department?: string;
  enterpriseEmail?: string;
  isCrossTenant: boolean;
};

export type ApprovalActionReceipt = {
  status: 'succeeded' | 'unknown_external_write';
  instanceCode: string;
  taskId: string;
  idempotencyKey: string;
};

export type ApprovalTaskActionRequest = {
  instanceCode: string;
  taskId: string;
  comment?: string;
  idempotencyKey: string;
};

export type ApprovalTaskTransferRequest = ApprovalTaskActionRequest & {
  transferUserId: string;
};
