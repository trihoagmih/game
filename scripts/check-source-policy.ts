import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { auditSources, auditStyles, budgetGrowthIssues, type TypeDebtBudget } from './source-policy.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const budget = JSON.parse(readFileSync(new URL('../config/typescript-debt.json', import.meta.url), 'utf8')) as TypeDebtBudget;
const audit = auditSources(root, budget);
audit.issues.push(...auditStyles(path.join(root, 'client', 'src')));
const base = process.env.SOURCE_POLICY_BASE_REF;
if (base && !/^0{40}$/.test(base)) {
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('Source policy base must be a full commit SHA');
  execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: root, stdio: 'pipe' });
  let previous: string | undefined;
  try {
    previous = execFileSync('git', ['show', `${base}:config/typescript-debt.json`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { /* Initial adoption: the base commit has no migration baseline yet. */ }
  if (previous) audit.issues.push(...budgetGrowthIssues(JSON.parse(previous) as TypeDebtBudget, budget));
}
if (audit.issues.length) {
  console.error(audit.issues.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Source policy passed: ${audit.files} TypeScript files; no authored JavaScript or new type debt; client CSS layered`);
}
