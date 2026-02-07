import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { GitHubFetch } from '../src/github/github_fetch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
}

function makeStubRunner(stdoutResponses) {
  let i = 0;
  /** @type {string[][]} */
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    const stdout = stdoutResponses[i++];
    if (stdout === undefined) {
      throw new Error(`stub runner out of responses after ${i - 1} calls`);
    }
    return { exitCode: 0, stdout, stderr: '' };
  };
  return { runner, calls };
}

test('listPRComments paginates REST arrays and sorts combined output', async () => {
  const { runner } = makeStubRunner([
    readFixture('rest_issue_comments_page1.http'),
    readFixture('rest_issue_comments_page2.http'),
    readFixture('rest_review_comments_page1.http'),
  ]);

  const gh = new GitHubFetch({
    repo: 'octo/hello',
    ghRunner: runner,
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pr-sheriff-cache-')),
  });

  const res = await gh.listPRComments(123, { useCache: false });
  assert.equal(res.issueComments.length, 2);
  assert.equal(res.reviewComments.length, 1);
  assert.deepEqual(res.all.map((c) => c.id), [1, 3, 2]);
});

test('REST responses are cached to disk and reused within TTL', async () => {
  const { runner, calls } = makeStubRunner([readFixture('rest_get_pr_5.http')]);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-sheriff-cache-'));

  const gh = new GitHubFetch({
    repo: 'octo/hello',
    ghRunner: runner,
    cacheDir,
    cacheTtlSeconds: 60 * 60,
  });

  const a = await gh.getPR(5, { useCache: true });
  const b = await gh.getPR(5, { useCache: true });

  assert.equal(a.number, 5);
  assert.equal(b.number, 5);
  assert.equal(calls.length, 1);
});

test('rate-limit backoff retries once using retry-after', async () => {
  const { runner, calls } = makeStubRunner([
    readFixture('rest_rate_limited.http'),
    readFixture('rest_get_issue_1.http'),
  ]);

  /** @type {number[]} */
  const sleeps = [];
  const gh = new GitHubFetch({
    repo: 'octo/hello',
    ghRunner: runner,
    sleepFn: async (ms) => {
      sleeps.push(ms);
    },
    maxBackoffSeconds: 2,
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pr-sheriff-cache-')),
  });

  const issue = await gh.getIssue(1, { useCache: false });
  assert.equal(issue.number, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [1000]);
});

test('GraphQL timeline pagination follows endCursor', async () => {
  const { runner, calls } = makeStubRunner([
    readFixture('graphql_timeline_page1.http'),
    readFixture('graphql_timeline_page2.http'),
  ]);

  const gh = new GitHubFetch({
    repo: 'octo/hello',
    ghRunner: runner,
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pr-sheriff-cache-')),
  });

  const nodes = await gh.getIssueTimeline(7, { useCache: false });
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].__typename, 'CrossReferencedEvent');
  assert.equal(nodes[1].__typename, 'ClosedEvent');
  assert.equal(calls.length, 2);
});
