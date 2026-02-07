#!/usr/bin/env node
/**
 * OpenClaw PR Supersession Detector
 * Finds open PRs that can be closed because a newer merged PR addressed the same issue.
 */

import { execSync } from 'child_process';
import { spawnSync } from 'child_process';

const REPO = process.argv.find(a => a.startsWith('--repo='))?.split('=')[1] || 'openclaw/openclaw';
const DAYS = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || 30);

function gh(query, timeout = 20) {
  try {
    const result = spawnSync('gh', ['api', query], {
      encoding: 'utf-8',
      timeout: timeout * 1000,
      maxBuffer: 10 * 1024 * 1024
    });
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function search(query) {
  return gh(`search/issues?q=${encodeURIComponent(query)}&per_page=100`);
}

function extractIssues(body) {
  if (!body) return [];
  const matches = body.match(/(?<!# )\b#(\d+)\b/g) || [];
  return [...new Set(matches.map(m => parseInt(m.slice(1))))];
}

function main() {
  console.log(`Scanning ${REPO} for superseded PRs...\n`);
  
  const openResult = search(`repo:${REPO} is:pr is:open sort:updated-desc`);
  const openPRs = openResult?.items || [];
  
  const mergedResult = search(`repo:${REPO} is:pr is:merged sort:updated-desc`);
  const mergedPRs = (mergedResult?.items || []).map(pr => ({
    number: pr.number,
    title: pr.title,
    merged_at: pr.merged_at,
    author: pr.user?.login,
    created_at: pr.created_at,
    issues: extractIssues(pr.body)
  }));
  
  console.log(`Open PRs: ${openPRs.length}`);
  console.log(`Merged PRs: ${mergedPRs.length}\n`);
  
  const superseded = [];
  
  for (const pr of openPRs) {
    const prIssues = extractIssues(pr.body);
    if (prIssues.length === 0) continue;
    
    for (const issue of prIssues) {
      const superseding = mergedPRs.find(m => 
        m.number !== pr.number &&
        m.issues.includes(issue) &&
        new Date(pr.created_at) < new Date(m.merged_at)
      );
      
      if (superseding) {
        superseded.push({
          pr: pr.number,
          title: pr.title,
          author: pr.user?.login,
          created: pr.created_at.split('T')[0],
          supersededBy: superseding.number,
          supersededByTitle: superseding.title,
          supersededByAuthor: superseding.author,
          supersededAt: superseding.merged_at.split('T')[0],
          sameIssue: issue
        });
        break;
      }
    }
  }
  
  if (superseded.length === 0) {
    console.log('✓ No superseded PRs found\n');
    console.log('Note: Only detects same-issue references ("Fixes #12345").');
    console.log('LLM needed for semantic matching.\n');
    return;
  }
  
  console.log(`## ${superseded.length} PRs Can Be Closed\n`);
  
  for (const r of superseded) {
    console.log(`#${r.pr}: ${r.title}`);
    console.log(`  by @${r.author} (${r.created})`);
    console.log(`  ↳ Superseded by #${r.supersededBy} "${r.supersededByTitle}"`);
    console.log(`    by @${r.supersededByAuthor} (merged ${r.supersededAt})`);
    console.log(`    Both reference issue #${r.sameIssue}\n`);
  }
  
  console.log(`To close: gh pr close ${superseded.map(r => r.pr).join(' ')} --delete-branch\n`);
}

main();
