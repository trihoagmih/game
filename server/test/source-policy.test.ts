import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditSources, auditStyles, budgetGrowthIssues } from '../../scripts/source-policy.js';

test('source policy rejects JS, new any and disabled TypeScript checking', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'game-source-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'new.js'), 'export const value = 1;');
  writeFileSync(path.join(root, 'new.ts'), 'export const value: any = 1;');
  writeFileSync(path.join(root, 'unchecked.ts'), '// @ts-nocheck\nexport const value = 1;');
  const { issues } = auditSources(root, {});
  assert.equal(issues.length, 3);
  assert.ok(issues.some((issue) => issue.includes('authored JavaScript')));
  assert.ok(issues.some((issue) => issue.includes('explicit any')));
  assert.ok(issues.some((issue) => issue.includes('suppressing TypeScript')));
});

test('source policy permits existing debt but cannot move it to a new file', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'game-source-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'legacy.ts'), 'export const value: any = 1;');
  mkdirSync(path.join(root, 'dist'));
  writeFileSync(path.join(root, 'dist', 'built.js'), 'export const value = 1;');
  assert.deepEqual(auditSources(root, { 'legacy.ts': 1 }).issues, []);
  writeFileSync(path.join(root, 'new.ts'), 'export const value: any = 1;');
  assert.equal(auditSources(root, { 'legacy.ts': 1 }).issues.length, 1);
});

test('committed debt budgets can decrease but cannot increase or add file allowances', () => {
  assert.deepEqual(budgetGrowthIssues({ 'legacy.ts': 2 }, { 'legacy.ts': 1 }), []);
  assert.equal(budgetGrowthIssues({ 'legacy.ts': 1 }, { 'legacy.ts': 2 }).length, 1);
  assert.equal(budgetGrowthIssues({ 'legacy.ts': 1 }, { 'legacy.ts': 1, 'new.ts': 1 }).length, 1);
});

test('client CSS must sit in a declared @layer and be imported', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'game-style-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['styles', 'components', 'games']) mkdirSync(path.join(root, dir));
  writeFileSync(path.join(root, 'styles', 'index.css'), "@layer base, components, games;\n@import './base.css';\n");
  writeFileSync(path.join(root, 'styles', 'base.css'), '/* nền */\n@layer base {\n  body { margin: 0; }\n}\n');
  writeFileSync(path.join(root, 'components', 'Card.tsx'), "import './Card.css';\n");
  writeFileSync(path.join(root, 'components', 'Card.css'), '@layer components {\n  .card { color: red; }\n}\n');
  assert.deepEqual(auditStyles(root), []);

  writeFileSync(path.join(root, 'components', 'Card.css'), '.card { color: red; }\n');
  writeFileSync(path.join(root, 'games', 'Poker.css'), '@layer components {\n  .pk { color: red; }\n}\n');
  writeFileSync(path.join(root, 'games', 'Poker.tsx'), "import './Poker.css';\n");
  writeFileSync(path.join(root, 'games', 'Snake.css'), '@layer games {\n  .snake { color: red; }\n}\n.after { color: red; }\n');
  writeFileSync(path.join(root, 'games', 'Orphan.css'), '@layer games {\n  .x { color: red; }\n}\n');
  writeFileSync(path.join(root, 'styles', 'extra.css'), '@layer theme {\n  .x { color: red; }\n}\n');
  const issues = auditStyles(root);
  assert.ok(issues.some((issue) => issue.startsWith('client/src/components/Card.css') && issue.includes('single @layer')));
  assert.ok(issues.some((issue) => issue.startsWith('client/src/games/Poker.css') && issue.includes('belong to layer "games"')));
  assert.ok(issues.some((issue) => issue.startsWith('client/src/games/Snake.css') && issue.includes('single @layer')));
  assert.ok(issues.some((issue) => issue.startsWith('client/src/games/Orphan.css') && issue.includes('not imported')));
  assert.ok(issues.some((issue) => issue.startsWith('client/src/styles/extra.css') && issue.includes('not declared')));
});
