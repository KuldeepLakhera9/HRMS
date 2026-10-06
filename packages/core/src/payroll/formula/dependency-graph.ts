import { ASTNode, DependencyAnalysisResult } from './types.js';
import { Tokenizer } from './tokenizer.js';
import { Parser } from './parser.js';

export function extractVariablesFromAST(node: ASTNode, vars = new Set<string>()): Set<string> {
  if (!node) return vars;
  if (node.type === 'Variable') {
    vars.add(node.name);
  } else if (node.type === 'BinaryOp') {
    extractVariablesFromAST(node.left, vars);
    extractVariablesFromAST(node.right, vars);
  } else if (node.type === 'UnaryOp') {
    extractVariablesFromAST(node.right, vars);
  } else if (node.type === 'FunctionCall') {
    for (const arg of node.args) {
      extractVariablesFromAST(arg, vars);
    }
  }
  return vars;
}

/**
 * Builds a directed graph of formula dependencies, checks for cycles using DFS,
 * and returns the topological order for formula execution.
 */
export function analyzeFormulaDependencies(
  formulas: Record<string, string>,
): DependencyAnalysisResult {
  const graph: Record<string, string[]> = {};
  const allCodes = Object.keys(formulas);

  // Parse each formula and extract dependencies that are defined within the component set
  for (const [code, expression] of Object.entries(formulas)) {
    if (!expression || expression.trim() === '') {
      graph[code] = [];
      continue;
    }
    const tokenizer = new Tokenizer(expression);
    const parser = new Parser(tokenizer.tokenize());
    const ast = parser.parse();
    const deps = Array.from(extractVariablesFromAST(ast));
    // Filter to only internal component codes
    graph[code] = deps.filter(d => allCodes.includes(d));
  }

  const visited: Record<string, boolean> = {};
  const recStack: Record<string, boolean> = {};
  const path: string[] = [];
  let detectedCyclePath: string[] | undefined;

  function dfsCycle(node: string): boolean {
    visited[node] = true;
    recStack[node] = true;
    path.push(node);

    for (const neighbor of graph[node] || []) {
      if (!visited[neighbor]) {
        if (dfsCycle(neighbor)) return true;
      } else if (recStack[neighbor]) {
        const cycleStartIndex = path.indexOf(neighbor);
        detectedCyclePath = path.slice(cycleStartIndex).concat(neighbor);
        return true;
      }
    }

    recStack[node] = false;
    path.pop();
    return false;
  }

  for (const node of allCodes) {
    if (!visited[node]) {
      if (dfsCycle(node)) {
        return { hasCycle: true, cyclePath: detectedCyclePath };
      }
    }
  }

  // Topological sorting via post-order reversal (Kahn's or DFS)
  const order: string[] = [];
  const visitedOrder: Record<string, boolean> = {};

  function dfsOrder(node: string) {
    visitedOrder[node] = true;
    for (const neighbor of graph[node] || []) {
      if (!visitedOrder[neighbor]) {
        dfsOrder(neighbor);
      }
    }
    order.push(node);
  }

  for (const node of allCodes) {
    if (!visitedOrder[node]) {
      dfsOrder(node);
    }
  }

  return {
    hasCycle: false,
    evaluationOrder: order,
  };
}
