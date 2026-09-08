import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { generateApiDocs } from '../../../scripts/api-docs/index';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});
async function fixture(source: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'aion-api-docs-'));
  roots.push(root);
  const dir = path.join(root, 'packages/desktop/src/common/adapter');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'httpBridge.ts'),
    `export declare function httpRequest<T>(method: string, path: string, body?: unknown): Promise<T>;\nexport declare function httpGet<T, P=undefined>(path: string | ((p:P)=>string)): unknown;\nexport declare function httpPost<T,P=undefined>(path:string | ((p:P)=>string), body?:(p:P)=>unknown):unknown;`
  );
  await writeFile(path.join(dir, 'sample.ts'), source);
  return root;
}
it('generates a local reference with source evidence and explicitly client-side response models', async () => {
  const root = await fixture(
    `import {httpRequest} from './httpBridge';\ninterface User { id: string; age?: number }\nexport const list = () => httpRequest<User[]>('GET', '/api/users');`
  );
  const out = path.join(root, 'output');
  const report = await generateApiDocs({ root, out });
  expect(report.http).toHaveLength(1);
  expect(report.http[0]).toMatchObject({
    method: 'GET',
    path: '/api/users',
    target: 'aioncore',
    sources: [{ line: 3 }],
  });
  const spec = JSON.parse(await readFile(path.join(out, 'openapi.json'), 'utf8'));
  expect(spec.paths['/api/users'].get.responses.default.description).toContain('客户端');
  expect(spec.paths['/api/users'].get.responses['200']).toBeUndefined();
  expect(spec.components.schemas.ClientResponse1).toMatchObject({
    type: 'array',
    items: { type: 'object', required: ['id'] },
  });
  expect(await readFile(path.join(out, 'index.html'), 'utf8')).toContain('./scalar.js');
  expect(await readFile(path.join(out, 'inventory.md'), 'utf8')).toContain('/api/users');
  expect(await generateApiDocs({ root, out })).toEqual(report);
});

it('follows aliases and path parameters, separates targets and reports unresolved calls without inventing routes', async () => {
  const root = await fixture(`import {httpGet as read, httpPost, httpRequest} from './httpBridge';
interface User { id: string }
export const get = read<User, { id: string }>(p => \`/api/users/\${encodeURIComponent(p.id)}?expand=true\`);
export const save = httpPost<User, { name: string }>('/api/users', p => ({name:p.name}));
export const first = () => httpRequest<User>('GET', '/api/shared');
export const second = () => httpRequest<User>('GET', '/api/shared');
export const remote = () => fetch('https://example.test/api/shared');
export const dynamic = (url:string) => fetch(url);
export const wrapper = (id:string) => httpRequest<User>('GET', \`/api/items/\${id}\`);
export const invoke = () => wrapper('fixed');
const unrelated = {httpRequest: () => 42}; unrelated.httpRequest();`);
  const out = path.join(root, 'output');
  const report = await generateApiDocs({ root, out });
  expect(report.http.find((e) => e.path === '/api/users/{id}')).toMatchObject({ method: 'GET', query: ['expand'] });
  expect(report.http.find((e) => e.method === 'POST')).toMatchObject({
    body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
  });
  expect(report.http.find((e) => e.path === '/api/shared' && e.target === 'aioncore')?.sources).toHaveLength(2);
  expect(report.http.find((e) => e.target === 'https://example.test')).toMatchObject({ path: '/api/shared' });
  expect(report.http.find((e) => e.expression === 'url')).toMatchObject({ status: 'unknown' });
  expect(report.http.find((e) => e.path === '/api/items/fixed')).toBeDefined();
  const spec = JSON.parse(await readFile(path.join(out, 'openapi.json'), 'utf8'));
  expect(spec.paths['/api/users/{id}'].get.parameters).toContainEqual({
    in: 'path',
    name: 'id',
    required: true,
    schema: { type: 'string' },
  });
  expect(JSON.stringify(spec)).not.toContain('https://example.test'); // target collisions go to separate documents
  expect(report.http.some((e) => e.sources.some((s) => s.caller === 'unrelated'))).toBe(false);
});

