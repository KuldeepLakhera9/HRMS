export type TokenType =
  | 'NUMBER'
  | 'IDENTIFIER'
  | 'OPERATOR'
  | 'COMMA'
  | 'LPAREN'
  | 'RPAREN'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string | number | null;
  pos: number;
}

export type ASTNode =
  | LiteralNode
  | VariableNode
  | BinaryOpNode
  | UnaryOpNode
  | FunctionCallNode;

export interface LiteralNode {
  type: 'Literal';
  value: number;
}

export interface VariableNode {
  type: 'Variable';
  name: string;
}

export interface BinaryOpNode {
  type: 'BinaryOp';
  op: string;
  left: ASTNode;
  right: ASTNode;
}

export interface UnaryOpNode {
  type: 'UnaryOp';
  op: string;
  right: ASTNode;
}

export interface FunctionCallNode {
  type: 'FunctionCall';
  name: string;
  args: ASTNode[];
}

export type FormulaContext = Record<string, number | string | boolean>;

export interface DependencyAnalysisResult {
  hasCycle: boolean;
  cyclePath?: string[] | undefined;
  evaluationOrder?: string[] | undefined;
}
