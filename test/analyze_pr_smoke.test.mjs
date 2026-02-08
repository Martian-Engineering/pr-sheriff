import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

function runAnalyzePrDry() {
  const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
  const res = spawnSync(tsxBin, [
    path.join(repoRoot, 'src', 'cli.ts'),
    'analyze-pr',
    '--owner',
    'octo',
    '--repo',
    'hello',
    '--pr',
    '10',
    '--dry-fixtures',
    path.join(repoRoot, 'test', 'fixtures', 'analyze_pr'),
  ], { cwd: repoRoot, encoding: 'utf8' });

  if (res.error) throw res.error;
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}\n${res.stderr || ''}`);
  assert.ok(res.stdout && res.stdout.trim().startsWith('{'), `unexpected stdout: ${res.stdout}`);
  return JSON.parse(res.stdout);
}

test('analyze-pr returns structured JSON in dry fixtures mode', () => {
  const out = runAnalyzePrDry();
  assert.equal(out.ok, true);
  assert.equal(out.command, 'analyze-pr');
  assert.equal(out.result.kind, 'analyze-pr');
  assert.equal(out.result.status, 'ok');
  assert.equal(out.result.target.number, 10);

  const candidateNums = out.result.candidates.numbers;
  assert.ok(Array.isArray(candidateNums));
  assert.ok(candidateNums.includes(11));
  assert.ok(candidateNums.includes(12));
  assert.ok(candidateNums.includes(200));
});

