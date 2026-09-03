import { Alert, Button, Card, Message, Space, Typography } from '@arco-design/web-react';

const { Paragraph, Text, Title } = Typography;

export function ReviewStarter() {
  return (
    <main className='review-shell'>
      <Space className='review-stack' direction='vertical' size='large'>
        <Alert type='info' title='业务评审原型' content='页面中的数据和操作均为模拟，不会提交到生产系统。' />

        <Card title='用业务内容替换此处'>
          <Space direction='vertical' size='medium'>
            <Title heading={3}>一个完整的业务任务</Title>
            <Paragraph>保留业务目标、关键状态和主要动作；按组件映射替换本模板内容，不复制模板的信息结构。</Paragraph>
            <Space wrap>
              <Button type='primary' onClick={() => Message.success('模拟操作成功')}>
                演示主要动作
              </Button>
              <Button onClick={() => Message.error('模拟失败反馈')}>演示失败反馈</Button>
            </Space>
            <Text type='secondary'>主要交互组件来自 Arco Design React。</Text>
          </Space>
        </Card>
      </Space>
    </main>
  );
}
