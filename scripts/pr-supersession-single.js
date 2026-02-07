#!/usr/bin/env node
/**
 * OpenClaw PR Supersession Detector - Single PR Mode
 * 
 * Analyzes a single PR to find superseded and related PRs.
 * 
 * Usage:
 *   node pr-supersession-single.js --repo=owner/repo --pr=10531
 *   node pr-supersession-single.js --repo=openclaw/openclaw --pr=10531 --output=json
 */

import { execSync } from 'child_process';
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, '').split('=');
  acc[key] = val || true;
  return acc;
}, {});

const REPO = args.repo || 'openclaw/openclaw';
const PR_NUM = parseInt(args.pr);
const OUTPUT = args.output || 'text';
const LIMIT = parseInt(args.limit) || 50;

if (!PR_NUM) {
  console.error('Usage: node pr-supersession-single.js --repo=owner/repo --pr=10531 [--output=json]');
  process.exit(1);
}

const MAX_LAYER1_ISSUES = 10;
const MAX_CLOSING_PRS_PER_ISSUE = 5;
const MAX_LAYER2_ISSUES_PER_PR = 10;
const MAX_LAYER2_CLOSING_PRS_PER_ISSUE = 5;
const MAX_LAYER2_CLOSING_PRS_DETAILS_PER_ISSUE = 3;

// Load Anthropic API key from 1Password or env
function getAnthropicKey() {
  // Try environment variable first
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  // Try 1Password
  try {
    const op = execSync('op item get "Anthropic API Key" --fields=password 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 10000
    });
    return op.trim();
  } catch {
    console.error('ANTHROPIC_API_KEY not found in env or 1Password');
    process.exit(1);
  }
}

