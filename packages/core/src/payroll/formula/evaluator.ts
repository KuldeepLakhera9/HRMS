import { ASTNode, FormulaContext } from './types.js';

export const WHITELIST_FUNCS: Record<string, (...args: number[]) => number> = {
  min: (...args: number[]) => (args.length === 0 ? 0 : Math.min(...args)),
  max: (...args: number[]) => (args.length === 0 ? 0 : Math.max(...args)),
  round: (v = 0) => Math.round(v),
  floor: (v = 0) => Math.floor(v),
  ceil: (v = 0) => Math.ceil(v),
  abs: (v = 0) => Math.abs(v),
  if: (cond = 0, trueVal = 0, falseVal = 0) => (cond ? trueVal : falseVal),
  pct: (rate = 0, base = 0) => (rate / 100) * base,
  clamp: (v = 0, min = 0, max = 0) => Math.min(Math.max(v, min), max),
  days_in_month: (month = 1, year = 2026) => new Date(year, month, 0).getDate(),
  slab: (value = 0, ...slabs: number[]) => {
    // slab(gross, limit1, rate1, limit2, rate2, ...)
    let tax = 0;
    let prevLimit = 0;
    for (let i = 0; i < slabs.length; i += 2) {
      const limit = slabs[i];
      const rate = (slabs[i + 1] ?? 0) / 100;
      if (value > prevLimit) {
        const taxable = limit ? Math.min(value, limit) - prevLimit : value - prevLimit;
        tax += taxable * rate;
      }
      if (!limit || value <= limit) break;
      prevLimit = limit;
    }
    return tax;
  },
};

export class SafeEvaluator {
  private ast: ASTNode;

  constructor(ast: ASTNode) {
    this.ast = ast;
  }

  evaluate(context: FormulaContext = {}): number {
    return this.evalNode(this.ast, context);
  }

  private evalNode(node: ASTNode, context: FormulaContext): number {
    switch (node.type) {
      case 'Literal':
        return node.value;

      case 'Variable': {
        if (['__proto__', 'constructor', 'prototype'].includes(node.name)) {
          throw new Error(`Security violation: Access to forbidden property '${node.name}' is blocked`);
        }
        if (!(node.name in context)) {
          throw new Error(`Undefined variable '${node.name}' in formula context`);
        }
        const val = context[node.name];
        if (typeof val === 'boolean') return val ? 1 : 0;
        const num = Number(val);
        if (Number.isNaN(num)) {
          throw new Error(`Variable '${node.name}' cannot be coerced to number (got ${typeof val})`);
        }
        return num;
      }

      case 'BinaryOp': {
        const left = this.evalNode(node.left, context);
        const right = this.evalNode(node.right, context);
        switch (node.op) {
          case '+': return left + right;
          case '-': return left - right;
          case '*': return left * right;
          case '/':
            if (right === 0) throw new Error('Division by zero error in formula calculation');
            return left / right;
          case '%':
            if (right === 0) throw new Error('Modulo by zero error in formula calculation');
            return left % right;
          case '==': return left === right ? 1 : 0;
          case '!=': return left !== right ? 1 : 0;
          case '<': return left < right ? 1 : 0;
          case '<=': return left <= right ? 1 : 0;
          case '>': return left > right ? 1 : 0;
          case '>=': return left >= right ? 1 : 0;
          case 'and': return (left !== 0 && right !== 0) ? 1 : 0;
          case 'or': return (left !== 0 || right !== 0) ? 1 : 0;
          default: throw new Error(`Unknown operator '${node.op}'`);
        }
      }

      case 'UnaryOp': {
        const val = this.evalNode(node.right, context);
        if (node.op === '-') return -val;
        if (node.op === '+') return val;
        if (node.op === 'not') return val === 0 ? 1 : 0;
        throw new Error(`Unknown unary operator '${node.op}'`);
      }

      case 'FunctionCall': {
        const fn = WHITELIST_FUNCS[node.name];
        if (!fn) {
          throw new Error(`Function '${node.name}' is not in the allowed statutory whitelist`);
        }
        const evaluatedArgs = node.args.map(a => this.evalNode(a, context));
        return fn(...evaluatedArgs);
      }

      default:
        throw new Error(`Unknown AST node type: ${(node as { type: string }).type}`);
    }
  }
}
