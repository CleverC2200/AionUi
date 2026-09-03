export type AssistantSurfaceId = 'general' | 'forecast' | 'contract';

export type BusinessAssistantIcon = 'forecast';
export type BusinessAssistantGroupId = 'planning';

export type BusinessAssistantGroupDefinition = {
  id: BusinessAssistantGroupId;
  order: number;
  icon: BusinessAssistantIcon;
  labelKey: string;
  labelFallback: string;
};

export type AssistantSurfaceDefinition = {
  id: AssistantSurfaceId;
  schemaVersion: 1;
  route: string;
  nameKey: string;
  nameFallback: string;
  descriptionKey: string;
  descriptionFallback: string;
  tone: 'red' | 'blue';
  fixtureOnly: boolean;
  managed: boolean;
  component: 'general' | 'forecast-reference';
  defaultView: 'conversation' | 'workbench';
  capabilities: readonly { key: string; fallback: string }[];
  businessMenu?: {
    order: number;
    icon: BusinessAssistantIcon;
    groupId: BusinessAssistantGroupId;
    badge?: number;
  };
};

export const BUSINESS_ASSISTANT_GROUPS: readonly BusinessAssistantGroupDefinition[] = [
  {
    id: 'planning',
    order: 10,
    icon: 'forecast',
    labelKey: 'assistantSurface.navigation.groups.planning',
    labelFallback: '计划管理',
  },
];

export const ASSISTANT_SURFACES: readonly AssistantSurfaceDefinition[] = [
  {
    id: 'general',
    schemaVersion: 1,
    route: '/guid',
    nameKey: 'assistantSurface.general.name',
    nameFallback: 'GEAUi',
    descriptionKey: 'assistantSurface.general.description',
    descriptionFallback: '通用会话、文件、项目和任务。',
    tone: 'red',
    fixtureOnly: false,
    managed: false,
    component: 'general',
    defaultView: 'conversation',
    capabilities: [
      { key: 'chat', fallback: '通用会话' },
      { key: 'files', fallback: '文件处理' },
      { key: 'tasks', fallback: '定时任务' },
    ],
  },
  {
    id: 'forecast',
    schemaVersion: 1,
    route: '/assistant-surface/forecast',
    nameKey: 'assistantSurface.forecast.name',
    nameFallback: '需求预测 Agent',
    descriptionKey: 'assistantSurface.forecast.description',
    descriptionFallback: '按月份核对经销商与 SKU，形成销售计划。',
    tone: 'red',
    fixtureOnly: false,
    managed: true,
    component: 'forecast-reference',
    defaultView: 'workbench',
    capabilities: [
      { key: 'dealer', fallback: '经销商核对' },
      { key: 'sku', fallback: 'SKU 计划' },
      { key: 'approval', fallback: '提报流程' },
    ],
    businessMenu: { order: 10, icon: 'forecast', groupId: 'planning' },
  },
];

export const BUSINESS_ASSISTANT_SURFACES = ASSISTANT_SURFACES.filter(
  (
    surface
  ): surface is AssistantSurfaceDefinition & {
    businessMenu: NonNullable<AssistantSurfaceDefinition['businessMenu']>;
  } => surface.id !== 'general' && Boolean(surface.businessMenu)
).toSorted((left, right) => left.businessMenu.order - right.businessMenu.order);

export const validateAssistantSurfaceRegistry = (): string[] => {
  const errors: string[] = [];
  const ids = new Set<string>();
  const routes = new Set<string>();
  const menuOrders = new Set<string>();
  const groupIds = new Set(BUSINESS_ASSISTANT_GROUPS.map((group) => group.id));

  for (const surface of ASSISTANT_SURFACES) {
    if (ids.has(surface.id)) errors.push(`duplicate surface id: ${surface.id}`);
    if (routes.has(surface.route)) errors.push(`duplicate surface route: ${surface.route}`);
    ids.add(surface.id);
    routes.add(surface.route);

    if (!surface.businessMenu) continue;
    if (surface.id === 'general') errors.push('general surface cannot be a business menu agent');
    if (!groupIds.has(surface.businessMenu.groupId)) {
      errors.push(`unknown business menu group: ${surface.businessMenu.groupId}`);
    }
    const menuOrder = `${surface.businessMenu.groupId}:${surface.businessMenu.order}`;
    if (menuOrders.has(menuOrder)) {
      errors.push(`duplicate business menu order: ${menuOrder}`);
    }
    menuOrders.add(menuOrder);
  }

  return errors;
};

export const DEFAULT_ASSISTANT_SURFACE = ASSISTANT_SURFACES[0];
export const DEFAULT_BUSINESS_ASSISTANT_SURFACE = BUSINESS_ASSISTANT_SURFACES[0];

export const getAssistantSurface = (surfaceId: string | undefined): AssistantSurfaceDefinition | undefined =>
  ASSISTANT_SURFACES.find((surface) => surface.id === surfaceId);

export const isAssistantSurfaceAvailable = (surface: AssistantSurfaceDefinition): boolean =>
  !surface.fixtureOnly || (typeof window !== 'undefined' && window.__aionuiAssistantSurfaceFixtures === true);

export const getAssistantSurfaceFromPath = (pathname: string): AssistantSurfaceDefinition => {
  if (pathname.startsWith('/assistant-surface/')) {
    return getAssistantSurface(pathname.split('/')[2]) ?? DEFAULT_ASSISTANT_SURFACE;
  }
  return DEFAULT_ASSISTANT_SURFACE;
};
