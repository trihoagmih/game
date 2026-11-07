import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type TypeDebtBudget = Record<string, number>;
export interface SourceAudit { issues: string[]; anyCounts: TypeDebtBudget; files: number }
const excluded = new Set(['node_modules', 'dist', '.git', '.worktrees', '.agents', '.claude', '.codex', 'captures']);

export function budgetGrowthIssues(previous: TypeDebtBudget, current: TypeDebtBudget): string[] {
  return Object.entries(current).filter(([file, count]) => count > (previous[file] ?? 0))
    .map(([file]) => `${file}: increasing the committed type-debt budget is forbidden`);
}

/** Inspect authored code; build outputs, local tools and assets are outside this policy. */
export function auditSources(root: string, budget: TypeDebtBudget): SourceAudit {
  const issues: string[] = [];
  const anyCounts: TypeDebtBudget = {};
  let files = 0;
  function inspect(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) { inspect(absolute); continue; }
      if (!entry.isFile()) continue;
      if (/\.(?:js|jsx|mjs|cjs)$/.test(entry.name)) {
        issues.push(`${relative}: authored JavaScript is forbidden; use TypeScript/TSX`);
        continue;
      }
      if (!/\.(?:ts|tsx|mts|cts)$/.test(entry.name)) continue;
      files++;
      const source = readFileSync(absolute, 'utf8');
      const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
      let count = 0;
      function visit(node: ts.Node): void {
        if (node.kind === ts.SyntaxKind.AnyKeyword) count++;
        ts.forEachChild(node, visit);
      }
      visit(ast);
      if (count) anyCounts[relative] = count;
      if (count > (budget[relative] ?? 0)) issues.push(`${relative}: ${count} explicit any types exceeds existing budget ${budget[relative] ?? 0}`);
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, source);
      for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
        if ((token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia)
          && /^\s*(?:\/\/|\/\*)\s*@ts-(?:ignore|nocheck)\b/.test(scanner.getTokenText())) {
          issues.push(`${relative}: suppressing TypeScript checks is forbidden`);
        }
      }
    }
  }
  inspect(root);
  return { issues, anyCounts: Object.fromEntries(Object.entries(anyCounts).sort(([a], [b]) => a.localeCompare(b))), files };
}

const CSS_DIR_LAYER: Record<string, string> = { components: 'components', games: 'games' };

/** Index of the `}` closing the block opened at `open`, or -1 when unbalanced. */
function closingBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Client CSS: styles/index.css declares the @layer order; every other CSS file wraps all of its rules
 * in one declared @layer (components/ → components, games/ → games) and must actually be imported.
 */
export function auditStyles(clientSrc: string): string[] {
  const issues: string[] = [];
  const indexPath = path.join(clientSrc, 'styles', 'index.css');
  if (!existsSync(indexPath)) return ['client/src/styles/index.css: missing CSS entry point'];
  const index = readFileSync(indexPath, 'utf8');
  const order = index.replace(/\/\*[\s\S]*?\*\//g, '').match(/@layer\s+([\w-]+(?:\s*,\s*[\w-]+)+)\s*;/);
  if (!order) return ['client/src/styles/index.css: must declare the @layer order'];
  const layers = new Set(order[1].split(',').map((name) => name.trim()));
  const sources: string[] = [];
  const css: string[] = [];
  (function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.name.endsWith('.css')) css.push(absolute);
      else if (entry.name.endsWith('.tsx')) sources.push(absolute);
    }
  })(clientSrc);
  for (const file of css) {
    const relative = path.relative(clientSrc, file).split(path.sep).join('/');
    if (relative === 'styles/index.css') continue;
    const label = `client/src/${relative}`;
    const body = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const head = body.match(/^@layer\s+([\w-]+)\s*\{/);
    if (!head || closingBrace(body, head[0].length - 1) !== body.length - 1) {
      issues.push(`${label}: wrap the whole file in a single @layer block`);
      continue;
    }
    const layer = head[1];
    const expected = CSS_DIR_LAYER[relative.split('/')[0]];
    if (!layers.has(layer)) issues.push(`${label}: layer "${layer}" is not declared in styles/index.css`);
    else if (expected && layer !== expected) issues.push(`${label}: files in ${relative.split('/')[0]}/ belong to layer "${expected}"`);
    const name = path.basename(file);
    const imported = relative.startsWith('styles/')
      ? index.includes(`'./${name}'`)
      : sources.some((source) => path.dirname(source) === path.dirname(file) && readFileSync(source, 'utf8').includes(`import './${name}';`));
    if (!imported) issues.push(`${label}: not imported (styles/ via index.css, others by a component in the same folder)`);
  }
  return issues;
}
