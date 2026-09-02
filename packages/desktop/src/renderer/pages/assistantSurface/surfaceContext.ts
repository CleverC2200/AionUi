/**
 * Structured business-surface context attached to a user Turn.
 *
 * The marker is part of the persisted user input so the agent and the UI share
 * one auditable source. MessageText renders it as a visible revision badge
 * instead of exposing the raw envelope.
 */

export const AION_SURFACE_CONTEXT_MARKER = '[[AION_SURFACE_CONTEXT]]';
export const AION_SURFACE_CONTEXT_END_MARKER = '[[/AION_SURFACE_CONTEXT]]';

export type SurfaceContextSnapshot = {
  schemaVersion: 1;
  surfaceId: 'forecast';
  revision: number;
  capturedAt: string;
  label: string;
  summary: string;
  payload: Record<string, unknown>;
};

export type SurfaceContextRevisionState = {
  fingerprint: string;
  revision: number;
  capturedAt: string;
};

export const resolveSurfaceContextRevision = (
  previous: SurfaceContextRevisionState | null | undefined,
  fingerprint: string,
  capturedAt: string
): SurfaceContextRevisionState => {
  const hasValidPrevious =
    previous !== null &&
    previous !== undefined &&
    Number.isInteger(previous.revision) &&
    previous.revision > 0 &&
    typeof previous.fingerprint === 'string' &&
    typeof previous.capturedAt === 'string' &&
    previous.capturedAt.length > 0;
  if (hasValidPrevious && previous.fingerprint === fingerprint) return previous;
  return {
    fingerprint,
    revision: hasValidPrevious ? previous.revision + 1 : 1,
    capturedAt,
  };
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const terminalBlockPattern = new RegExp(
  `\\n\\n${escapeRegExp(AION_SURFACE_CONTEXT_MARKER)}\\n([^\\n]+)\\n${escapeRegExp(AION_SURFACE_CONTEXT_END_MARKER)}$`
);

const isSnapshot = (value: unknown): value is SurfaceContextSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Partial<SurfaceContextSnapshot>;
  return (
    snapshot.schemaVersion === 1 &&
    snapshot.surfaceId === 'forecast' &&
    Number.isInteger(snapshot.revision) &&
    Number(snapshot.revision) > 0 &&
    typeof snapshot.capturedAt === 'string' &&
    typeof snapshot.label === 'string' &&
    typeof snapshot.summary === 'string' &&
    Boolean(snapshot.payload) &&
    typeof snapshot.payload === 'object' &&
    !Array.isArray(snapshot.payload)
  );
};

export const parseSurfaceContextBlock = (
  content: string
): { text: string; snapshot: SurfaceContextSnapshot | null } => {
  const match = terminalBlockPattern.exec(content);
  if (!match) return { text: content, snapshot: null };
  try {
    const snapshot: unknown = JSON.parse(match[1]);
    if (!isSnapshot(snapshot)) return { text: content, snapshot: null };
    return { text: content.slice(0, match.index), snapshot };
  } catch {
    return { text: content, snapshot: null };
  }
};

export const appendSurfaceContextBlock = (
  input: string,
  snapshot?: SurfaceContextSnapshot,
  capturedAt = new Date().toISOString()
): string => {
  if (!snapshot) return input;
  const parsed = parseSurfaceContextBlock(input);
  const plainInput = parsed.snapshot ? parsed.text : input;
  const frozenSnapshot: SurfaceContextSnapshot = JSON.parse(
    JSON.stringify({ ...snapshot, capturedAt })
  ) as SurfaceContextSnapshot;
  return `${plainInput}\n\n${AION_SURFACE_CONTEXT_MARKER}\n${JSON.stringify(frozenSnapshot)}\n${AION_SURFACE_CONTEXT_END_MARKER}`;
};
