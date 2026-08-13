/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBackendRouteUnavailableError } from './httpBridge';

/** A 404 is a capability signal only when the backend says the route itself is absent. */
export const isRouteUnavailableError = (error: unknown): boolean => isBackendRouteUnavailableError(error);
