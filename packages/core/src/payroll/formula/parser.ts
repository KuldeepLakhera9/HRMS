import { Token, ASTNode } from './types.js';

export class Parser {
  private tokens: Token[];
  private pos = 0;
  private nodeCount = 0;
  private maxNodes = 100;
  private maxDepth = 20;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: 'EOF', value: null, pos: this.pos };
  }

  private consume(): Token {
    return this.tokens[this.pos++] ?? { type: 'EOF', value: null, pos: this.pos };
  }

  parse(): ASTNode {
    const ast = this.parseExpression(0, 0);
    if (this.peek().type !== 'EOF') {
      throw new Error(`Unexpected token '${this.peek().value}' at position ${this.peek().pos}`);
    }
    return ast;
  }

  private parseExpression(precedence: number, depth: number): ASTNode {
    if (depth > this.maxDepth) {
      throw new Error('Expression recursion depth limit exceeded (max 20)');
    }
    if (++this.nodeCount > this.maxNodes) {
      throw new Error('Expression node count limit exceeded (max 100)');
    }

    let left = this.parsePrimary(depth);

    while (this.peek().type === 'OPERATOR') {
      const op = String(this.peek().value);
      const opPrec = this.getPrecedence(op);
      if (opPrec < precedence) break;

      this.consume();
      const right = this.parseExpression(opPrec + 1, depth + 1);
      left = { type: 'BinaryOp', op, left, right };
    }

    return left;
  }

  private parsePrimary(depth: number): ASTNode {
    const token = this.peek();

    if (token.type === 'NUMBER') {
      this.consume();
      return { type: 'Literal', value: Number(token.value) };
    }

    if (token.type === 'IDENTIFIER') {
      this.consume();
      const name = String(token.value);

      // Check if function call
      if (this.peek().type === 'LPAREN') {
        this.consume(); // '('
        const args: ASTNode[] = [];
        if (this.peek().type !== 'RPAREN') {
          while (true) {
            args.push(this.parseExpression(0, depth + 1));
            if (this.peek().type === 'COMMA') {
              this.consume();
            } else if (this.peek().type === 'RPAREN') {
              break;
            } else {
              throw new Error(`Expected ',' or ')' at position ${this.peek().pos}`);
            }
          }
        }
        this.consume(); // ')'
        return { type: 'FunctionCall', name: name.toLowerCase(), args };
      }

      return { type: 'Variable', name };
    }

    if (token.type === 'LPAREN') {
      this.consume();
      const expr = this.parseExpression(0, depth + 1);
      if (this.peek().type !== 'RPAREN') {
        throw new Error(`Expected closing ')' at position ${this.peek().pos}`);
      }
      this.consume();
      return expr;
    }

    if (token.type === 'OPERATOR') {
      const op = String(token.value);
      if (op === '-' || op === '+' || op === 'not') {
        this.consume();
        const right = this.parsePrimary(depth + 1);
        return { type: 'UnaryOp', op, right };
      }
    }

    throw new Error(`Unexpected token '${token.value}' at position ${token.pos}`);
  }

  private getPrecedence(op: string): number {
    switch (op) {
      case 'or': return 1;
      case 'and': return 2;
      case '==': case '!=': case '<': case '<=': case '>': case '>=': return 3;
      case '+': case '-': return 4;
      case '*': case '/': case '%': return 5;
      default: return 0;
    }
  }
}
