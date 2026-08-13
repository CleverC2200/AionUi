/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BackendHttpError } from '@/common/adapter/httpBridge';
import { isRouteUnavailableError } from '@/common/adapter/sidebarCompatibility';
import { describe, expect, it } from 'vitest';

describe('sidebarCompatibility', () => {
  it('recognises only an unavailable route as a compatibility fallback signal', () => {
    const unavailable = new BackendHttpError({
      method: 'GET',
      path: '/api/sidebar',
      status: 404,
      body: { code: 'NOT_FOUND', error: 'Route not found.' },
    });
    const missingEntity = new BackendHttpError({
      method: 'GET',
      path: '/api/sidebar',
      status: 404,
      body: { code: 'NOT_FOUND', error: 'Project not found.' },
    });

    expect(isRouteUnavailableError(unavailable)).toBe(true);
    expect(isRouteUnavailableError(missingEntity)).toBe(false);
    expect(isRouteUnavailableError(new Error('offline'))).toBe(false);
  });
});
