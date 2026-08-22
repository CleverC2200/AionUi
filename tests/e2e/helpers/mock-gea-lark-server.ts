import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type MockGeaLarkServer = {
  baseUrl: string;
  close: () => Promise<void>;
  counters: {
    qrRequests: number;
    tokenPolls: number;
    userInfoRequests: number;
  };
  invalidateAccessToken: () => void;
  setQrAuthenticationEnabled: (enabled: boolean) => void;
  tokenSentinel: string;
};

export async function startMockGeaLarkServer(): Promise<MockGeaLarkServer> {
  const tokenSentinel = 'issue133-desktop-platform-token-must-stay-encrypted';
  const counters = { qrRequests: 0, tokenPolls: 0, userInfoRequests: 0 };
  let tokenValid = true;
  let qrAuthenticationEnabled = true;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === '/gea-boot/sys/getLoginQrcode' && req.method === 'GET') {
      counters.qrRequests += 1;
      json(200, { success: true, result: { qrcodeId: 'issue133-qr' } });
      return;
    }
    if (url.pathname === '/gea-boot/sys/getQrcodeToken' && req.method === 'GET') {
      counters.tokenPolls += 1;
      json(200, {
        success: true,
        result: qrAuthenticationEnabled ? { success: true, token: tokenSentinel } : { success: false, token: '-1' },
      });
      return;
    }
    if (url.pathname === '/gea-boot/sys/user/getUserInfo' && req.method === 'GET') {
      counters.userInfoRequests += 1;
      const token = req.headers['x-access-token'];
      if (!tokenValid || token !== tokenSentinel) {
        json(401, { success: false, code: 'UNAUTHORIZED' });
        return;
      }
      json(200, {
        success: true,
        result: {
          userInfo: {
            id: 'issue133-desktop-user',
            username: 'issue133-desktop-user',
            realname: 'Issue 133 Desktop User',
            loginTenantId: 1001,
          },
        },
      });
      return;
    }
    if (url.pathname === '/gea-boot/aidata/user-agent-credential/my/list' && req.method === 'GET') {
      json(200, { success: true, result: { records: [], total: 0 } });
      return;
    }
    json(404, { success: false, code: 'NOT_FOUND' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}/gea-boot`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    counters,
    invalidateAccessToken: () => {
      tokenValid = false;
    },
    setQrAuthenticationEnabled: (enabled) => {
      qrAuthenticationEnabled = enabled;
    },
    tokenSentinel,
  };
}
