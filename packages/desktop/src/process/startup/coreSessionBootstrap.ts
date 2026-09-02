import { getCoreSessionBootstrapSecret } from '@aionui/web-host';
import type { Protocol, Session, WebContents } from 'electron';

export const SALES_PLAN_SUBMIT_PATH = '/api/gea/sales-plan/submissions';
export const TRUSTED_CORE_SCHEME = 'aionui-core';
export const TRUSTED_SALES_PLAN_SUBMIT_URL = `${TRUSTED_CORE_SCHEME}://trusted${SALES_PLAN_SUBMIT_PATH}`;
export const CORE_BOOTSTRAP_HEADER = 'X-AionCore-Bootstrap-Secret';
export const TRUSTED_TRANSPORT_RESPONSE_HEADER = 'X-AionUi-Trusted-Transport';
export const MAX_SALES_PLAN_SUBMIT_BODY_BYTES = 1024 * 1024;

export type TrustedSalesPlanRequest = {
  method: string;
  url: string;
  resourceType: string;
  webContentsId?: number;
  isMainWebContents: boolean;
  isMainFrame: boolean;
};

/** Register before app ready so Renderer fetch can use the private transport. */
export function registerTrustedSalesPlanScheme(electronProtocol: Pick<Protocol, 'registerSchemesAsPrivileged'>): void {
  electronProtocol.registerSchemesAsPrivileged([
    {
      scheme: TRUSTED_CORE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
      },
    },
  ]);
}

/** Pure allow-list used by the Main-process webRequest gate. */
export function isTrustedSalesPlanSubmitRequest(request: TrustedSalesPlanRequest, mainWebContentsId: number): boolean {
  if (
    request.method !== 'POST' ||
    request.resourceType !== 'xhr' ||
    request.webContentsId !== mainWebContentsId ||
    !request.isMainWebContents ||
    !request.isMainFrame ||
    request.url !== TRUSTED_SALES_PLAN_SUBMIT_URL
  ) {
    return false;
  }
  return true;
}

function jsonResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ success: false, code }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function readRequiredHeader(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  if (!value || value.trim() !== value || value.length > 256) return null;
  return value;
}

async function readLimitedBody(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      // Stream chunks are ordered and must be read sequentially.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SALES_PLAN_SUBMIT_BODY_BYTES) {
        // Stop the same reader before releasing its lock in finally.
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Main-owned forwarder. It constructs a new Core request from an allow-list,
 * so Renderer headers (including a forged bootstrap secret) are never copied.
 */
export async function forwardTrustedSalesPlanSubmit(params: {
  request: Request;
  backendPort: number;
  bootstrapSecret: string;
  fetchFromMain: (input: string, init: RequestInit) => Promise<Response>;
}): Promise<Response> {
  const { request, backendPort, bootstrapSecret, fetchFromMain } = params;
  if (request.method !== 'POST' || request.url !== TRUSTED_SALES_PLAN_SUBMIT_URL) {
    return jsonResponse(404, 'NOT_FOUND');
  }
  if (!Number.isSafeInteger(backendPort) || backendPort <= 0 || !bootstrapSecret) {
    return jsonResponse(503, 'GEA_SALES_PLAN_SUBMIT_CAPABILITY_UNAVAILABLE');
  }
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return jsonResponse(415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  const idempotencyKey = readRequiredHeader(request.headers, 'idempotency-key');
  const requestId = readRequiredHeader(request.headers, 'x-request-id');
  if (!idempotencyKey || !requestId) {
    return jsonResponse(400, 'INVALID_REQUEST_HEADERS');
  }

  const body = await readLimitedBody(request.body);
  if (!body || body.byteLength === 0) {
    return jsonResponse(413, 'INVALID_REQUEST_BODY_SIZE');
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonResponse(400, 'INVALID_REQUEST_BODY');
    }
  } catch {
    return jsonResponse(400, 'INVALID_REQUEST_BODY');
  }

  try {
    const backendResponse = await fetchFromMain(`http://127.0.0.1:${backendPort}${SALES_PLAN_SUBMIT_PATH}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-Request-Id': requestId,
        [CORE_BOOTSTRAP_HEADER]: bootstrapSecret,
      },
      body,
    });
    const responseHeaders = new Headers(backendResponse.headers);
    responseHeaders.set(TRUSTED_TRANSPORT_RESPONSE_HEADER, 'main');
    return new Response(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch {
    return jsonResponse(502, 'BACKEND_UNREACHABLE');
  }
}

/**
 * Install a caller gate plus a Main-owned protocol forwarder. Electron's
 * webRequest metadata supplies the WebContents/frame identity that the
 * protocol Request object intentionally does not expose.
 */
export function registerTrustedSalesPlanTransport(params: {
  desktopSession: Session;
  mainWebContents: WebContents;
  backendPort: number;
  bootstrapSecret: string;
  fetchFromMain: (input: string, init: RequestInit) => Promise<Response>;
}): void {
  const { desktopSession, mainWebContents, backendPort, bootstrapSecret, fetchFromMain } = params;
  desktopSession.webRequest.onBeforeRequest({ urls: [`${TRUSTED_CORE_SCHEME}://*/*`] }, (details, callback) => {
    callback({
      cancel: !isTrustedSalesPlanSubmitRequest(
        {
          method: details.method,
          url: details.url,
          resourceType: details.resourceType,
          webContentsId: details.webContentsId,
          isMainWebContents: details.webContents === mainWebContents,
          isMainFrame: details.frame === mainWebContents.mainFrame,
        },
        mainWebContents.id
      ),
    });
  });

  if (desktopSession.protocol.isProtocolHandled(TRUSTED_CORE_SCHEME)) {
    desktopSession.protocol.unhandle(TRUSTED_CORE_SCHEME);
  }
  desktopSession.protocol.handle(TRUSTED_CORE_SCHEME, (request) =>
    forwardTrustedSalesPlanSubmit({ request, backendPort, bootstrapSecret, fetchFromMain })
  );
}

/**
 * Consumes the trusted Core bootstrap secret at the desktop entry boundary.
 * Importing this module alone has no effect.
 */
export function initializeCoreSessionBootstrap<T>(initializeAfterBootstrap: () => T): {
  bootstrapSecret: string;
  initialized: T;
} {
  const bootstrapSecret = getCoreSessionBootstrapSecret();
  return { bootstrapSecret, initialized: initializeAfterBootstrap() };
}
