import { spawnSync } from 'node:child_process';
import { assertNoTestRows } from '../test-support/transaction.js';
console.log('Checking mehta_electronics_local for pre-existing ZZTEST_ rows (read-only)...');
await assertNoTestRows();
console.log('PASS: initial residue check. Starting tests.');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
let residueFailed = false;
console.log('Checking for ZZTEST_ rows after the tests (read-only)...');
try { await assertNoTestRows(); console.log('PASS: no ZZTEST_ rows remain in public tables.'); }
catch (error) { residueFailed = true; console.error(error.message); }
if (result.error) console.error('Could not start the test runner.');
process.exitCode = residueFailed || result.error ? 1 : result.status ?? 1;
