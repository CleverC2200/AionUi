import { describe, expect, it } from 'vitest';
import {
  AION_SURFACE_CONTEXT_END_MARKER,
  AION_SURFACE_CONTEXT_MARKER,
  appendSurfaceContextBlock,
  parseSurfaceContextBlock,
  resolveSurfaceContextRevision,
  type SurfaceContextSnapshot,
} from '@/renderer/pages/assistantSurface/surfaceContext';

const snapshot: SurfaceContextSnapshot = {
  schemaVersion: 1,
  surfaceId: 'forecast',
  revision: 3,
  capturedAt: '2026-08-29T01:02:03.000Z',
  label: '需求预测看板',
  summary: 'SKU 核对 · 已调整 2 条',
  payload: { view: 'skus', changedCount: 2 },
};

describe('surface context marker', () => {
  it('keeps one pending revision and captured time stable until the business payload changes', () => {
    const first = resolveSurfaceContextRevision(null, '{"stage":"area"}', '2026-08-30T08:00:00.000Z');
    const unchanged = resolveSurfaceContextRevision(first, '{"stage":"area"}', '2026-08-30T08:05:00.000Z');
    const changed = resolveSurfaceContextRevision(unchanged, '{"stage":"category"}', '2026-08-30T08:06:00.000Z');

    expect(unchanged).toBe(first);
    expect(unchanged).toEqual({
      fingerprint: '{"stage":"area"}',
      revision: 1,
      capturedAt: '2026-08-30T08:00:00.000Z',
    });
    expect(changed).toEqual({
      fingerprint: '{"stage":"category"}',
      revision: 2,
      capturedAt: '2026-08-30T08:06:00.000Z',
    });
  });

  it('round-trips a valid terminal snapshot', () => {
    const input = appendSurfaceContextBlock('分析当前调整', snapshot, snapshot.capturedAt);

    expect(parseSurfaceContextBlock(input)).toEqual({ text: '分析当前调整', snapshot });
  });

  it('replaces an existing valid snapshot instead of stacking markers', () => {
    const next = { ...snapshot, revision: 4 };
    const input = appendSurfaceContextBlock(
      appendSurfaceContextBlock('继续分析', snapshot, snapshot.capturedAt),
      next,
      next.capturedAt
    );

    expect(input.match(new RegExp(AION_SURFACE_CONTEXT_MARKER.replace(/[[\]]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(parseSurfaceContextBlock(input)).toEqual({ text: '继续分析', snapshot: next });
  });

  it('leaves malformed or non-terminal marker text visible', () => {
    const malformed = `问题\n\n${AION_SURFACE_CONTEXT_MARKER}\nnot-json\n${AION_SURFACE_CONTEXT_END_MARKER}`;
    const nonTerminal = `${appendSurfaceContextBlock('问题', snapshot, snapshot.capturedAt)}\n尾部`;
    expect(parseSurfaceContextBlock(malformed)).toEqual({ text: malformed, snapshot: null });
    expect(parseSurfaceContextBlock(nonTerminal)).toEqual({ text: nonTerminal, snapshot: null });
  });

  it('freezes the forecast payload instead of retaining a mutable reference', () => {
    const mutableSnapshot: SurfaceContextSnapshot = {
      ...snapshot,
      payload: { stage: 'area', selectedCount: 2 },
    };
    const frozenTurnInput = appendSurfaceContextBlock('解释当前计划', mutableSnapshot, mutableSnapshot.capturedAt);
    mutableSnapshot.payload = { stage: 'category', selectedCount: 3 };

    expect(parseSurfaceContextBlock(frozenTurnInput).snapshot?.payload).toEqual({
      stage: 'area',
      selectedCount: 2,
    });
  });

  it('captures a fresh timestamp at the send edge without mutating the live candidate', () => {
    const sentAt = '2026-08-30T08:09:10.000Z';
    const input = appendSurfaceContextBlock('发送当前核对结果', snapshot, sentAt);

    expect(parseSurfaceContextBlock(input).snapshot?.capturedAt).toBe(sentAt);
    expect(snapshot.capturedAt).toBe('2026-08-29T01:02:03.000Z');
  });
});
