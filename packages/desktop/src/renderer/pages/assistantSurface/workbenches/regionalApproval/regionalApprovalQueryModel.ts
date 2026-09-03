import type { GeaSalesPlanListItem, GeaSalesPlanPageQuery, GeaSalesPlanPeriod } from '@/common/adapter/ipcBridge';
import type { ApprovalDimension, ApprovalStageId } from './regionalApprovalFixture';

export const SALES_PLAN_STATUS_BY_STAGE: Record<ApprovalStageId, number> = {
  customer: 6,
  region: 1,
  province: 2,
  area: 3,
  category: 4,
};

const APPROVAL_STAGE_BY_SALES_PLAN_STATUS: Record<number, ApprovalStageId> = {
  1: 'region',
  2: 'province',
  3: 'area',
  4: 'category',
  5: 'category',
  6: 'customer',
  7: 'region',
  8: 'province',
  9: 'area',
  10: 'category',
};

export const approvalStageForSalesPlanStatus = (status: number): ApprovalStageId | undefined =>
  APPROVAL_STAGE_BY_SALES_PLAN_STATUS[status];

export const VISIBLE_SALES_PLAN_STATUSES_BY_STAGE: Record<ApprovalStageId, readonly number[]> = {
  customer: [6],
  region: [1, 7],
  province: [2, 8],
  area: [3, 9],
  category: [4],
};

export const approvalStageProgressForSalesPlanStatusTotals = (
  total: number,
  statusTotals: Readonly<Partial<Record<number, number>>>
): Record<ApprovalStageId, number> => {
  if (!Number.isSafeInteger(total) || total <= 0) {
    return { customer: 0, region: 0, province: 0, area: 0, category: 0 };
  }

  return Object.fromEntries(
    Object.entries(VISIBLE_SALES_PLAN_STATUSES_BY_STAGE).map(([stage, statuses]) => {
      const unreachedCount = statuses.reduce((sum, status) => sum + Math.max(0, statusTotals[status] ?? 0), 0);
      return [stage, Math.max(0, Math.min(100, Math.round((1 - unreachedCount / total) * 100)))];
    })
  ) as Record<ApprovalStageId, number>;
};

export type RegionalApprovalQueryScope = Pick<
  GeaSalesPlanPageQuery,
  'dealerCode' | 'areaCode' | 'provinceCode' | 'orgCode' | 'baseName' | 'status'
>;

export type RegionalApprovalLiveRow = GeaSalesPlanListItem & {
  source: 'gea';
  approvalState: 'pending' | 'approved' | 'returned';
  channelCode?: string;
};

const normalizeSalesPlanDecimal = (value: unknown): string => {
  if (typeof value === 'string') return value;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
};

export const toRegionalApprovalLiveRow = (row: GeaSalesPlanListItem): RegionalApprovalLiveRow => ({
  ...row,
  targetQty: normalizeSalesPlanDecimal(row.targetQty),
  targetAmount: normalizeSalesPlanDecimal(row.targetAmount),
  currentQty: normalizeSalesPlanDecimal(row.currentQty),
  currentAmount: normalizeSalesPlanDecimal(row.currentAmount),
  source: 'gea',
  approvalState:
    row.status === 5 || row.status === 10 ? 'approved' : row.status >= 6 && row.status <= 9 ? 'returned' : 'pending',
});

export type RegionalApprovalLiveDimensionProjection = {
  name?: string;
  context: string[];
  customerCode?: string;
};

const uniqueNames = (values: Array<string | null | undefined>, excluded?: string) =>
  values
    .map((value) => value?.trim())
    .filter(
      (value, index, names): value is string => Boolean(value) && value !== excluded && names.indexOf(value) === index
    );

