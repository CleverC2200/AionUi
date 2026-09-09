const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { checkRoute } = require('../../../scripts/packaging/core-capability-smoke.cjs');

test('a running Core must reach the business authentication handler, not a generic route or auth fallback', async (t) => {
  let response = [404, { success: false, code: 'NOT_FOUND' }];
  const server = http.createServer((request, res) => {
    assert.equal(request.url, '/api/gea/sales-plan/periods?pageNo=1&pageSize=1');
    assert.equal(request.headers.authorization, undefined);
    res.writeHead(response[0], { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response[1]));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const port = server.address().port;
  await assert.rejects(checkRoute(port), /Core business route unavailable/);
  response = [200, { success: true }];
  await assert.rejects(checkRoute(port), /Core business route unavailable/);
  response = [401, { code: 'UNAUTHORIZED' }];
  await assert.rejects(checkRoute(port), /sales-plan handler/);
  response = [401, { code: 'GEA_AUTH_REQUIRED' }];
  assert.equal((await checkRoute(port)).status, 'passed');
});