it('lists wire events separately from HTTP and excludes local-only emitters', async () => {
  const root = await fixture(`import {wsSend, wsEmitter, wsMappedEmitter, stubEmitter} from './httpBridge';
wsSend('conversation.subscribe',{conversation_id:'demo'});
const changed = wsEmitter<{id:string}>('conversation.changed');
const mapped = wsMappedEmitter<{id:string}>('conversation.updated', x => x as {id:string});
const local = stubEmitter('local.changed');
const unknown = (name:string) => wsSend(name,{});
const socket = new WebSocket('ws://localhost:9123/ws');
socket.send(JSON.stringify({name:'ping',data:{}}));`);
  const bridge = path.join(root, 'packages/desktop/src/common/adapter/httpBridge.ts');
  await writeFile(
    bridge,
    (await readFile(bridge, 'utf8')) +
      `\nexport declare function wsSend(name:string,data:unknown):boolean;\nexport declare function wsEmitter<T>(name:string):unknown;\nexport declare function wsMappedEmitter<T>(name:string,transform:(raw:unknown)=>T):unknown;\nexport declare function stubEmitter(name:string):unknown;`
  );
  const out = path.join(root, 'output');
  const report = await generateApiDocs({ root, out });
  expect(report.webSocket).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ direction: 'send', event: 'conversation.subscribe' }),
      expect.objectContaining({ direction: 'subscribe', event: 'conversation.changed' }),
      expect.objectContaining({ direction: 'subscribe', event: 'conversation.updated' }),
      expect.objectContaining({ direction: 'connection', url: 'ws://localhost:9123/ws' }),
      expect.objectContaining({ direction: 'send', event: 'ping', url: 'ws://localhost:9123/ws' }),
      expect.objectContaining({ status: 'unknown', expression: 'name' }),
    ])
  );
  expect(report.webSocket.some((e) => e.event === 'local.changed')).toBe(false);
  expect(await readFile(path.join(out, 'websocket.md'), 'utf8')).toContain('conversation.changed');
  expect(await readFile(path.join(out, 'websocket.md'), 'utf8')).toContain('"id"');
  const spec = JSON.parse(await readFile(path.join(out, 'openapi.json'), 'utf8'));
  expect(spec.paths).toEqual({});
});

it('keeps conditional targets, mutable URLs and incompatible types out of authoritative exports', async () => {
  const root = await fixture(`import {httpGet,httpRequest} from './httpBridge';
const options = {silentStatuses:[404]};
const read = httpGet<{id:string}>('/api/read', options);
let mutable='/api/old'; mutable='/api/new'; fetch(mutable);
const varying={path:'/api/old'};varying.path='/api/new';fetch(varying.path);
const detail=({id}:{id:string})=>httpRequest<{id:string}>('GET',\`/api/items/\${id}\`);
const a=()=>httpRequest<{id:string}>('GET','/api/conflict');
const b=()=>httpRequest<{id:number}>('GET','/api/conflict');
const target=()=>Math.random() ? '/api/a' : '/api/b';fetch(target());
fetch('/upload',{method:'POST',body:'raw text'});`);
  const out = path.join(root, 'output');
  const report = await generateApiDocs({ root, out });
  expect(report.http.find((e) => e.path === '/api/read')?.body).toBeUndefined();
  expect(report.http.filter((e) => e.path === '/api/old')).toHaveLength(0);
  expect(report.http.find((e) => e.path === '/api/items/{id}')).toBeDefined();
  expect(report.http.find((e) => e.path === '/api/conflict')?.diagnostics).toContain('conflicting-client-types');
  const spec = JSON.parse(await readFile(path.join(out, 'openapi.json'), 'utf8'));
  expect(spec.paths['/api/conflict']).toBeUndefined();
  const sameOrigin = JSON.parse(await readFile(path.join(out, 'openapi-1.json'), 'utf8'));
  expect(sameOrigin.paths['/upload'].post.requestBody).toBeUndefined();
});

it('records wire sends from nullable sockets and message handlers without treating local send methods as WebSocket', async () => {
  const root = await fixture(`let socket: WebSocket|null=null;
socket=new WebSocket('ws://localhost/ws');
socket.send(JSON.stringify({name:'pong',data:{timestamp:1}}));
socket.addEventListener('message', () => {});
const local={send: (x:unknown)=>x};local.send({name:'local'});`);
  const report = await generateApiDocs({ root, out: path.join(root, 'output') });
  expect(report.webSocket).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ direction: 'send', event: 'pong' }),
      expect.objectContaining({ direction: 'receive' }),
    ])
  );
  expect(report.webSocket.some((e) => e.event === 'local')).toBe(false);
});

it('removes stale generated target documents when a service call disappears', async () => {
  const root = await fixture(`fetch('https://example.test/api/old');`);
  const out = path.join(root, 'output');
  await generateApiDocs({ root, out });
  expect(JSON.parse(await readFile(path.join(out, 'openapi-1.json'), 'utf8')).paths['/api/old']).toBeDefined();
  await writeFile(path.join(root, 'packages/desktop/src/common/adapter/sample.ts'), 'export const empty = true;');
  await generateApiDocs({ root, out });
  await expect(readFile(path.join(out, 'openapi-1.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});

it('reports implicit request-body gaps and keeps candidate counts separate from deduplicated endpoints', async () => {
  const root = await fixture(`import {httpGet,httpPost} from './httpBridge';
const first=httpGet<{id:string}>('/api/same');
const second=httpGet<{id:string}>('/api/same');
const enable=httpPost<void,{config:Record<string,unknown>}>('/api/enable');`);
  const out = path.join(root, 'output');
  const report = await generateApiDocs({ root, out });
  expect(report.candidates).toBe(3);
  expect(report.http).toHaveLength(2);
  expect(report.candidateStatus).toEqual({ resolved: 2, partial: 1, unknown: 0 });
  expect(report.http.find((e) => e.path === '/api/enable')).toMatchObject({
    status: 'partial',
    diagnostics: ['unsupported-request-body'],
  });
  expect(await readFile(path.join(out, 'inventory.md'), 'utf8')).toContain('已解析：2');
});