export const projectRegionalApprovalLiveDimension = (
  row: RegionalApprovalLiveRow,
  dimension: ApprovalDimension
): RegionalApprovalLiveDimensionProjection => {
  const name =
    dimension === 'area'
      ? row.regionName?.trim() || row.baseName?.trim()
      : dimension === 'province'
        ? row.provinceRegionName?.trim() || row.salesGroupName?.trim() || row.baseName?.trim()
        : dimension === 'region'
          ? row.salesGroupName?.trim() || row.provinceRegionName?.trim() || row.baseName?.trim()
          : dimension === 'base'
            ? row.baseName?.trim() || row.salesGroupName?.trim()
            : row.dealerName?.trim() || row.baseName?.trim();
  const context =
    dimension === 'customer'
      ? uniqueNames([row.regionName, row.provinceRegionName, row.salesGroupName, row.baseName], name)
      : dimension === 'region'
        ? uniqueNames([row.regionName, row.provinceRegionName, row.baseName], name)
        : dimension === 'province'
          ? uniqueNames([row.regionName, row.baseName], name)
          : dimension === 'base'
            ? uniqueNames([row.regionName, row.provinceRegionName, row.salesGroupName], name)
            : uniqueNames([row.baseName], name);
  return {
    name,
    context,
    ...(dimension === 'customer' ? { customerCode: row.dealerCode.trim() } : {}),
  };
};

export const chooseInitialSalesPlanPeriod = (periods: readonly GeaSalesPlanPeriod[]): GeaSalesPlanPeriod | undefined =>
  periods.find((period) => period.status.toUpperCase() === 'OPEN') ?? periods[0];

export const isOpenSalesPlanPeriod = (period: GeaSalesPlanPeriod | undefined): boolean =>
  period?.status.toUpperCase() === 'OPEN';

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

const parseDecimal = (value: string): { negative: boolean; digits: bigint; scale: number } | undefined => {
  const match = value.trim().match(DECIMAL_PATTERN);
  if (!match) return undefined;
  const fraction = match[3] ?? '';
  return {
    negative: match[1] === '-',
    digits: BigInt(`${match[2]}${fraction}`),
    scale: fraction.length,
  };
};

const powerOfTen = (scale: number): bigint => BigInt(`1${'0'.repeat(scale)}`);

export const addExactDecimals = (values: readonly string[]): string => {
  const parsed = values.map(parseDecimal);
  if (parsed.some((value) => value === undefined)) return '—';
  const decimals = parsed as Array<NonNullable<ReturnType<typeof parseDecimal>>>;
  const scale = Math.max(0, ...decimals.map((value) => value.scale));
  const total = decimals.reduce((sum, value) => {
    const signed = value.negative ? -value.digits : value.digits;
    return sum + signed * powerOfTen(scale - value.scale);
  }, BigInt(0));
  const negative = total < BigInt(0);
  const absolute = negative ? -total : total;
  const raw = absolute.toString().padStart(scale + 1, '0');
  const integer = scale === 0 ? raw : raw.slice(0, -scale);
  const fraction = scale === 0 ? '' : raw.slice(-scale);
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
};

export const subtractExactDecimals = (left: string | number, right: string | number): string => {
  const normalizedLeft = typeof left === 'number' ? String(left) : left;
  const normalizedRight = (typeof right === 'number' ? String(right) : right).trim();
  const negatedRight = normalizedRight.startsWith('-') ? normalizedRight.slice(1) : `-${normalizedRight}`;
  return addExactDecimals([normalizedLeft, negatedRight]);
};

export const formatExactDecimal = (value: string | number): string => {
  const normalizedValue = typeof value === 'number' ? String(value) : value;
  const match = normalizedValue.trim().match(DECIMAL_PATTERN);
  if (!match) return normalizedValue;
  const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${match[1]}${grouped}${match[3] === undefined ? '' : `.${match[3]}`}`;
};

export const clampSalesPlanPageNumber = (value: number, fallback = 1): number =>
  Number.isSafeInteger(value) && value >= 1 ? value : fallback;