function gh(query) {
  try {
    const result = spawnSync('gh', ['api', query], {
      encoding: 'utf-8',
      timeout: 20 * 1000,
      maxBuffer: 5 * 1024 * 1024
    });
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/**
 * Call `gh api` with optional headers and pagination, returning parsed JSON.
 *
 * Note: `gh api --paginate` returns a single JSON array for array endpoints
 * (e.g., comments, timelines). This helper relies on that behavior.
 */
function ghApi(path, { headers = [], paginate = false, timeoutMs = 20_000, maxBufferBytes = 5 * 1024 * 1024 } = {}) {
  try {
    const argv = ['api', path];
    for (const header of headers) {
      argv.push('-H', header);
    }
    if (paginate) {
      argv.push('--paginate');
    }

    const result = spawnSync('gh', argv, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: maxBufferBytes
    });

    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function search(query) {
  return gh(`search/issues?q=${encodeURIComponent(query)}&per_page=100`);
}

function truncate(str, max = 2000) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max) + '\n...[truncated]';
}

/**
 * Extract issue references for the configured `REPO` from an arbitrary text blob.
 *
 * Examples matched:
 * - "#123"
 * - "owner/repo#123" (only if it matches `REPO`)
 */
function extractIssueNumbers(text) {
  if (!text) return [];

  const out = new Set();

  // Same-repo, shorthand references: #123
  for (const m of text.matchAll(/(^|[^A-Za-z0-9_])#(\d+)\b/g)) {
    const num = parseInt(m[2], 10);
    if (Number.isFinite(num) && num > 0) out.add(num);
  }

  // Fully-qualified references: owner/repo#123
  for (const m of text.matchAll(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/g)) {
    if (m[1] !== REPO) continue;
    const num = parseInt(m[2], 10);
    if (Number.isFinite(num) && num > 0) out.add(num);
  }

  return Array.from(out).sort((a, b) => a - b);
}

const issueKindCache = new Map();

/**
 * Determine whether `issueNumber` is an Issue (not a PR) in this repo.
 *
 * GitHub models PRs as issues; the REST issue payload includes a `pull_request`
 * field when the number refers to a PR.
 */
async function isIssueNotPR(issueNumber) {
  if (issueKindCache.has(issueNumber)) {
    return issueKindCache.get(issueNumber) === 'issue';
  }

  const issue = ghApi(`repos/${REPO}/issues/${issueNumber}`);
  if (!issue) {
    issueKindCache.set(issueNumber, 'unknown');
    return false;
  }

  const kind = issue.pull_request ? 'pr' : 'issue';
  issueKindCache.set(issueNumber, kind);
  return kind === 'issue';
}

function extractIssueNumbersFromPRAndComments(pr, comments) {
  const combined = [
    pr?.body || '',
    ...(comments || []).map(c => c.body || '')
  ].join('\n\n');
  return extractIssueNumbers(combined);
}

function indentLines(text, prefix) {
  if (!text) return '';
  return text
    .split('\n')
    .map(line => `${prefix}${line}`)
    .join('\n');
}

function renderCommentsForPrompt(comments, { indent = '', maxComments = 3 } = {}) {
  if (!comments?.length) return '';
  const lines = ['Comments:'];
  for (const c of comments.slice(0, maxComments)) {
    lines.push(`- @${c.author}: ${c.body}`);
  }
  return indentLines(lines.join('\n'), indent);
}

async function callLLM(prompt) {
  const apiKey = getAnthropicKey();
  
  const payload = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    system: 'You analyze GitHub PRs. Respond ONLY with valid JSON.',
    messages: [{ role: 'user', content: prompt }]
  };
  
  const result = spawnSync('curl', [
    '-s', '-X', 'POST',
    'https://api.anthropic.com/v1/messages',
    '-H', `x-api-key: ${apiKey}`,
    '-H', 'anthropic-version: 2023-06-01',
    '-H', 'content-type: application/json',
    '-d', JSON.stringify(payload)
  ], {
    encoding: 'utf-8',
    timeout: 60 * 1000,
    maxBuffer: 10 * 1024 * 1024
  });
  
  const response = JSON.parse(result.stdout);
  // Strip markdown code block formatting if present
  const cleaned = response.content?.[0]?.text
    ?.replace(/```json\s*/g, '')
    ?.replace(/```\s*/g, '')
    ?.trim();
  return cleaned || response.error?.message;
}

async function getComments(prNumber) {
  try {
    const result = spawnSync('gh', ['api', `repos/${REPO}/issues/${prNumber}/comments`, '--paginate'], {
      encoding: 'utf-8',
      timeout: 15 * 1000,
      maxBuffer: 2 * 1024 * 1024
    });
    const comments = JSON.parse(result.stdout);
    return comments
      .map(c => ({
        author: c.user?.login,
        body: truncate(c.body, 800)
      }))
      .filter(c => c.body && !c.body.includes('<!-- greptile_comment -->'));
  } catch {
    return [];
  }
}

async function getPR(prNumber) {
  return ghApi(`repos/${REPO}/pulls/${prNumber}`);
}

const prCache = new Map();
const prCommentsCache = new Map();

async function getPRCached(prNumber) {
  if (prCache.has(prNumber)) return prCache.get(prNumber);
  const pr = await getPR(prNumber);
  prCache.set(prNumber, pr);
  return pr;
}

async function getCommentsCached(prNumber) {
  if (prCommentsCache.has(prNumber)) return prCommentsCache.get(prNumber);
  const comments = await getComments(prNumber);
  prCommentsCache.set(prNumber, comments);
  return comments;
}

/**
 * Resolve a repo issue number to the PR(s) that closed it, via the issue timeline.
 *
 * Implementation detail:
 * - We look for "closed" timeline events with a `commit_id`.
 * - Then map commit -> PR(s) via `/repos/{owner}/{repo}/commits/{sha}/pulls`.
 */
async function getClosingPRNumbersForIssue(issueNumber) {
  let timeline = ghApi(
    `repos/${REPO}/issues/${issueNumber}/timeline`,
    {
      paginate: true,
      timeoutMs: 30_000,
      maxBufferBytes: 10 * 1024 * 1024,
      headers: [
        // Timeline endpoints historically required preview headers; keep JSON accept explicit.
        'Accept: application/vnd.github+json'
      ]
    }
  );

  if (!Array.isArray(timeline)) {
    timeline = ghApi(
      `repos/${REPO}/issues/${issueNumber}/timeline`,
      {
        paginate: true,
        timeoutMs: 30_000,
        maxBufferBytes: 10 * 1024 * 1024,
        headers: [
          'Accept: application/vnd.github.mockingbird-preview+json'
        ]
      }
    );
  }

  if (!Array.isArray(timeline)) return [];

  const commitIds = new Set();
  for (const ev of timeline) {
    if (ev?.event === 'closed' && ev?.commit_id) {
      commitIds.add(ev.commit_id);
    }
  }

  const closingPRs = new Set();
  for (const sha of commitIds) {
    // This endpoint has historically used a preview accept header; try stable first,
    // then fall back if parsing fails.
    let prs = ghApi(`repos/${REPO}/commits/${sha}/pulls`, {
      headers: ['Accept: application/vnd.github+json'],
      timeoutMs: 30_000,
      maxBufferBytes: 5 * 1024 * 1024
    });

    if (!Array.isArray(prs)) {
      prs = ghApi(`repos/${REPO}/commits/${sha}/pulls`, {
        headers: ['Accept: application/vnd.github.groot-preview+json'],
        timeoutMs: 30_000,
        maxBufferBytes: 5 * 1024 * 1024
      });
    }

    if (!Array.isArray(prs)) continue;
    for (const pr of prs) {
      if (pr?.number) closingPRs.add(pr.number);
    }
  }

  return Array.from(closingPRs).sort((a, b) => a - b);
}

async function buildIssueTraceContext(targetPR, targetComments) {
  const referenced = extractIssueNumbersFromPRAndComments(targetPR, targetComments);

  const layer1Issues = [];
  for (const issueNum of referenced) {
    if (layer1Issues.length >= MAX_LAYER1_ISSUES) break;
    if (!(await isIssueNotPR(issueNum))) continue;

    const closingPRNums = (await getClosingPRNumbersForIssue(issueNum)).slice(0, MAX_CLOSING_PRS_PER_ISSUE);
    const closingPRs = [];

    for (const prNum of closingPRNums) {
      const pr = await getPRCached(prNum);
      if (!pr) continue;

      const comments = await getCommentsCached(prNum);
      const referenced2All = extractIssueNumbersFromPRAndComments(pr, comments);
      const referenced2 = [];
      for (const issue2 of referenced2All) {
        if (referenced2.length >= MAX_LAYER2_ISSUES_PER_PR) break;
        if (issue2 === issueNum) continue;
        if (!(await isIssueNotPR(issue2))) continue;
        referenced2.push(issue2);
      }

      const layer2 = [];
      for (const issue2 of referenced2) {
        const closing2Nums = (await getClosingPRNumbersForIssue(issue2)).slice(0, MAX_LAYER2_CLOSING_PRS_PER_ISSUE);

        const closing2PRs = [];
        for (const pr2Num of closing2Nums.slice(0, MAX_LAYER2_CLOSING_PRS_DETAILS_PER_ISSUE)) {
          const pr2 = await getPRCached(pr2Num);
          if (!pr2) continue;
          const pr2Comments = await getCommentsCached(pr2Num);
          closing2PRs.push({
            number: pr2.number,
            title: pr2.title,
            body: pr2.body,
            author: pr2.user?.login,
            merged_at: pr2.merged_at,
            comments: pr2Comments
          });
        }

        layer2.push({ issue: issue2, closingPRNumbers: closing2Nums, closingPRs: closing2PRs });
      }

      closingPRs.push({
        number: pr.number,
        title: pr.title,
        body: pr.body,
        author: pr.user?.login,
        merged_at: pr.merged_at,
        comments,
        referencedIssues: referenced2,
        layer2
      });
    }

    layer1Issues.push({
      issue: issueNum,
      closingPRs
    });
  }

  return {
    referencedIssues: layer1Issues.map(i => i.issue),
    layer1Issues
  };
}

function renderIssueTraceForPrompt(trace) {
  if (!trace?.layer1Issues?.length) return '';

  // Keep this section "mechanically readable" for the LLM: plain text, consistent indentation.
  const lines = [];
  lines.push('ISSUE TRACE (2 layers deep):');
  lines.push(`Target PR references issues: ${trace.referencedIssues?.length ? trace.referencedIssues.map(n => `#${n}`).join(', ') : '(none)'}`);
  lines.push('');

  for (const l1 of trace.layer1Issues) {
    lines.push(`Issue #${l1.issue} closed by:`);
    if (!l1.closingPRs?.length) {
      lines.push('- (no closing PRs found via timeline)');
      lines.push('');
      continue;
    }

    for (const pr of l1.closingPRs) {
      lines.push(`- PR #${pr.number}: "${pr.title}" (merged: ${pr.merged_at || 'unknown'})`);
      lines.push(`  Body: ${truncate(pr.body, 1500)}`);
      const prComments = renderCommentsForPrompt(pr.comments, { indent: '  ', maxComments: 3 });
      if (prComments) {
        lines.push(prComments);
      }
      lines.push(`  This closing PR references issues: ${pr.referencedIssues?.length ? pr.referencedIssues.map(n => `#${n}`).join(', ') : '(none)'}`);

      if (pr.layer2?.length) {
        lines.push('  Second-layer issues and their closing PRs:');
        for (const l2 of pr.layer2) {
          lines.push(`  - Issue #${l2.issue} closed by: ${l2.closingPRNumbers?.length ? l2.closingPRNumbers.map(n => `#${n}`).join(', ') : '(none found)'}`);
          for (const p2 of (l2.closingPRs || [])) {
            lines.push(`    - PR #${p2.number}: "${p2.title}" (merged: ${p2.merged_at || 'unknown'})`);
            lines.push(`      Body: ${truncate(p2.body, 800)}`);
            const p2Comments = renderCommentsForPrompt(p2.comments, { indent: '      ', maxComments: 2 });
            if (p2Comments) {
              lines.push(p2Comments);
            }
          }
        }
      }

      lines.push('');
    }
  }

  return `\n${lines.join('\n')}\n`;
}

async function analyze() {
  console.log(`Analyzing PR #${PR_NUM} in ${REPO}...\n`);
  
  const targetPR = gh(`repos/${REPO}/pulls/${PR_NUM}`);
  if (!targetPR) {
    console.error(`PR #${PR_NUM} not found`);
    process.exit(1);
  }
  
  const targetComments = await getComments(PR_NUM);
  const issueTrace = await buildIssueTraceContext(targetPR, targetComments);
  const issueTraceText = renderIssueTraceForPrompt(issueTrace);
  
  const mergedResult = search(`repo:${REPO} is:pr is:merged sort:updated-desc`);
  const mergedPRs = (mergedResult?.items || []).slice(0, LIMIT);
  
  const mergedWithComments = await Promise.all(
    mergedPRs.slice(0, 20).map(async (pr) => ({
      ...pr,
      comments: await getComments(pr.number)
    }))
  );

  // Add high-signal merged PRs found via issue tracing (deduped with the recent list).
  const tracedPRsDetailed = [];
  const tracedSeen = new Set();
  for (const l1 of issueTrace.layer1Issues || []) {
    for (const pr of l1.closingPRs || []) {
      if (!pr?.number || tracedSeen.has(pr.number)) continue;
      tracedSeen.add(pr.number);
      tracedPRsDetailed.push(pr);

      for (const l2 of pr.layer2 || []) {
        for (const pr2 of l2.closingPRs || []) {
          if (!pr2?.number || tracedSeen.has(pr2.number)) continue;
          tracedSeen.add(pr2.number);
          tracedPRsDetailed.push(pr2);
        }
      }
    }
  }
  
  const prompt = `
You are analyzing GitHub PR #${PR_NUM} to find superseded and related PRs.

TARGET PR #${targetPR.number}:
- Title: ${targetPR.title}
- Body: ${truncate(targetPR.body, 2000)}
- Author: ${targetPR.user?.login}
- Created: ${targetPR.created_at}
${targetComments.length > 0 ? `
Comments on this PR:
${targetComments.map(c => `- @${c.author}: ${c.body}`).join('\n')}` : ''}

${issueTraceText}

MERGED PR candidates to compare against:
${tracedPRsDetailed.length ? `
Relevant merged PRs (found via issue tracing):
${tracedPRsDetailed.map(pr => `
#${pr.number}: "${pr.title}"
- Body: ${truncate(pr.body, 1500)}
- Author: ${pr.author}
- Merged: ${pr.merged_at}
${pr.comments?.length > 0 ? `
Comments:
${pr.comments.slice(0, 3).map(c => `- @${c.author}: ${c.body}`).join('\n')}` : ''}
`).join('')}
` : ''}

Recent merged PRs (sorted by update date, newest first):
${mergedWithComments.map(pr => `
#${pr.number}: "${pr.title}"
- Body: ${truncate(pr.body, 1500)}
- Author: ${pr.user?.login}
- Merged: ${pr.merged_at}
${pr.comments?.length > 0 ? `
Comments:
${pr.comments.slice(0, 3).map(c => `- @${c.author}: ${c.body}`).join('\n')}` : ''}
`).join('')}

TASK:
Analyze whether TARGET PR #${PR_NUM} is superseded or related to any of the MERGED PR candidates above.

Definitions:
1. **SUPERSEDED**: The merged PR makes the target PR redundant because:
   - It addresses the same underlying issue/root cause
   - It was merged AFTER the target PR was created
   - The target PR's changes would be unnecessary or conflicting
   
2. **RELATED**: The merged PR addresses a similar problem but is NOT a direct replacement:
   - Same area of codebase
   - Similar symptoms but different root cause
   - Could inform understanding but doesn't replace

Respond with ONLY valid JSON:
{
  "superseded": [
    {
      "pr": merged_pr_number,
      "title": "merged PR title",
      "reasoning": "Why this makes the target PR redundant",
      "confidence": "high/medium/low"
    }
  ],
  "related": [
    {
      "pr": merged_pr_number, 
      "title": "merged PR title",
      "relationship": "brief description of how they're related",
      "confidence": "high/medium/low"
    }
  ],
  "summary": "Brief overall assessment of the target PR's status"
}
`;

  try {
    const response = await callLLM(prompt);
    const result = JSON.parse(response);
    
    if (OUTPUT === 'json') {
      console.log(JSON.stringify({
        target: {
          pr: targetPR.number,
          title: targetPR.title,
          author: targetPR.user?.login,
          created: targetPR.created_at,
          repo: REPO
        },
        ...result
      }, null, 2));
    } else {
      console.log(`# PR #${targetPR.number}: ${targetPR.title}`);
      console.log(`by @${targetPR.user?.login} (${targetPR.created_at.split('T')[0]})\n`);
      
      console.log(`## Summary\n${result.summary}\n`);
      
      if (result.superseded?.length > 0) {
        console.log(`## 🔴 SUPERSEDED (can close)\n`);
        for (const r of result.superseded) {
          console.log(`#${r.pr}: ${r.title}`);
          console.log(`  Confidence: ${r.confidence}`);
          console.log(`  Reasoning: ${r.reasoning}\n`);
        }
      }
      
      if (result.related?.length > 0) {
        console.log(`## 🟡 RELATED (for context)\n`);
        for (const r of result.related) {
          console.log(`#${r.pr}: ${r.title}`);
          console.log(`  Confidence: ${r.confidence}`);
          console.log(`  Relationship: ${r.relationship}\n`);
        }
      }
      
      if (!result.superseded?.length && !result.related?.length) {
        console.log(`## ✅ No supersession or close relationships detected\n`);
      }
    }
    
    return result;
  } catch (e) {
    console.error('Analysis failed:', e.message);
    process.exit(1);
  }
}

analyze();
