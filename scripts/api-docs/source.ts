import path from 'node:path';
import { Node, SyntaxKind } from 'ts-morph';
export type Source = { file: string; line: number; caller: string };
export function sourceLocation(node: Node, root: string): Source {
  const fn = node.getFirstAncestor(Node.isFunctionDeclaration);
  return {
    file: path.relative(root, node.getSourceFile().getFilePath()),
    line: node.getStartLineNumber(),
    caller: node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getName() ?? fn?.getName() ?? '<anonymous>',
  };
}
