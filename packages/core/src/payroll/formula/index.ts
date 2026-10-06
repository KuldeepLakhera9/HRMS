import { Tokenizer } from './tokenizer.js';
import { Parser } from './parser.js';
import { SafeEvaluator } from './evaluator.js';
import { FormulaContext } from './types.js';

export * from './types.js';
export * from './tokenizer.js';
export * from './parser.js';
export * from './evaluator.js';
export * from './dependency-graph.js';

/**
 * Convenient one-shot helper to evaluate a single expression safely against a context.
 */
export function evaluateFormula(expression: string, context: FormulaContext = {}): number {
  const tokenizer = new Tokenizer(expression);
  const parser = new Parser(tokenizer.tokenize());
  const ast = parser.parse();
  const evaluator = new SafeEvaluator(ast);
  return evaluator.evaluate(context);
}
