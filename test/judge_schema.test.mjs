import test from 'node:test';
import assert from 'node:assert/strict';

import { validateJudgeResult } from '../src/llm/judge_schema.mjs';

function makeValid() {
  return {
    superseded_by: [
      {
        pr_number: 123,
        repo: 'octo/hello',
        url: 'https://github.com/octo/hello/pull/123',
        summary: 'This PR implements the same change and was merged later.',
        evidence_ids: ['e1'],
        confidence: 0.9,
      },
    ],
    related: [
      {
        pr_number: 456,
        repo: 'octo/hello',
        url: 'https://github.com/octo/hello/pull/456',
        relationship: 'mentioned',
        summary: 'Mentioned in discussion as follow-up.',
        evidence_ids: ['e2'],
        confidence: 0.4,
      },
    ],
    evidence: [
      { id: 'e1', source: 'timeline_event', snippet: 'Cross-referenced by #123', url: 'https://example.com' },
      { id: 'e2', source: 'pr_comment', snippet: 'See #456 for follow-up', note: 'Comment on primary PR' },
    ],
    confidence: 0.7,
    timelines: [
      { ts: '2026-02-07T12:00:00Z', kind: 'opened', pr_number: 1, note: 'Primary PR opened' },
      { ts: '2026-02-08T12:00:00Z', kind: 'merged', pr_number: 123, note: 'Superseding PR merged' },
    ],
  };
}

test('validateJudgeResult accepts a valid object', () => {
  const v = makeValid();
  assert.deepEqual(validateJudgeResult(v), v);
});

test('validateJudgeResult rejects additional top-level keys', () => {
  const v = makeValid();
  v.extra = true;
  assert.throws(() => validateJudgeResult(v), /unexpected key/);
});

test('validateJudgeResult rejects out-of-range confidence', () => {
  const v = makeValid();
  v.confidence = 2;
  assert.throws(() => validateJudgeResult(v), /\[0,1\]/);
});

test('validateJudgeResult requires relationship for related links', () => {
  const v = makeValid();
  delete v.related[0].relationship;
  assert.throws(() => validateJudgeResult(v), /invalid related relationship|unexpected key|relationship/);
});

