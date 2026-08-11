import { ipcBridge } from '@/common';
import type { InteractionRequest } from '@/common/types/interactionRequest';
import { Badge, Button, Drawer, Empty, Spin, Typography } from '@arco-design/web-react';
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
  const { data, isLoading, mutate } = useSWR('interaction-requests.pending', () =>
    ipcBridge.interactionRequest.list.invoke()
  );
  const items = data?.items ?? [];

  useEffect(() => ipcBridge.interactionRequest.changed.on(() => void mutate()), [mutate]);

  const close = useCallback(() => {
    setVisible(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const openRequest = useCallback(
    (request: InteractionRequest) => {
      setVisible(false);
      onNavigate?.();
      void navigate(`/conversation/${request.conversation_id}`, {
        state: {
          targetMessageId: request.message_id,
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
        <Badge count={items.length} maxCount={99} dotStyle={{ boxShadow: '0 0 0 2px var(--bg-2)' }}>
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
          </Button>
        </Badge>
      </div>
      <Drawer
        width={420}
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
            <Spin />
          </div>
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
