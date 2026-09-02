/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  acknowledgeOpenConversation,
  claimPendingOpenConversation,
  reportOpenConversationFailure,
} from '@/process/utils/deepLink';

export const initDeepLinkBridge = (): void => {
  ipcBridge.deepLink.claimPending.provider(async () => claimPendingOpenConversation());
  ipcBridge.deepLink.acknowledge.provider(async ({ navigation_reference }) =>
    acknowledgeOpenConversation(navigation_reference)
  );
  ipcBridge.deepLink.reportFailure.provider(async ({ navigation_reference, result_code }) =>
    reportOpenConversationFailure(navigation_reference, result_code)
  );
};
