import { ipcBridge } from '@/common';
import { isRouteUnavailableError } from '@/common/adapter/sidebarCompatibility';
import type { InteractionRequest } from '@/common/types/interactionRequest';
import { Alert, Badge, Button, Drawer, Empty, Spin, Typography } from '@arco-design/web-react';
import { Attention, Right } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

type AttentionInboxProps = {
  onNavigate?: () => void;
};

export const AttentionInbox: React.FC<AttentionInboxProps> = ({ onNavigate }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  const { data, error, isLoading, isValidating, mutate } = useSWR('interaction-requests.pending', async () => {
    try {
      return await ipcBridge.interactionRequest.list.invoke();
    } catch (requestError) {
      if (isRouteUnavailableError(requestError)) {
        return { revision: 'unsupported', items: [] };
      }
      throw requestError;
    }
  });
  const items = data?.items ?? [];

  useEffect(() => {
    const refresh = (): void => {
      void mutate();
    };
    const offChanged = ipcBridge.interactionRequest.changed.on(refresh);
    const offReconnected = ipcBridge.realtime.reconnected.on(refresh);
    return () => {
      offChanged();
      offReconnected();
    };
  }, [mutate]);

  const close = useCallback(() => {
    setVisible(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const openRequest = useCallback(
    (request: InteractionRequest) => {
      setVisible(false);
      onNavigate?.();
      void navigate(request.team_id ? `/team/${request.team_id}` : `/conversation/${request.conversation_id}`, {
        state: {
          targetMessageId: request.message_id,
          targetSlotId: request.slot_id,
          interactionRequestId: request.id,
          returnFocus: 'attention-inbox',
        },
      });
    },
    [navigate, onNavigate]
  );

  return (
    <>
      <div className='px-4px pb-6px'>
        <Button
          ref={triggerRef}
          long
          type='text'
          className='!h-34px !px-10px !justify-start !text-t-primary hover:!bg-fill-2'
          icon={<Attention theme='outline' size='17' />}
          onClick={() => setVisible(true)}
          aria-label={t('conversation.attention.open', { count: items.length })}
          data-testid='attention-inbox-trigger'
        >
          <span className='flex-1 text-left'>{t('conversation.attention.title')}</span>
          {items.length > 0 ? (
            <Badge count={items.length} maxCount={99} className='shrink-0' data-testid='attention-inbox-count' />
          ) : null}
        </Button>
      </div>
      <Drawer
        width='min(420px, 100vw)'
        title={t('conversation.attention.title')}
        visible={visible}
        onCancel={close}
        footer={null}
        unmountOnExit={false}
        getPopupContainer={() => document.body}
        data-testid='attention-inbox-drawer'
      >
        {isLoading ? (
          <div className='py-48px flex-center'>
            <Spin aria-label={t('common.loading', { defaultValue: 'Loading…' })} />
          </div>
        ) : error ? (
          <Alert
            type='error'
            showIcon
            content={
              <div className='flex flex-wrap items-center justify-between gap-8px'>
                <span>{t('conversation.attention.loadFailed')}</span>
                <Button size='mini' loading={isValidating} onClick={() => void mutate()}>
                  {t('common.retry', { defaultValue: 'Retry' })}
                </Button>
              </div>
            }
          />
        ) : items.length === 0 ? (
          <Empty description={t('conversation.attention.empty')} />
        ) : (
          <div className='flex flex-col gap-8px' role='list'>
            {items.map((request) => (
              <Button
                key={request.id}
                type='secondary'
                className='!h-auto !p-12px !justify-start !items-start !text-left'
                onClick={() => openRequest(request)}
                data-testid={`attention-request-${request.id}`}
              >
                <span className='flex min-w-0 w-full items-center gap-10px'>
                  <span className='flex-1 min-w-0'>
                    <Typography.Text className='block font-600 text-t-primary'>{request.title}</Typography.Text>
                    {request.summary ? (
                      <Typography.Text className='block mt-3px text-12px text-t-secondary' ellipsis>
                        {request.summary}
                      </Typography.Text>
                    ) : null}
                    <Typography.Text className='block mt-5px text-12px text-t-tertiary'>
                      {request.source.label || t(`conversation.attention.source.${request.source.type}`)}
                    </Typography.Text>
                  </span>
                  <Right theme='outline' size='16' className='shrink-0 text-t-tertiary' />
                </span>
              </Button>
            ))}
          </div>
        )}
      </Drawer>
    </>
  );
};
