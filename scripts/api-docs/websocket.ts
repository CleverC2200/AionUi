import { Node, type SourceFile } from 'ts-morph';
import { declaration, property, textValue } from './expressions';
import { schema, type Schema } from './schema';
import { sourceLocation, type Source } from './source';

export type WebSocketEntry = {
  direction: 'connection' | 'send' | 'subscribe' | 'receive';
  event?: string;
  url?: string;
  payload?: Schema;
  expression: string;
  status: 'resolved' | 'partial' | 'unknown';
  diagnostics: string[];
  sources: Source[];
};
function socketOf(node: Node): { url?: string } | undefined {
  const socketType = node.getType().getNonNullableType().getSymbol();
  if (
    socketType?.getName() !== 'WebSocket' ||
    !socketType.getDeclarations().some((d) => d.getSourceFile().isDeclarationFile())
  )
    return undefined;
  const decl = declaration(node);
  const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
  if (init && Node.isNewExpression(init) && init.getExpression().getText() === 'WebSocket') {
    const value = textValue(init.getArguments()[0]);
    return { url: value && !value.dynamic ? value.text : undefined };
  }
  // A nullable/reassigned socket is still a wire transport, but its active URL is unknown.
  return {};
}

export function scanWebSocket(files: SourceFile[], root: string): WebSocketEntry[] {
  const entries: WebSocketEntry[] = [];
  for (const file of files) {
    for (const node of file.getDescendants()) {
      if (Node.isNewExpression(node) && node.getExpression().getText() === 'WebSocket') {
        const decl = declaration(node.getExpression());
        if (decl && !decl.getSourceFile().isDeclarationFile()) continue;
        const value = textValue(node.getArguments()[0]);
        entries.push({
          direction: 'connection',
          url: value && !value.dynamic ? value.text : undefined,
          expression: node.getArguments()[0]?.getText() ?? '',
          status: value && !value.dynamic ? 'resolved' : 'unknown',
          diagnostics: value && !value.dynamic ? [] : ['dynamic-connection-url'],
          sources: [sourceLocation(node, root)],
        });
      }
      if (!Node.isCallExpression(node)) continue;
      const expr = node.getExpression();
      const decl = declaration(expr);
      const symbol = expr.getSymbol();
      const name = (symbol?.getAliasedSymbol() ?? symbol)?.getName();
      if (
        decl?.getSourceFile().getFilePath().endsWith('/common/adapter/httpBridge.ts') &&
        ['wsSend', 'wsEmitter', 'wsMappedEmitter'].includes(name ?? '') &&
        !file.getFilePath().endsWith('/common/adapter/httpBridge.ts')
      ) {
        const value = textValue(node.getArguments()[0]);
        const event = value && !value.dynamic ? value.text : undefined;
        const payloadNode = name === 'wsSend' ? node.getArguments()[1] : node.getTypeArguments()[0];
        const payload = payloadNode ? schema(payloadNode.getType(), node) : undefined;
        entries.push({
          direction: name === 'wsSend' ? 'send' : 'subscribe',
          event,
          expression: node.getArguments()[0]?.getText() ?? '',
          payload,
          status: event ? 'partial' : 'unknown',
          diagnostics: [
            ...(event ? [] : ['dynamic-event-name']),
            'shared-bridge-connection',
            ...(name === 'wsMappedEmitter' ? ['mapped-client-payload-not-wire-schema'] : []),
          ],
          sources: [sourceLocation(node, root)],
        });
      }
      if (!Node.isPropertyAccessExpression(expr)) continue;
      const socket = socketOf(expr.getExpression());
      if (!socket) continue;
      const { url } = socket;
      if (expr.getName() === 'send') {
        let message = node.getArguments()[0];
        if (message && Node.isCallExpression(message) && message.getExpression().getText() === 'JSON.stringify')
          message = message.getArguments()[0];
        const value = textValue(property(message, 'name', new Map()));
        const event = value && !value.dynamic ? value.text : undefined;
        const data = property(message, 'data', new Map());
        entries.push({
          direction: 'send',
          url,
          event,
          payload: data ? schema(data.getType(), node) : undefined,
          expression: message?.getText() ?? '',
          status: event && url ? 'resolved' : 'partial',
          diagnostics: [...(event ? [] : ['unparsed-wire-message']), ...(url ? [] : ['unresolved-connection-url'])],
          sources: [sourceLocation(node, root)],
        });
      }
      if (expr.getName() === 'addEventListener' && textValue(node.getArguments()[0])?.text === 'message') {
        entries.push({
          direction: 'receive',
          url,
          expression: node.getText(),
          status: 'partial',
          diagnostics: ['transport-message-handler-business-events-not-inferred'],
          sources: [sourceLocation(node, root)],
        });
      }
    }
  }
  return entries.toSorted((a, b) =>
    `${a.sources[0].file}:${String(a.sources[0].line).padStart(8, '0')}`.localeCompare(
      `${b.sources[0].file}:${String(b.sources[0].line).padStart(8, '0')}`
    )
  );
}
